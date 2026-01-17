import * as vscode from "vscode";
import { MessageEvent, LogMessage, DebugMessage, ErrorMessage, RefreshMessage, GenerateConfigMessage, ShowConfigMessage } from "@shader-studio/types";

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
        case "generateConfig":
          this.handleGenerateConfigMessage(message);
          break;
        case "showConfig":
          this.handleShowConfigMessage(message);
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
      vscode.commands.executeCommand('shader-studio.refreshSpecificShaderByPath', shaderPath);
    } else {
      this.outputChannel.info("Requesting refresh for current/active shader");
      vscode.commands.executeCommand('shader-studio.refreshCurrentShader');
    }
  }

  private handleGenerateConfigMessage(message: GenerateConfigMessage): void {
    this.outputChannel.info("Generate config request received from UI");

    const shaderPath = message.payload?.shaderPath;
    if (shaderPath) {
      this.outputChannel.info(`Requesting config generation for shader at path: ${shaderPath}`);
      vscode.commands.executeCommand('shader-studio.generateConfigFromUI', vscode.Uri.file(shaderPath));
    } else {
      this.outputChannel.info("Requesting config generation for current/last viewed shader");
      vscode.commands.executeCommand('shader-studio.generateConfigFromUI');
    }
  }

  private handleShowConfigMessage(message: ShowConfigMessage): void {
    this.outputChannel.info("Show config request received from UI");

    const configPath = message.payload?.shaderPath;
    if (configPath) {
      this.outputChannel.info(`Requesting to open config at path: ${configPath}`);
      
      // Check if config file exists
      const fs = require('fs');
      if (fs.existsSync(configPath)) {
        // Open the existing config file
        vscode.commands.executeCommand('vscode.open', vscode.Uri.file(configPath));
        this.outputChannel.info(`Opened existing config file: ${configPath}`);
      } else {
        // Config doesn't exist, generate it
        this.outputChannel.info(`Config file not found: ${configPath}, generating new config`);
        // Convert config path back to shader path
        const shaderPath = configPath.replace(/\.sha\.json$/, '.glsl');
        vscode.commands.executeCommand('shader-studio.generateConfigFromUI', vscode.Uri.file(shaderPath));
      }
    } else {
      this.outputChannel.info("No config path provided, requesting config generation");
      vscode.commands.executeCommand('shader-studio.generateConfigFromUI');
    }
  }
}
