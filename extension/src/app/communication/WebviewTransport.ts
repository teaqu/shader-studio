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
    try {
      if (this.panel.webview) {
        this.panel.webview.postMessage(message);
      }
    } catch (error) {
      console.log('Webview transport: panel disposed, message not sent');
    }
  }

  public convertUriForClient(filePath: string): string {
    try {
      if (this.panel.webview) {
        return this.panel.webview.asWebviewUri(vscode.Uri.file(filePath)).toString();
      }
      return filePath;
    } catch (error) {
      return filePath;
    }
  }

  public close(): void {
    // Panel disposal is handled externally
  }

  public onMessage(handler: (message: any) => void): void {
    this.messageHandler = handler;
  }
}
