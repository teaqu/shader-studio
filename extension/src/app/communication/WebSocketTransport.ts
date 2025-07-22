import { WebSocket, WebSocketServer } from "ws";
import { MessageTransport } from "./MessageTransport";
import { ShaderUtils } from "../util/ShaderUtils";

export class WebSocketTransport implements MessageTransport {
  private wsServer: WebSocketServer;
  private wsClients: Set<WebSocket> = new Set();
  private messageHandler?: (message: any) => void;

  constructor(port: number) {
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
      const shaderInfo = ShaderUtils.getCurrentShaderInfo();
      if (shaderInfo) {
        ws.send(JSON.stringify(shaderInfo));
        console.log('WebSocket: Current shader sent to new client');
      } else {
        const message = {
          type: 'welcome',
          payload: ['Connected to VSCode Shader View - No active GLSL file']
        };
        ws.send(JSON.stringify(message));
        console.log('WebSocket: No active shader, sent welcome message');
      }
    } catch (error) {
      console.error('WebSocket: Error sending current shader to new client:', error);
    }
  }

  public send(message: any): void {
    let str;
    try {
      str = JSON.stringify(message);
    } catch (error) {
      console.error('WebSocket: JSON stringify error:', error);
      return;
    }

    let sentCount = 0;
    let totalClients = this.wsClients.size;

    const messageSize = Buffer.byteLength(str, 'utf8');
    console.log(`WebSocket: Sending ${message.type} (${messageSize} bytes) to ${totalClients} clients`);

    for (const client of this.wsClients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(str);
          sentCount++;
        } catch (error) {
          console.error('WebSocket send error:', error);
        }
      }
    }
    console.log(`WebSocket: Sent to ${sentCount}/${totalClients} clients`);
  }

  public convertUriForClient(filePath: string): string {
    // For web server, return the file path as-is or convert to appropriate URL
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
}
