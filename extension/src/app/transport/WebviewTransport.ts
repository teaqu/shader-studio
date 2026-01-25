import * as vscode from "vscode";
import { MessageTransport } from "./MessageTransport";
import type { ShaderConfig } from "@shader-studio/types";
import { ConfigPathConverter } from "./ConfigPathConverter";

export class WebviewTransport implements MessageTransport {
  private messageHandler?: (message: any) => void;
  private errorHandler?: { handleError: (message: any) => void };
  private panels: Set<vscode.WebviewPanel> = new Set();

  public setErrorHandler(errorHandler: { handleError: (message: any) => void }): void {
    this.errorHandler = errorHandler;
  }

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
    console.log(`WebviewTransport: send() called with message type: ${message.type}`);
    
    if (message.type === "shaderSource" && message.config) {
      console.log(`WebviewTransport: Processing shaderSource message with config`);
      const firstPanel = this.panels.values().next().value;
      if (firstPanel?.webview) {
        console.log(`WebviewTransport: Calling ConfigPathConverter.processConfigPaths`);
        message = ConfigPathConverter.processConfigPaths(message, firstPanel.webview);
        
        // Handle video-specific logic for webview
        this.handleVideoPaths(message);
        
        console.log(`WebviewTransport: ConfigPathConverter returned processed message`);
      } else {
        console.log(`WebviewTransport: No webview panel available for path conversion`);
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

  private handleVideoPaths(message: any): void {
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
          // Videos need webserver - show error if not available
          const errorMessage = `Webserver not running - cannot load video: ${input.path}. Please start the webserver using 'Shader Studio: Start Web Server' command`;
          console.error(`WebviewTransport: ${errorMessage}`);
          if (this.errorHandler) {
            this.errorHandler.handleError({
              type: 'error',
              payload: [errorMessage]
            });
          }
          // Note: We leave the path as-is (webview URI) which will fail, but the error message is clear
        }
      }
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
