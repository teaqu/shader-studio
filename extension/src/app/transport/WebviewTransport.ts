import * as vscode from "vscode";
import { MessageTransport } from "./MessageTransport";
import { ConfigPathConverter } from "./ConfigPathConverter";
import type { ShaderConfig } from "@shader-studio/types";

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
      const firstPanel = this.panels.values().next().value;
      if (firstPanel?.webview) {
        message = ConfigPathConverter.processConfigPaths(message, firstPanel.webview);
      }
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
