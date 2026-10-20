import { resolveGpuBackpressure } from "@shader-studio/types";
import * as vscode from "vscode";
import { PreviewRegistry } from '../mcp/PreviewRegistry';
import { mcpLogs } from '../mcp/McpLogs';
import { MessageHandler } from "./MessageHandler";
import { MessageTransport } from "./MessageTransport";
import { ErrorHandler } from "../ErrorHandler";
import { publishLoadedShaderProjectSnapshot } from "../../language-services/ShaderAuthoringEnvironmentProvider";

interface WebviewTransportLike extends MessageTransport {
  getWebview(): vscode.Webview | null;
}

function hasWebview(transport: MessageTransport): transport is WebviewTransportLike {
  return "getWebview" in transport
    && typeof (transport as Partial<WebviewTransportLike>).getWebview === "function";
}

export class Messenger {
  private previewRegistry?: PreviewRegistry;

  public get previews(): PreviewRegistry {
    if (!this.previewRegistry) {
      throw new Error('MCP preview tracking is disabled.');
    }
    return this.previewRegistry;
  }

  public setMcpEnabled(enabled: boolean): void {
    if (enabled === Boolean(this.previewRegistry)) {
      return;
    }
    if (enabled) {
      this.previewRegistry = new PreviewRegistry();
    } else {
      this.previewRegistry?.dispose();
      this.previewRegistry = undefined;
    }
    mcpLogs.setEnabled(enabled);
    for (const transport of this.transports) {
      transport.attachPreviewRegistry?.(this.previewRegistry);
    }
  }
  private compileSequences = new Map<string, number>();

  public getCompileSequence(path: string): number | undefined {
    return this.compileSequences.get(path);
  }
  private messageHandler: MessageHandler;
  private errorHandler: ErrorHandler;
  private transports: MessageTransport[] = [];
  private settingsListener: vscode.Disposable | undefined;

  private getGpuDefaults() {
    const config = vscode.workspace.getConfiguration("shader-studio");
    return resolveGpuBackpressure({
      framesInFlight: config.get<number>("gpuBackpressure.framesInFlight"),
      stallTimeoutMs: config.get<number>("gpuBackpressure.stallTimeoutMs"),
    });
  }

  constructor(
    outputChannel: vscode.LogOutputChannel,
    errorHandler: ErrorHandler,
    onDebugModeChanged?: (enabled: boolean) => void,
    onShaderLockChanged?: (lockedShaderPath?: string) => void,
  ) {
    this.errorHandler = errorHandler;
    this.settingsListener = vscode.workspace.onDidChangeConfiguration?.((event) => {
      if (event.affectsConfiguration("shader-studio.gpuBackpressure")) {
        this.send({ type: "gpuBackpressureSettings", defaults: this.getGpuDefaults() });
      }
    });
    this.messageHandler = new MessageHandler(
      outputChannel,
      errorHandler,
      onDebugModeChanged,
      onShaderLockChanged,
    );
  }

  public getErrorHandler(): ErrorHandler {
    return this.errorHandler;
  }

  // The transport envelope is intentionally opaque until its `type` is routed.
  public async send(message: any, previewId?: string): Promise<void> {
    try {
      // Track shader config for error attribution
      if (message.type === "shaderSource") {
        if (typeof message.path === 'string' && typeof message.compileSequence === 'number') {
          this.compileSequences.set(message.path, message.compileSequence);
        }
        message = { ...message, gpuBackpressureDefaults: this.getGpuDefaults() };
        this.errorHandler.setShaderConfig({
          config: message.config,
          shaderPath: message.path,
          bufferPathMap: message.bufferPathMap,
          compileSequence: message.compileSequence,
        });
        if (message.config && message.path && this.hasActiveClients()) {
          publishLoadedShaderProjectSnapshot(message.path, message.config);
        }
      }

      if (previewId) {
        await this.previews.sendSource(previewId, message);
        return;
      }
      // Send to all transports
      this.transports.forEach((transport, index) => {
        try {
          transport.send(message);
        } catch (error) {
          console.error(`Messenger: Error sending to transport ${index}:`, error);
        }
      });
    } catch (error) {
      console.error('Messenger: Error in send method:', error);
    }
  }

  public close(): void {
    this.setMcpEnabled(false);
    this.settingsListener?.dispose();
    this.settingsListener = undefined;
    this.transports.forEach(transport => transport.close());
  }

  public addTransport(transport: MessageTransport): void {
    if (this.previewRegistry) {
      transport.attachPreviewRegistry?.(this.previewRegistry);
    }
    this.transports.push(transport);
    transport.onMessage((message) => this.messageHandler.handleMessage(message));
  }

  public removeTransport(transport: MessageTransport): void {
    const index = this.transports.indexOf(transport);
    if (index > -1) {
      transport.attachPreviewRegistry?.(undefined);
      this.transports.splice(index, 1);
    }
  }

  public hasActiveClients(): boolean {
    return this.transports.some(transport => transport.hasActiveClients());
  }

  public getWebview(): vscode.Webview | null {
    // Get the first webview from WebviewTransport
    for (const transport of this.transports) {
      if (hasWebview(transport)) {
        const webview = transport.getWebview();
        if (webview) {
          return webview;
        }
      }
    }
    return null;
  }
}
