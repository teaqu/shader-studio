import { WebSocket, WebSocketServer } from "ws";
import * as vscode from "vscode";
import { MessageTransport } from "./MessageTransport";
import type { ShaderConfig } from "@shader-studio/types";
import { ShaderProcessor } from "../ShaderProcessor";
import { GlslFileTracker } from "../GlslFileTracker";

export class WebSocketTransport implements MessageTransport {
  private wsServer: WebSocketServer;
  private wsClients: Set<WebSocket> = new Set();
  private messageHandler?: (message: any) => void;
  private clientTypes: Map<WebSocket, 'electron' | 'browser'> = new Map();

  constructor(
    port: number,
    private shaderProcessor: ShaderProcessor,
    private glslFileTracker: GlslFileTracker
  ) {
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

          // Handle client identification
          if (data.type === 'clientInfo') {
            const clientType = data.isElectron ? 'electron' : 'browser';
            this.clientTypes.set(ws, clientType);
            console.log(`WebSocket: Client identified as ${clientType}`);
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
        this.clientTypes.delete(ws);
        console.log(`WebSocket: Client disconnected. Code: ${code}, 
          Reason: ${reason?.toString()}. Total clients: ${this.wsClients.size}`);
      });

      ws.on("error", (error) => {
        console.error('WebSocket client error:', error);
        this.wsClients.delete(ws);
        this.clientTypes.delete(ws);
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
          this.shaderProcessor!.sendShaderToWebview(activeEditor);
        }, 100);
        console.log('WebSocket: Requested current shader to be sent to new client');
      }
    } catch (error) {
      console.error('WebSocket: Error sending current shader to new client:', error);
    }
  }

  public send(message: any): void {
    let sentCount = 0;
    let totalClients = this.wsClients.size;

    console.log(`WebSocket: Sending ${message.type} to ${totalClients} clients`);

    for (const client of this.wsClients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          let clientMessage = message;
          if (message.type === "shaderSource" && message.config) {
            const clientType = this.clientTypes.get(client) || 'browser';
            clientMessage = this.processConfigPaths(message, clientType);
          }

          const str = JSON.stringify(clientMessage);
          const messageSize = Buffer.byteLength(str, 'utf8');

          client.send(str);
          sentCount++;
        } catch (error) {
          console.error('WebSocket send error:', error);
        }
      }
    }
    console.log(`WebSocket: Sent to ${sentCount}/${totalClients} clients`);
  }

  private processConfigPaths(message: { type: string; config: ShaderConfig;[key: string]: any }, clientType: 'electron' | 'browser'): typeof message {
    const processedMessage = JSON.parse(JSON.stringify(message));
    const config = processedMessage.config;

    if (!config?.passes) {
      return processedMessage;
    }

    for (const passName of Object.keys(config.passes) as Array<keyof typeof config.passes>) {
      const pass = config.passes[passName];
      if (!pass || typeof pass !== "object") {
        continue;
      }

      if (pass.inputs && typeof pass.inputs === "object") {
        for (const key of Object.keys(pass.inputs)) {
          const input = pass.inputs[key as keyof typeof pass.inputs];
          if (input && input.type === "texture" && input.path) {
            input.path = this.convertUriForClient(input.path, clientType);
          }
        }
      }
    }

    return processedMessage;
  }

  public convertUriForClient(filePath: string, clientType: 'electron' | 'browser' = 'browser'): string {
    // Handle local file paths differently for browser vs Electron clients
    if (filePath.match(/^[a-zA-Z]:|^\//) || filePath.match(/^\\\\/)) {
      // Looks like a local file path (Windows drive, Unix absolute path, or UNC path)

      if (clientType === 'electron') {
        // Electron can access local files directly via file:// protocol
        return `file://${filePath.replace(/\\/g, '/')}`;
      } else {
        // Browser clients need HTTP URLs due to CORS restrictions
        // Encode the full file path for the WebServer to serve directly
        const config = vscode.workspace.getConfiguration('Shader Studio');
        const port = config.get<number>('webServerPort') || 3000;
        return `http://localhost:${port}/textures/${encodeURIComponent(filePath)}`;
      }
    }
    return filePath;
  }

  public close(): void {
    for (const client of this.wsClients) {
      client.close();
    }
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
