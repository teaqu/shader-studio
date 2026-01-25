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
        
        // Handle video-specific localResourceRoots for webview
        this.handleVideoResourceRoots(message);
        
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

  private handleVideoResourceRoots(message: any): void {
    if (!message.config?.passes) {
      return;
    }

    const firstPanel = this.panels.values().next().value;
    if (!firstPanel?.webview) {
      return;
    }

    // Store original paths before ConfigPathConverter processes them
    const videoPaths: string[] = [];
    
    for (const passName of Object.keys(message.config.passes)) {
      const pass = message.config.passes[passName];
      if (!pass?.inputs) {
        continue;
      }

      for (const key of Object.keys(pass.inputs)) {
        const input = pass.inputs[key];
        if (input?.path && input.type === "video") {
          // If path is already a webview URI, we can't extract the original path easily
          // So we'll skip localResourceRoots handling for webview URIs
          if (!input.path.startsWith('vscode-webview://')) {
            videoPaths.push(input.path);
          }
        }
      }
    }

    // Add video directories to localResourceRoots
    for (const videoPath of videoPaths) {
      const videoDir = path.dirname(videoPath);
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
