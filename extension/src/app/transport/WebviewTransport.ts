import * as vscode from "vscode";
import * as path from "path";
import { MessageTransport } from "./MessageTransport";
import { ConfigPathConverter } from "./ConfigPathConverter";
import { PathResolver } from "../PathResolver";
import { Logger } from "../services/Logger";

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
      Logger.debug(`Webview panel disposed. Remaining panels: ${this.panels.size}`);
    });
  }

  public removePanel(panel: vscode.WebviewPanel): void {
    this.panels.delete(panel);
  }

  public send(message: any): void {
    Logger.trace(`WebviewTransport: send() called with message type: ${message.type}`);

    if (message.type === "shaderSource" && message.config) {
      // Process config paths asynchronously before posting to the webview.
      this.sendShaderSourceAsync(message);
      return;
    }

    this.postToAllPanels(message);
  }

  private async sendShaderSourceAsync(message: any): Promise<void> {
    Logger.trace(`WebviewTransport: Processing shaderSource message with config`);
    const firstPanel = this.panels.values().next().value;
    if (firstPanel?.webview) {
      Logger.trace(`WebviewTransport: Calling ConfigPathConverter.processConfigPaths`);
      message = await ConfigPathConverter.processConfigPaths(message, firstPanel.webview);

      // Handle video-specific localResourceRoots for webview
      this.handleVideoResourceRoots(message);

      Logger.trace(`WebviewTransport: ConfigPathConverter returned processed message`);
    } else {
      Logger.trace(`WebviewTransport: No webview panel available for path conversion`);
    }

    this.postToAllPanels(message);
  }

  private postToAllPanels(message: any): void {
    let sentCount = 0;
    const totalPanels = this.panels.size;

    Logger.trace(`Webview: Sending ${message.type} to ${totalPanels} panels`);

    for (const panel of this.panels) {
      try {
        if (panel.webview) {
          panel.webview.postMessage(message);
          sentCount++;
        } else {
          this.panels.delete(panel); // Clean up disposed panels
        }
      } catch (error) {
        Logger.debug('Webview transport: panel disposed, message not sent');
        this.panels.delete(panel);
      }
    }

    Logger.trace(`Webview: Sent to ${sentCount}/${totalPanels} panels`);
  }

  private handleVideoResourceRoots(message: any): void {
    if (!message.config?.passes) {
      return;
    }

    const firstPanel = this.panels.values().next().value;
    if (!firstPanel?.webview) {
      return;
    }

    // Collect paths for all resources that reference local files.
    const inputPaths: string[] = [];

    for (const passName of Object.keys(message.config.passes)) {
      const pass = message.config.passes[passName];
      if (pass?.geometry?.type === 'model' && pass.geometry.path) {
        inputPaths.push(pass.geometry.path);
      }
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
