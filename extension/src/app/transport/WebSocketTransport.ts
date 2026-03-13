import { WebSocket, WebSocketServer } from "ws";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import type { ShaderConfig } from "@shader-studio/types";
import { MessageTransport } from "./MessageTransport";
import { ShaderProvider } from "../ShaderProvider";
import { GlslFileTracker } from "../GlslFileTracker";
import { WorkspaceFileScanner } from "../WorkspaceFileScanner";
import { OverlayPanelHandler } from "../OverlayPanelHandler";

export class WebSocketTransport implements MessageTransport {
  private wsServer: WebSocketServer;
  private wsClients: Set<WebSocket> = new Set();
  private messageHandler?: (message: any) => void;
  private overlayHandler: OverlayPanelHandler;

  /** Message types handled directly by WebSocketTransport (not forwarded to MessageHandler) */
  private static readonly CLIENT_REQUEST_TYPES = new Set([
    'requestWorkspaceFiles',
    'updateConfig',
    'createBufferFile',
    'updateShaderSource',
    'requestFileContents',
    'requestLayout',
  ]);

  constructor(
    port: number,
    private shaderProvider: ShaderProvider,
    private glslFileTracker: GlslFileTracker
  ) {
    this.overlayHandler = new OverlayPanelHandler();

    try {
      this.wsServer = new WebSocketServer({
        port,
        perMessageDeflate: true
      });

      this.wsServer.on("listening", () => {
        console.log(`WebSocket server listening on port ${port}`);
      });
    } catch (error) {
      console.error(`Failed to create WebSocket server on port ${port}:`, error);
      throw error;
    }

    this.wsServer.on("message", (data, isBinary) => {
      console.log("Received from client:", isBinary ? data : data.toString());
    });

    this.wsServer.on("connection", (ws: WebSocket) => {
      console.log(`WebSocket: Client connected. Total clients: ${this.wsClients.size + 1}`);
      this.wsClients.add(ws);

      // Send current shader instead of welcome message
      this.sendCurrentShaderToNewClient(ws);

      ws.on("message", (msg: any) => {
        try {
          const messageStr = msg instanceof Buffer ? msg.toString() : msg;
          const data = JSON.parse(messageStr);

          // Handle client identification (legacy, kept for compatibility)
          if (data.type === 'clientInfo') {
            console.log(`WebSocket: Client connected from browser`);
            return;
          }

          // Handle messages that need a direct response to the requesting client
          if (WebSocketTransport.CLIENT_REQUEST_TYPES.has(data.type)) {
            this.handleClientRequest(data, ws);
            return;
          }

          if (this.messageHandler) {
            this.messageHandler(data);
          } else {
            console.log(`WebSocket: No messageHandler registered`);
          }
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

    this.wsServer.on("error", (error) => {
      console.error('WebSocket server error:', error);
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



  private async handleClientRequest(data: any, ws: WebSocket): Promise<void> {
    try {
      switch (data.type) {
        case 'requestWorkspaceFiles':
          await this.handleRequestWorkspaceFiles(data.payload, ws);
          break;
        case 'updateConfig':
          await this.handleConfigUpdate(data.payload);
          break;
        case 'createBufferFile':
          await this.handleCreateBufferFile(data.payload);
          break;
        case 'updateShaderSource':
          await this.overlayHandler.handleUpdateShaderSource(data.payload);
          break;
        case 'requestFileContents':
          await this.handleRequestFileContents(data.payload, ws);
          break;
        case 'requestLayout':
          // Browser clients don't have a saved layout — respond with null so DockviewLayout uses defaults
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'restoreLayout', payload: null }));
          }
          break;
      }
    } catch (error) {
      console.error(`WebSocket: Error handling ${data.type}:`, error);
    }
  }

  private async handleRequestWorkspaceFiles(
    payload: { extensions: string[]; shaderPath: string },
    ws: WebSocket,
  ): Promise<void> {
    try {
      const files = await WorkspaceFileScanner.scanFiles(
        payload.extensions,
        payload.shaderPath,
        (filePath) => this.convertUriForClient(filePath),
      );
      const response = JSON.stringify({
        type: "workspaceFiles",
        payload: { files },
      });
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(response);
      }
    } catch (error) {
      console.error('WebSocket: Failed to scan workspace files:', error);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "workspaceFiles",
          payload: { files: [] },
        }));
      }
    }
  }

  private async handleConfigUpdate(
    payload: { config: ShaderConfig; text: string; shaderPath?: string; skipRefresh?: boolean },
  ): Promise<void> {
    try {
      let shaderPath = payload.shaderPath;
      if (!shaderPath) {
        const editor = this.glslFileTracker.getActiveOrLastViewedGLSLEditor();
        if (!editor) {
          console.warn("WebSocket: No active shader to update config for");
          return;
        }
        shaderPath = editor.document.uri.fsPath;
      }

      const configPath = shaderPath.replace(/\.(glsl|frag)$/, '.sha.json');
      fs.writeFileSync(configPath, payload.text, 'utf-8');
      console.log(`WebSocket: Config updated: ${configPath}`);

      if (payload.skipRefresh) {
        return;
      }

      setTimeout(() => {
        if (typeof (this.shaderProvider as any).sendShaderFromPath === "function") {
          this.shaderProvider.sendShaderFromPath(shaderPath, { forceCleanup: true });
        }
      }, 150);
    } catch (error) {
      console.error(`WebSocket: Failed to update config: ${error}`);
    }
  }

  private async handleCreateBufferFile(
    payload: { bufferName: string; filePath: string },
  ): Promise<void> {
    try {
      const editor = this.glslFileTracker.getActiveOrLastViewedGLSLEditor();
      if (!editor) {
        console.warn("WebSocket: No active shader to create buffer file for");
        return;
      }

      const shaderPath = editor.document.uri.fsPath;
      const shaderDir = path.dirname(shaderPath);
      const bufferFilePath = path.join(shaderDir, payload.filePath);

      if (!fs.existsSync(bufferFilePath)) {
        let template: string;
        if (payload.bufferName === 'common') {
          template = `// Common functions shared across all passes\n`;
        } else {
          template = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n    vec2 uv = fragCoord / iResolution.xy;\n    fragColor = vec4(uv, 0.0, 1.0);\n}\n`;
        }
        fs.writeFileSync(bufferFilePath, template, 'utf-8');
        console.log(`WebSocket: Created buffer file: ${bufferFilePath}`);
      }
    } catch (error) {
      console.error(`WebSocket: Failed to create buffer file: ${error}`);
    }
  }

  private async handleRequestFileContents(
    payload: { bufferName: string; shaderPath: string },
    ws: WebSocket,
  ): Promise<void> {
    try {
      const { bufferName, shaderPath: mainShaderPath } = payload;
      if (!mainShaderPath || !bufferName) return;

      const configPath = mainShaderPath.replace(/\.(glsl|frag)$/, '.sha.json');
      if (!fs.existsSync(configPath)) return;

      const configText = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configText);
      const pass = config?.passes?.[bufferName];
      if (!pass?.path) return;

      const shaderDir = path.dirname(mainShaderPath);
      const bufferFilePath = path.resolve(shaderDir, pass.path);

      const code = fs.existsSync(bufferFilePath)
        ? fs.readFileSync(bufferFilePath, 'utf-8')
        : '';

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'fileContents',
          payload: { code, path: bufferFilePath, bufferName },
        }));
      }
    } catch (error) {
      console.error(`WebSocket: Failed to read file contents: ${error}`);
    }
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
