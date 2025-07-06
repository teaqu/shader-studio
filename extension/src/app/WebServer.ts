import * as vscode from "vscode";
import { ShaderProcessor } from "./ShaderProcessor";
import { MessageTransporter } from "./communication/MessageTransporter";
import { WebSocketTransport } from "./communication/WebSocketTransport";

export class WebServer {
  private messenger: MessageTransporter | undefined;
  private shaderProcessor: ShaderProcessor;
  private wsPort: number = 8080;

  constructor(
    private context: vscode.ExtensionContext,
    private messageTransporter: MessageTransporter,
    private outputChannel: vscode.LogOutputChannel,
  ) {
    this.shaderProcessor = new ShaderProcessor(outputChannel);
  }

  public startWebServer(): void {
    // will create an actual webserver at some when ready...

    if (this.messenger) {
      this.outputChannel.info("Web server already running");
      return;
    }

    try {
      // Add WebSocket transport to the shared message transporter
      const wsTransport = new WebSocketTransport(this.wsPort);
      this.messageTransporter.addTransport(wsTransport);
      
      this.messenger = this.messageTransporter;

      this.outputChannel.info(`WebSocket server started on port ${this.wsPort}`);
    } catch (error) {
      this.outputChannel.error(`Failed to start WebSocket server: ${error}`);
    }
  }

  public stopWebServer(): void {
    if (this.messenger) {
      this.messenger.close();
      this.messenger = undefined;
      this.outputChannel.info("WebSocket server stopped");
    }
  }

  public sendShaderToWebServer(editor: vscode.TextEditor, isLocked: boolean = false): void {
    if (this.messenger) {
      this.shaderProcessor.sendShaderToWebview(editor, this.messenger, isLocked);
      this.outputChannel.info("Shader sent to web server clients");
    } else {
      this.outputChannel.warn("Web server not running");
    }
  }

  public isRunning(): boolean {
    return this.messenger !== undefined;
  }
}
