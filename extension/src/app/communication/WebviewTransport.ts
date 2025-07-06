import * as vscode from "vscode";
import { MessageTransport } from "./MessageTransport";

export class WebviewTransport implements MessageTransport {
  private messageHandler?: (message: any) => void;

  constructor(private panel: vscode.WebviewPanel) {
    this.panel.webview.onDidReceiveMessage(
      (message) => this.messageHandler?.(message),
      null,
      []
    );
  }

  send(message: any): void {
    this.panel.webview.postMessage(message);
  }

  convertUriForClient(filePath: string): string {
    return this.panel.webview.asWebviewUri(vscode.Uri.file(filePath)).toString();
  }

  close(): void {
    // Panel disposal is handled externally
  }

  onMessage(handler: (message: any) => void): void {
    this.messageHandler = handler;
  }
}
