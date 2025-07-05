import * as vscode from "vscode";
import { WebSocket, WebSocketServer } from "ws";
import { MessageHandler } from "./MessageHandler";

export class MessageSender {
  private panel?: vscode.WebviewPanel;
  private wsServer?: WebSocketServer;
  private wsClients: Set<WebSocket> = new Set();
  private messageHandler: MessageHandler;

  constructor(
    outputChannel: vscode.LogOutputChannel,
    diagnosticCollection: vscode.DiagnosticCollection,
    panel?: vscode.WebviewPanel, 
    wsPort?: number
  ) {
    // Create our own MessageHandler instance
    this.messageHandler = new MessageHandler(outputChannel, diagnosticCollection);

    if (panel) {
      // Webview
      this.panel = panel;
      panel.webview.onDidReceiveMessage((message) => this.handleMessage(message), null, []);
    } else if (wsPort) {
      // WebSocket
      this.wsServer = new WebSocketServer({ port: wsPort });
      this.wsServer.on("connection", (ws: WebSocket) => {
        this.wsClients.add(ws);
        ws.on("message", (msg: any) => {
          let data;
          try { data = JSON.parse(msg.toString()); } catch { data = msg; }
          this.handleMessage(data);
        });
        ws.on("close", () => this.wsClients.delete(ws));
      });
    } else {
      throw new Error("Must supply either panel or wsPort");
    }
  }

  private handleMessage(message: any): void {
    this.messageHandler.handleMessage(message);
  }

  send(msg: any) {
    if (this.panel) {
      this.panel.webview.postMessage(msg);
    } else if (this.wsServer) {
      const str = JSON.stringify(msg);
      for (const client of this.wsClients) {
        if (client.readyState === WebSocket.OPEN) client.send(str);
      }
    }
  }

  convertUriForClient(filePath: string): string {
    if (this.panel) {
      // For webview, convert to webview URI
      return this.panel.webview.asWebviewUri(vscode.Uri.file(filePath)).toString();
    } else {
      // For web server, just return the file path as-is or convert to appropriate URL
      return filePath;
    }
  }

  getPanel(): vscode.WebviewPanel | undefined {
    return this.panel;
  }

  close(): void {
    if (this.wsServer) {
      // Close all client connections
      for (const client of this.wsClients) {
        client.close();
      }
      this.wsClients.clear();
      
      // Close the server
      this.wsServer.close();
      this.wsServer = undefined;
    }
  }
}
