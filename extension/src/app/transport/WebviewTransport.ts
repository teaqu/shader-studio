import * as vscode from "vscode";
import * as path from "path";
import { MessageTransport } from "./MessageTransport";
import { ConfigPathConverter } from "./ConfigPathConverter";

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
          const firstPanel = this.panels.values().next().value;
          
          if (firstPanel?.webview) {
            // Check if file exists first
            const fs = require('fs');
            if (!fs.existsSync(input.path)) {
              console.error(`WebviewTransport: Video file does not exist: ${input.path}`);
              continue;
            }
            
            // Add video directory to localResourceRoots if needed
            const videoDir = path.dirname(input.path);
            const currentRoots = firstPanel.webview.options.localResourceRoots ?? [];
            const videoDirUri = vscode.Uri.file(videoDir);
            
            const hasVideoDir = currentRoots.some((root: vscode.Uri) => 
              root.fsPath === videoDirUri.fsPath
            );
            
            if (!hasVideoDir) {
              firstPanel.webview.options = {
                ...firstPanel.webview.options,
                localResourceRoots: [...currentRoots, videoDirUri]
              };
            }
            
            // Use webview URI for video
            const webviewUri = firstPanel.webview.asWebviewUri(vscode.Uri.file(input.path)).toString();
            input.path = webviewUri;
          }
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
