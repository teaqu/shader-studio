import * as vscode from "vscode";
import { MessageTransport } from "./MessageTransport";

export class WebviewTransport implements MessageTransport {
  private messageHandler?: (message: any) => void;
  private panels: Set<vscode.WebviewPanel> = new Set();

  public addPanel(panel: vscode.WebviewPanel): void {
    this.panels.add(panel);
    
    panel.webview.onDidReceiveMessage(
      (message) => this.messageHandler?.(message),
      null,
      []
    );

    panel.onDidDispose(() => {
      this.panels.delete(panel);
      console.log(`Webview panel disposed. Remaining panels: ${this.panels.size}`);
    });
  }

  public removePanel(panel: vscode.WebviewPanel): void {
    this.panels.delete(panel);
  }

  public send(message: any): void {
    if (message.type === "shaderSource" && message.config) {
      message = this.processConfigPaths(message);
    }

    let sentCount = 0;
    const totalPanels = this.panels.size;

    console.log(`Webview: Sending ${message.type} to ${totalPanels} panels`);

    for (const panel of this.panels) {
      try {
        if (panel.webview) {
          panel.webview.postMessage(message);
          sentCount++;
        } else {
          this.panels.delete(panel); // Clean up disposed panels
        }
      } catch (error) {
        console.log('Webview transport: panel disposed, message not sent');
        this.panels.delete(panel);
      }
    }

    console.log(`Webview: Sent to ${sentCount}/${totalPanels} panels`);
  }

  private processConfigPaths(message: any): any {
    const processedMessage = JSON.parse(JSON.stringify(message));
    const config = processedMessage.config;

    if (!config) {
      return processedMessage;
    }

    for (const passName of Object.keys(config)) {
      if (passName === "version") {
        continue;
      }
      
      const pass = config[passName];
      if (typeof pass !== "object") {
        continue;
      }

      if (pass.inputs && typeof pass.inputs === "object") {
        for (const key of Object.keys(pass.inputs)) {
          const input = pass.inputs[key];
          if (input.type === "texture" && input.path) {
            input.path = this.convertUriForClient(input.path);
          }
        }
      }
    }

    return processedMessage;
  }

  public convertUriForClient(filePath: string): string {
    const firstPanel = this.panels.values().next().value;
    try {
      if (firstPanel?.webview) {
        return firstPanel.webview.asWebviewUri(vscode.Uri.file(filePath)).toString();
      }
      return filePath;
    } catch (error) {
      return filePath;
    }
  }

  public close(): void {
    for (const panel of this.panels) {
      try {
        panel.dispose();
      } catch (error) {
        // Panel may already be disposed
      }
    }
    this.panels.clear();
  }

  public onMessage(handler: (message: any) => void): void {
    this.messageHandler = handler;
  }

  public get panelCount(): number {
    return this.panels.size;
  }

  public hasActiveClients(): boolean {
    return this.panels.size > 0;
  }
}
