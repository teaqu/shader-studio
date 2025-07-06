import * as vscode from "vscode";
import { ShaderProcessor } from "../ShaderProcessor";
import { MessageSender } from "./MessageSender";

export class WebServer {
  private messenger: MessageSender | undefined;
  private shaderProcessor: ShaderProcessor;

  constructor(
    private context: vscode.ExtensionContext,
    private outputChannel: vscode.LogOutputChannel,
    private diagnosticCollection: vscode.DiagnosticCollection,
    private wsPort: number = 8080,
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
      this.messenger = new MessageSender(
        this.outputChannel,
        this.diagnosticCollection,
        undefined, // no panel
        this.wsPort
      );

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
