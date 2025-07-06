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

  public send(message: any): void {
    this.panel.webview.postMessage(message);
  }

  public convertUriForClient(filePath: string): string {
    return this.panel.webview.asWebviewUri(vscode.Uri.file(filePath)).toString();
  }

  public close(): void {
    // Panel disposal is handled externally
  }

  public onMessage(handler: (message: any) => void): void {
    this.messageHandler = handler;
  }
}
