import * as vscode from "vscode";
import { MessageEvent, LogMessage, DebugMessage, ErrorMessage, RefreshMessage } from "@shadera/types";

export class MessageHandler {
  constructor(
    private outputChannel: vscode.LogOutputChannel,
    private diagnosticCollection: vscode.DiagnosticCollection,
  ) { }

  public handleMessage(message: MessageEvent): void {
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
        case "refresh":
          this.handleRefreshMessage(message);
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

  private handleLogMessage(message: LogMessage): void {
    const logText = Array.isArray(message.payload)
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

  private handleDebugMessage(message: DebugMessage): void {
    const debugText = Array.isArray(message.payload)
      ? message.payload.join(" ")
      : message.payload;
    this.outputChannel.debug(debugText);
  }

  private handleErrorMessage(message: ErrorMessage): void {
    let errorText = Array.isArray(message.payload)
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

  private handleRefreshMessage(message: RefreshMessage): void {
    this.outputChannel.info("Refresh request received from UI");

    const shaderPath = message.payload?.path;
    if (shaderPath) {
      this.outputChannel.info(`Requesting refresh for shader at path: ${shaderPath}`);
      vscode.commands.executeCommand('shadera.refreshSpecificShaderByPath', shaderPath);
    } else {
      this.outputChannel.info("Requesting refresh for current/active shader");
      vscode.commands.executeCommand('shadera.refreshCurrentShader');
    }
  }
}
