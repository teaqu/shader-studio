import * as vscode from "vscode";
import { ShaderProcessor } from "./ShaderProcessor";
import { Messenger } from "./communication/Messenger";
import { WebSocketTransport } from "./communication/WebSocketTransport";
import { Logger } from "./services/Logger";

export class WebServer {
  private wsPort: number = 8080;
  private logger!: Logger;
  private isServerRunning = false;

  constructor(
    private context: vscode.ExtensionContext,
    private messenger: Messenger,
    private shaderProcessor: ShaderProcessor,
  ) {
    this.logger = Logger.getInstance();
  }

  public startWebServer(): void {
    // will create an actual webserver at some when ready...

    if (this.isServerRunning) {
      this.logger.info("Web server already running");
      return;
    }

    try {
      // Add WebSocket transport to the shared message transporter
      const wsTransport = new WebSocketTransport(this.wsPort);
      this.messenger.addTransport(wsTransport);
      
      this.isServerRunning = true;

      this.logger.info(`WebSocket server started on port ${this.wsPort}`);
    } catch (error) {
      this.logger.error(`Failed to start WebSocket server: ${error}`);
    }
  }

  public stopWebServer(): void {
    if (this.isServerRunning) {
      this.messenger.close();
      this.isServerRunning = false;
      this.logger.info("WebSocket server stopped");
    }
  }

  public sendShaderToWebServer(editor: vscode.TextEditor, isLocked: boolean = false): void {
    if (this.isServerRunning) {
      this.shaderProcessor.sendShaderToWebview(editor, isLocked);
      this.logger.info("Shader sent to web server clients");
    } else {
      this.logger.warn("Web server not running");
    }
  }

  public isRunning(): boolean {
    return this.isServerRunning;
  }
}
