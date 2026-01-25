import * as vscode from "vscode";
import * as path from "path";
import { MessageTransport } from "./MessageTransport";
import type { ShaderConfig, ErrorMessage, WarningMessage } from "@shader-studio/types";
import { ConfigPathConverter } from "./ConfigPathConverter";
import type { ErrorHandler } from "../ErrorHandler";

export class WebviewTransport implements MessageTransport {
  private messageHandler?: (message: any) => void;
  private errorHandler?: { handleError: (message: any) => void; handlePersistentError?: (message: any) => void };
  private panels: Set<vscode.WebviewPanel> = new Set();

  public setErrorHandler(errorHandler: ErrorHandler): void {
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
          // VS Code webviews have limited video format support
          // Try webview URI first, fallback to web server for unsupported formats
          const firstPanel = this.panels.values().next().value;
          
          if (firstPanel?.webview) {
            // Check if file exists first
            const fs = require('fs');
            if (!fs.existsSync(input.path)) {
              console.error(`WebviewTransport: Video file does not exist: ${input.path}`);
              continue;
            }
            
            // Check file extension for VS Code compatibility
            const ext = path.extname(input.path).toLowerCase();
            const supportedFormats = ['.mp4', '.webm']; // Basic check
            const useWebServer = !supportedFormats.includes(ext);
            
            if (useWebServer) {
              // Fallback to web server for unsupported formats
              const config = vscode.workspace.getConfiguration('shader-studio');
              const webServerPort = config.get<number>('webServerPort') || 3000;
              const encodedPath = encodeURIComponent(input.path);
              const httpUrl = `http://localhost:${webServerPort}/textures/${encodedPath}`;
              
              console.log(`WebviewTransport: Using web server for unsupported format (${ext}): ${httpUrl}`);
              input.path = httpUrl;
              
              const warningMessage = `Video format ${ext} may not be supported in VS Code panels. Using web server instead. For best compatibility, use MP4 with H.264 video and MP3 audio.`;
              console.warn(`WebviewTransport: ${warningMessage}`);
              if (this.errorHandler) {
                this.errorHandler.handleError({
                  type: 'info',
                  payload: [warningMessage]
                });
              }
            } else {
              // Try webview URI for supported formats
              const videoDir = path.dirname(input.path);
              const currentRoots = firstPanel.webview.options.localResourceRoots ?? [];
              const videoDirUri = vscode.Uri.file(videoDir);
              
              console.log(`WebviewTransport: Video path: ${input.path}`);
              console.log(`WebviewTransport: Video directory: ${videoDir}`);
              console.log(`WebviewTransport: Video directory URI: ${videoDirUri.fsPath}`);
              console.log(`WebviewTransport: Current localResourceRoots:`, currentRoots.map(r => r.fsPath));
              
              const hasVideoDir = currentRoots.some((root: vscode.Uri) => 
                root.fsPath === videoDirUri.fsPath
              );
              
              if (!hasVideoDir) {
                firstPanel.webview.options = {
                  ...firstPanel.webview.options,
                  localResourceRoots: [...currentRoots, videoDirUri]
                };
                console.log(`WebviewTransport: Added video directory to localResourceRoots: ${videoDir}`);
                console.log(`WebviewTransport: Updated localResourceRoots:`, firstPanel.webview.options.localResourceRoots?.map(r => r.fsPath) ?? []);
              }
              
              // Use webview URI for video
              const webviewUri = firstPanel.webview.asWebviewUri(vscode.Uri.file(input.path)).toString();
              console.log(`WebviewTransport: Using webview URI for video: ${webviewUri}`);
              input.path = webviewUri;
              
              // Add error handling for VS Code video limitations
              const errorMessage = `Video may not load in VS Code panel due to format restrictions. For better video support, try opening Shader Studio in it's own window or browser. VS Code supports MP4 (H.264 video + MP3 audio) and WebM (VP8 video + supported audio).`;
              console.warn(`WebviewTransport: ${errorMessage}`);
              if (this.errorHandler) {
                this.errorHandler.handlePersistentError?.({
                  type: 'warning',
                  payload: [errorMessage]
                });
              }
            }
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
