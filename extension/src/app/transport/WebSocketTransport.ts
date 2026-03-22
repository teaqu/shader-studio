import { WebSocket, WebSocketServer } from "ws";
import * as vscode from "vscode";
import * as path from "path";
import { fileURLToPath } from "url";
import type { ShaderConfig } from "@shader-studio/types";
import { MessageTransport } from "./MessageTransport";
import { ShaderProvider } from "../ShaderProvider";
import { GlslFileTracker } from "../GlslFileTracker";
import { ClientMessageHandler } from "../ClientMessageHandler";

export class WebSocketTransport implements MessageTransport {
  private wsServer: WebSocketServer;
  private wsClients: Set<WebSocket> = new Set();
  private messageHandler?: (message: any) => void;

  constructor(
    port: number,
    private shaderProvider: ShaderProvider,
    private glslFileTracker: GlslFileTracker,
    private context: vscode.ExtensionContext,
    private extensionPath: string,
    onReady?: (actualPort: number) => void
  ) {
    this.wsServer = new WebSocketServer({ port, perMessageDeflate: true });

    this.wsServer.on("listening", () => {
      const actual = (this.wsServer.address() as { port: number }).port;
      console.log(`WebSocket server listening on port ${actual}`);
      onReady?.(actual);
    });

    this.wsServer.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        console.log(`WebSocket port ${port} in use, falling back to dynamic port`);
        this.wsServer.close();
        this.wsServer = new WebSocketServer({ port: 0, perMessageDeflate: true });
        this.wsServer.on("listening", () => {
          const actual = (this.wsServer.address() as { port: number }).port;
          console.log(`WebSocket server (fallback) listening on port ${actual}`);
          onReady?.(actual);
        });
        this.wsServer.on("error", (err) => {
          console.error('WebSocket server fallback error:', err);
        });
        this.attachConnectionHandler();
      } else {
        console.error(`WebSocket server error on port ${port}:`, error);
      }
    });

    this.attachConnectionHandler();
  }

  private attachConnectionHandler(): void {
    this.wsServer.on("connection", (ws: WebSocket) => {
      console.log(`WebSocket: Client connected. Total clients: ${this.wsClients.size + 1}`);
      this.wsClients.add(ws);

      // Create a per-connection ClientMessageHandler
      const clientHandler = new ClientMessageHandler(
        this.context,
        this.shaderProvider,
        this.glslFileTracker,
        null,
        this.extensionPath,
      );

      // Send current shader instead of welcome message
      this.sendCurrentShaderToNewClient(ws);

      ws.on("message", async (msg: any) => {
        try {
          const messageStr = msg instanceof Buffer ? msg.toString() : msg;
          const data = JSON.parse(messageStr);

          // Handle client identification (legacy, kept for compatibility)
          if (data.type === 'clientInfo') {
            console.log(`WebSocket: Client connected from browser`);
            return;
          }

          await clientHandler.handle(
            data,
            (responseMsg) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(responseMsg));
              }
            },
            (absPath) => this.convertUriForClient(absPath),
          );
        } catch (parseError) {
          console.error('WebSocket: Failed to parse message:', parseError);
        }
      });

      ws.on("close", (code, reason) => {
        this.wsClients.delete(ws);
        console.log(`WebSocket: Client disconnected. Code: ${code},
          Reason: ${reason?.toString()}. Total clients: ${this.wsClients.size}`);
      });

      ws.on("error", (error) => {
        console.error('WebSocket client error:', error);
        this.wsClients.delete(ws);
      });

      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        } else {
          clearInterval(pingInterval);
        }
      }, 30000);
    });
  }

  private sendCurrentShaderToNewClient(ws: WebSocket): void {
    try {
      const activeEditor = this.glslFileTracker.getActiveOrLastViewedGLSLEditor();

      if (activeEditor) {
        setTimeout(() => {
          this.shaderProvider!.sendShaderToWebview(activeEditor);
        }, 100);
        console.log('WebSocket: Requested current shader to be sent to new client');
      }
    } catch (error) {
      console.error('WebSocket: Error sending current shader to new client:', error);
    }
  }

  public send(message: any): void {
    const totalClients = this.wsClients.size;
    if (totalClients === 0) {
      return;
    }

    console.log(`WebSocket: Sending ${message.type} to ${totalClients} clients`);
    this.sendMessageToAllClients(message);
  }

  private sendMessageToAllClients(message: any): void {
    for (const client of this.wsClients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          let clientMessage = message;
          if (message.type === "shaderSource" && message.config) {
            clientMessage = this.processConfigPaths(message);
          }

          client.send(JSON.stringify(clientMessage));
        } catch (error) {
          console.error(`WebSocketTransport: Error sending message to client:`, error);
        }
      }
    }
  }

  private processConfigPaths(message: { type: string; config: ShaderConfig;[key: string]: any }): typeof message {
    // Clone to avoid mutating the original message
    const processedMessage = JSON.parse(JSON.stringify(message));
    const config = processedMessage.config;

    if (!config?.passes) {
      return processedMessage;
    }

    const shaderPath = processedMessage.path || '';
    const configDir = shaderPath ? path.dirname(shaderPath) : '';

    for (const passName of Object.keys(config.passes)) {
      const pass = config.passes[passName];
      if (!pass?.inputs) continue;

      for (const key of Object.keys(pass.inputs)) {
        const input = pass.inputs[key];
        if (!input?.path) continue;
        if (input.type !== 'texture' && input.type !== 'video' && input.type !== 'audio') continue;

        // Resolve to absolute path
        let absolutePath: string;
        if (input.path.startsWith('@/')) {
          const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
          absolutePath = workspaceFolder
            ? path.join(workspaceFolder.uri.fsPath, input.path.substring(2))
            : input.path;
        } else if (input.path.startsWith('file://')) {
          absolutePath = this.normalizeLocalPath(input.path);
        } else if (path.isAbsolute(input.path)) {
          absolutePath = input.path;
        } else {
          absolutePath = configDir ? path.join(configDir, input.path) : input.path;
        }

        input.resolved_path = this.convertUriForClient(absolutePath);
        if (input.type === 'video') {
          // Browser clients need HTTP URLs for direct media playback.
          input.path = this.convertUriForClient(absolutePath);
        }
      }
    }

    // Also convert pathMap entries for config panel previews
    if (processedMessage.pathMap) {
      for (const key of Object.keys(processedMessage.pathMap)) {
        const value = processedMessage.pathMap[key];
        // Replace webview URIs with HTTP URLs
        if (value && !value.startsWith('http://') && !value.startsWith('https://')) {
          // Resolve the key (original path) to absolute, then convert
          let absolutePath: string;
          if (key.startsWith('@/')) {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            absolutePath = workspaceFolder
              ? path.join(workspaceFolder.uri.fsPath, key.substring(2))
              : key;
          } else if (key.startsWith('file://')) {
            absolutePath = this.normalizeLocalPath(key);
          } else if (path.isAbsolute(key)) {
            absolutePath = key;
          } else {
            absolutePath = configDir ? path.join(configDir, key) : key;
          }
          processedMessage.pathMap[key] = this.convertUriForClient(absolutePath);
        }
      }
    }

    return processedMessage;
  }

  // Legacy method for backward compatibility with tests
  public convertUriForClient(filePath: string): string {
    const normalizedPath = this.normalizeLocalPath(filePath);

    // Handle local file paths for browser clients
    if (normalizedPath.match(/^[a-zA-Z]:|^\//)) {
      // Looks like a local file path (Windows drive or Unix absolute path)
      // Browser clients need HTTP URLs due to CORS restrictions
      const config = vscode.workspace.getConfiguration('shader-studio');
      const port = config.get<number>('webServerPort') || 3000;
      return `http://localhost:${port}/textures/${encodeURIComponent(normalizedPath)}`;
    }
    return normalizedPath;
  }

  private normalizeLocalPath(filePath: string): string {
    if (!filePath.startsWith('file://')) {
      return filePath;
    }

    try {
      const normalized = fileURLToPath(filePath);
      if (/^\/[a-zA-Z]:\//.test(normalized)) {
        return normalized.slice(1);
      }
      return normalized;
    } catch {
      const withoutScheme = decodeURIComponent(filePath.replace(/^file:\/+/, ''));
      return withoutScheme;
    }
  }

  public close(): void {
    this.wsClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.close();
      }
    });
    this.wsClients.clear();
    this.wsServer.close();
  }

  public onMessage(handler: (message: any) => void): void {
    this.messageHandler = handler;
  }

  public hasActiveClients(): boolean {
    return this.wsClients.size > 0;
  }
}
