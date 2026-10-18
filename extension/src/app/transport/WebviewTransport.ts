import * as vscode from "vscode";
import { randomUUID } from 'node:crypto';
import type { PreviewRegistry } from '../mcp/PreviewRegistry';
import * as path from "path";
import { MessageTransport } from "./MessageTransport";
import { ConfigPathConverter } from "./ConfigPathConverter";
import { PathResolver } from "../PathResolver";
import { Logger } from "../services/Logger";

export class WebviewTransport implements MessageTransport {
  // VS Code delivers untyped JSON from independently versioned webviews.
  private messageHandler?: (message: any) => void;
  private panels: Set<vscode.WebviewPanel> = new Set();
  private previewRegistry?: PreviewRegistry;
  private previewIds = new Map<vscode.WebviewPanel, string>();
  private previewCleanups = new Map<vscode.WebviewPanel, () => void>();

  public attachPreviewRegistry(registry: PreviewRegistry | undefined): void {
    if (this.previewRegistry === registry) {
      return;
    }
    for (const cleanup of this.previewCleanups.values()) {
      cleanup();
    }
    this.previewCleanups.clear();
    this.previewIds.clear();
    this.previewRegistry = registry;
    for (const panel of this.panels) {
      this.registerPreview(panel);
    }
  }

  private registerPreview(panel: vscode.WebviewPanel): void {
    if (!this.previewRegistry || this.previewCleanups.has(panel)) {
      return;
    }
    const id = randomUUID();
    this.previewIds.set(panel, id);
    this.previewCleanups.set(panel, this.previewRegistry.register({
      id, kind: 'webview', send: message => {
        void panel.webview.postMessage(message);
      },
      sendSource: async message => {
        if ((message as { type?: string }).type === 'shaderSource') {
          const converted = await ConfigPathConverter.processConfigPaths(message as any, panel.webview);
          this.handleVideoResourceRoots(converted);
          await panel.webview.postMessage(converted);
        } else {
          await panel.webview.postMessage(message);
        }
      },
    }));
  }

  public addPanel(panel: vscode.WebviewPanel): void {
    this.panels.add(panel);
    this.registerPreview(panel);

    panel.webview.onDidReceiveMessage(
      (message) => {
        this.previewRegistry?.receive(this.previewIds.get(panel) ?? '', message);
        if (message.type === 'viewerRpcResponse') {
          return;
        }
        this.messageHandler?.(message);
      },
      null,
      []
    );

    panel.onDidDispose(() => {
      this.removePanel(panel);
      Logger.debug(`Webview panel disposed. Remaining panels: ${this.panels.size}`);
    });
  }

  public removePanel(panel: vscode.WebviewPanel): void {
    this.previewCleanups.get(panel)?.();
    this.previewCleanups.delete(panel);
    this.previewIds.delete(panel);
    this.panels.delete(panel);
  }

  // Outgoing messages preserve optional fields from the shared protocol.
  public send(message: any): void {
    Logger.trace(`WebviewTransport: send() called with message type: ${message.type}`);

    if (message.type === "shaderSource" && message.config) {
      // Process config paths asynchronously before posting to the webview.
      this.sendShaderSourceAsync(message);
      return;
    }

    this.postToAllPanels(message);
  }

  // ConfigPathConverter augments the complete shader-source envelope.
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

  // Webview.postMessage accepts the protocol envelope unchanged.
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
          this.removePanel(panel); // Clean up disposed panels
        }
      } catch (error) {
        Logger.debug('Webview transport: panel disposed, message not sent');
        this.removePanel(panel);
      }
    }

    Logger.trace(`Webview: Sent to ${sentCount}/${totalPanels} panels`);
  }

  // Shader config extensions are carried alongside the source message.
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

    for (const declaration of Object.values<{ initialDataPath?: unknown }>(message.config.storage ?? {})) {
      if (typeof declaration?.initialDataPath === 'string' && declaration.initialDataPath) {
        inputPaths.push(declaration.initialDataPath);
      }
    }

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
        if (input?.path && (input.type === "video" || input.type === "texture" || input.type === "audio" || input.type === "cubemap" || input.type === "volume")) {
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
      this.removePanel(panel);
    }
    this.panels.clear();
  }

  // Incoming payload validation belongs to the command handler.
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
