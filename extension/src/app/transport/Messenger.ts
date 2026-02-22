import * as vscode from "vscode";
import { MessageHandler } from "./MessageHandler";
import { MessageTransport } from "./MessageTransport";
import { ErrorHandler } from "../ErrorHandler";

export class Messenger {
  private messageHandler: MessageHandler;
  private errorHandler: ErrorHandler;
  private transports: MessageTransport[] = [];

  constructor(
    outputChannel: vscode.LogOutputChannel,
    errorHandler: ErrorHandler,
    onDebugModeChanged?: (enabled: boolean) => void
  ) {
    this.errorHandler = errorHandler;
    this.messageHandler = new MessageHandler(outputChannel, errorHandler, onDebugModeChanged);
  }

  public getErrorHandler(): ErrorHandler {
    return this.errorHandler;
  }

  public send(message: any): void {
    try {
      // Track shader config for error attribution
      if (message.type === "shaderSource") {
        this.errorHandler.setShaderConfig({
          config: message.config,
          shaderPath: message.path,
          bufferPathMap: message.bufferPathMap,
        });
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
    this.transports.forEach(transport => transport.close());
  }

  public addTransport(transport: MessageTransport): void {
    this.transports.push(transport);
    transport.onMessage((message) => this.messageHandler.handleMessage(message));
  }

  public removeTransport(transport: MessageTransport): void {
    const index = this.transports.indexOf(transport);
    if (index > -1) {
      this.transports.splice(index, 1);
    }
  }

  public hasActiveClients(): boolean {
    return this.transports.some(transport => transport.hasActiveClients());
  }

  public getWebview(): any | null {
    // Get the first webview from WebviewTransport
    for (const transport of this.transports) {
      if ('getWebview' in transport && typeof (transport as any).getWebview === 'function') {
        const webview = (transport as any).getWebview();
        if (webview) {
          return webview;
        }
      }
    }
    return null;
  }
}
