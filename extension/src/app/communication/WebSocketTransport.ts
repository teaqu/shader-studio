import { WebSocket, WebSocketServer } from "ws";
import { MessageTransport } from "./MessageTransport";

export class WebSocketTransport implements MessageTransport {
  private wsServer: WebSocketServer;
  private wsClients: Set<WebSocket> = new Set();
  private messageHandler?: (message: any) => void;

  constructor(port: number) {
    this.wsServer = new WebSocketServer({ port });
    this.wsServer.on("connection", (ws: WebSocket) => {
      this.wsClients.add(ws);
      
      ws.on("message", (msg: any) => {
        let data;
        try { 
          data = JSON.parse(msg.toString()); 
        } catch { 
          data = msg; 
        }
        this.messageHandler?.(data);
      });
      
      ws.on("close", () => this.wsClients.delete(ws));
    });
  }

  public send(message: any): void {
    const str = JSON.stringify(message);
    for (const client of this.wsClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(str);
      }
    }
  }

  public convertUriForClient(filePath: string): string {
    // For web server, return the file path as-is or convert to appropriate URL
    return filePath;
  }

  public close(): void {
    // Close all client connections
    for (const client of this.wsClients) {
      client.close();
    }
    this.wsClients.clear();
    
    // Close the server
    this.wsServer.close();
  }

  public onMessage(handler: (message: any) => void): void {
    this.messageHandler = handler;
  }
}
