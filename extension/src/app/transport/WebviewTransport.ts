import * as vscode from "vscode";
import * as path from "path";
import { MessageTransport } from "./MessageTransport";
import { ConfigPathConverter } from "./ConfigPathConverter";
import { PathResolver } from "../PathResolver";
import { VideoAudioConverter } from "../services/VideoAudioConverter";

export class WebviewTransport implements MessageTransport {
  private messageHandler?: (message: any) => void;
  private panels: Set<vscode.WebviewPanel> = new Set();
  private videoAudioConverter?: VideoAudioConverter;
  private onVideoConverted?: (originalConfigPath: string, convertedAbsolutePath: string) => void;

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

  public setVideoAudioConverter(converter: VideoAudioConverter): void {
    this.videoAudioConverter = converter;
  }

  public setOnVideoConverted(callback: (originalConfigPath: string, convertedAbsolutePath: string) => void): void {
    this.onVideoConverted = callback;
  }

  /** High-frequency message types that should not be logged */
  private static readonly QUIET_TYPES = new Set(['customUniformValues']);

  public send(message: any): void {
    if (!WebviewTransport.QUIET_TYPES.has(message.type)) {
      console.log(`WebviewTransport: send() called with message type: ${message.type}`);
    }

    if (message.type === "shaderSource" && message.config) {
      // Process config paths async (video audio conversion may be needed)
      this.sendShaderSourceAsync(message);
      return;
    }

    this.postToAllPanels(message);
  }

  private async sendShaderSourceAsync(message: any): Promise<void> {
    console.log(`WebviewTransport: Processing shaderSource message with config`);
    const firstPanel = this.panels.values().next().value;
    if (firstPanel?.webview) {
      console.log(`WebviewTransport: Calling ConfigPathConverter.processConfigPaths`);
      message = await ConfigPathConverter.processConfigPaths(message, firstPanel.webview, {
        videoAudioConverter: this.videoAudioConverter,
        onVideoConverted: this.onVideoConverted,
      });

      // Handle video-specific localResourceRoots for webview
      this.handleVideoResourceRoots(message);

      console.log(`WebviewTransport: ConfigPathConverter returned processed message`);
    } else {
      console.log(`WebviewTransport: No webview panel available for path conversion`);
    }

    this.postToAllPanels(message);
  }

  private postToAllPanels(message: any): void {
    let sentCount = 0;
    const totalPanels = this.panels.size;

    const quiet = WebviewTransport.QUIET_TYPES.has(message.type);
    if (!quiet) {
      console.log(`Webview: Sending ${message.type} to ${totalPanels} panels`);
    }

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

    if (!quiet) {
      console.log(`Webview: Sent to ${sentCount}/${totalPanels} panels`);
    }
  }

  private handleVideoResourceRoots(message: any): void {
    if (!message.config?.passes) {
      return;
    }

    const firstPanel = this.panels.values().next().value;
    if (!firstPanel?.webview) {
      return;
    }

    // Collect paths for all input types that reference local files
    const inputPaths: string[] = [];

    for (const passName of Object.keys(message.config.passes)) {
      const pass = message.config.passes[passName];
      if (!pass?.inputs) {
        continue;
      }

      for (const key of Object.keys(pass.inputs)) {
        const input = pass.inputs[key];
        if (input?.path && (input.type === "video" || input.type === "texture" || input.type === "audio" || input.type === "cubemap")) {
          // If path is already a webview URI, we can't extract the original path easily
          // So we'll skip localResourceRoots handling for webview URIs
          if (!input.path.startsWith('vscode-webview://')) {
            inputPaths.push(input.path);
          }
        }
      }
    }

    // Add input directories to localResourceRoots
    const shaderPath = message.path || '';
    for (const inputPath of inputPaths) {
      // Resolve @ and relative paths to absolute
      const resolvedPath = shaderPath ? PathResolver.resolvePath(shaderPath, inputPath) : inputPath;
      const inputDir = path.dirname(resolvedPath);
      const currentRoots = firstPanel.webview.options.localResourceRoots ?? [];
      const inputDirUri = vscode.Uri.file(inputDir);

      const hasInputDir = currentRoots.some((root: vscode.Uri) =>
        root.fsPath === inputDirUri.fsPath
      );

      if (!hasInputDir) {
        firstPanel.webview.options = {
          ...firstPanel.webview.options,
          localResourceRoots: [...currentRoots, inputDirUri]
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

  public hasActiveClients(): boolean {
    return this.panels.size > 0;
  }

  public getWebview(): vscode.Webview | null {
    const firstPanel = this.panels.values().next().value;
    return firstPanel?.webview ?? null;
  }
}
