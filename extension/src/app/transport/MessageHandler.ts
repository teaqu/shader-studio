import * as vscode from "vscode";

export class MessageHandler {
  constructor(
    private outputChannel: vscode.LogOutputChannel,
    private diagnosticCollection: vscode.DiagnosticCollection,
  ) { }

  public handleMessage(message: any): void {
    try {
      switch (message.type) {
        case "log":
          this.handleLogMessage(message);
          break;
        case "debug":
          this.handleDebugMessage(message);
          break;
        case "error":
          this.handleErrorMessage(message);
          break;
        default:
          this.outputChannel.debug(`Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error('MessageHandler: Error processing message:', error);
      console.error('Message:', message);
      this.outputChannel.error(`Message handling error: ${error}`);
    }
  }

  private handleLogMessage(message: any): void {
    const logText = message.payload.join
      ? message.payload.join(" ")
      : message.payload;
    this.outputChannel.info(logText);

    if (
      logText.includes("Shader compiled and linked") &&
      vscode.window.activeTextEditor?.document.languageId === "glsl"
    ) {
      this.diagnosticCollection.delete(
        vscode.window.activeTextEditor.document.uri,
      );
    }
  }

  private handleDebugMessage(message: any): void {
    const debugText = message.payload.join
      ? message.payload.join(" ")
      : message.payload;
    this.outputChannel.debug(debugText);
  }

  private handleErrorMessage(message: any): void {
    let errorText = message.payload.join
      ? message.payload.join(" ")
      : message.payload;
    errorText = errorText.slice(0, -1);
    this.outputChannel.error(errorText);

    const match = errorText.match(/ERROR:\s*\d+:(\d+):/);
    const editor = vscode.window.activeTextEditor;
    if (match && editor && editor.document.languageId === "glsl") {
      const lineNum = parseInt(match[1], 10) - 1; // VS Code is 0-based
      const range = editor.document.lineAt(lineNum).range;

      const diagnostic = new vscode.Diagnostic(
        range,
        errorText,
        vscode.DiagnosticSeverity.Error,
      );
      this.diagnosticCollection.set(editor.document.uri, [diagnostic]);
    } else if (editor) {
      this.diagnosticCollection.delete(editor.document.uri);
    }
  }
}
