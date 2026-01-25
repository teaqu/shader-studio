import { WebSocket, WebSocketServer } from "ws";
import * as vscode from "vscode";
import type { ShaderConfig } from "@shader-studio/types";
import { ConfigPathConverter } from "./ConfigPathConverter";
import { MessageTransport } from "./MessageTransport";
import { ShaderProvider } from "../ShaderProvider";
import { GlslFileTracker } from "../GlslFileTracker";

export class WebSocketTransport implements MessageTransport {
  private wsServer: WebSocketServer;
  private wsClients: Set<WebSocket> = new Set();
  private messageHandler?: (message: any) => void;
  private clientTypes: Map<WebSocket, 'electron' | 'browser'> = new Map();

  constructor(
    port: number,
    private shaderProvider: ShaderProvider,
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
          this.shaderProvider!.sendShaderToWebview(activeEditor);
        }, 100);
        console.log('WebSocket: Requested current shader to be sent to new client');
      }
    } catch (error) {
      console.error('WebSocket: Error sending current shader to new client:', error);
    }
  }

  public send(message: any): void {
    console.log(`WebSocketTransport: send() called with message type: ${message.type}`);
    
    const totalClients = this.wsClients.size;
    if (totalClients === 0) {
      console.log(`WebSocketTransport: No clients to send message to`);
      return;
    }

    // Check if we have any active browser/Electron clients
    const hasRealClients = Array.from(this.wsClients).some(client => 
      client.readyState === WebSocket.OPEN && 
      ['browser', 'electron'].includes(this.clientTypes.get(client) || 'browser')
    );

    if (!hasRealClients) {
      console.log(`WebSocketTransport: No active browser/Electron clients, skipping message processing`);
      // Still send the message but without path conversion
      this.sendMessageToAllClients(message);
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
            const clientType = this.clientTypes.get(client) || 'browser';
            console.log(`WebSocketTransport: Client type detected as: ${clientType}`);
            console.log(`WebSocketTransport: Calling ConfigPathConverter.processConfigPaths for client type: ${clientType}`);
            
            // Only process path conversion for actual browser/Electron clients
            // VS Code panels should be handled by WebviewTransport, not WebSocketTransport
            if (clientType === 'browser' || clientType === 'electron') {
              clientMessage = this.processConfigPaths(message, clientType);
              console.log(`WebSocketTransport: processConfigPaths completed`);
            } else {
              console.log(`WebSocketTransport: Skipping path conversion for unsupported client type: ${clientType}`);
            }
          }

          const str = JSON.stringify(clientMessage);
          console.log(`WebSocketTransport: Sending message (${str.length} bytes) to client`);
          client.send(str);
        } catch (error) {
          console.error(`WebSocketTransport: Error sending message to client:`, error);
        }
      } else {
        console.log(`WebSocketTransport: Client not ready (readyState: ${client.readyState})`);
      }
    }
  }

  private processConfigPaths(message: { type: string; config: ShaderConfig;[key: string]: any }, clientType: 'electron' | 'browser'): typeof message {
    // Create a mock webview for ConfigPathConverter
    const mockWebview = {
      asWebviewUri: (uri: vscode.Uri) => uri
    } as vscode.Webview;
    
    const processedMessage = ConfigPathConverter.processConfigPaths(message, mockWebview);
    
    // Handle video-specific logic based on client type
    this.handleVideoPaths(processedMessage, clientType);
    
    return processedMessage;
  }

  private handleVideoPaths(message: any, clientType: 'electron' | 'browser'): void {
    if (!message.config?.passes) {
      return;
    }

    for (const passName of Object.keys(message.config.passes)) {
      const pass = message.config.passes[passName];
      if (!pass?.inputs) {
        continue;
      }

      for (const key of Object.keys(pass.inputs)) {
        const input = pass.inputs[key];
        if (input?.path && input.type === "video") {
          if (clientType === 'browser') {
            // Check if this is actually a VS Code panel by looking at the path format
            // VS Code panels should not use webserver URLs for videos
            if (input.path.startsWith('vscode-webview://') || input.path.includes('vscode-resource.vscode-cdn.net')) {
              // This is a VS Code panel - show error message about needing webserver
              const errorMessage = `Webserver not running - cannot load video: ${input.path}. Please start the webserver using 'Shader Studio: Start Web Server' command`;
              console.error(`WebSocketTransport: ${errorMessage}`);
              // Note: We can't send error to UI from here since this is server-side
              // Leave the path as-is which will fail, but the error is clear in console
            } else {
              // This is a real browser client - use webserver URLs
              const config = vscode.workspace.getConfiguration('Shader Studio');
              const port = config.get<number>('webServerPort') || 3000;
              input.path = `http://localhost:${port}/textures/${encodeURIComponent(input.path)}`;
              console.log(`WebSocketTransport: Video converted to webserver URL: ${input.path}`);
            }
          } else {
            // Electron clients can use file:// URLs
            input.path = `file://${input.path.replace(/\\/g, '/')}`;
            console.log(`WebSocketTransport: Video converted to file:// URL: ${input.path}`);
          }
        }
      }
    }
  }

  // Legacy method for backward compatibility with tests
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
    this.wsClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.close();
      }
    });
    this.wsServer.close();
  }

  public onMessage(handler: (message: any) => void): void {
    this.messageHandler = handler;
  }

  public hasActiveClients(): boolean {
    return this.wsClients.size > 0;
  }
}
