import * as vscode from "vscode";
import { PanelManager } from "./PanelManager";
import { WebServer } from "./WebServer";
import { ShaderLocker } from "./ShaderLocker";
import { MessageTransporter } from "./communication/MessageTransporter";

export class ShaderExtension {
  private panelManager: PanelManager;
  private webServer: WebServer;
  private shaderLocker: ShaderLocker;
  private messageTransporter: MessageTransporter;
  private context: vscode.ExtensionContext;
  private outputChannel: vscode.LogOutputChannel;

  constructor(
    context: vscode.ExtensionContext,
    outputChannel: vscode.LogOutputChannel,
    diagnosticCollection: vscode.DiagnosticCollection,
  ) {
    this.context = context;
    this.outputChannel = outputChannel;
    
    // Create centralized message transporter
    this.messageTransporter = new MessageTransporter(outputChannel, diagnosticCollection);
    
    this.panelManager = new PanelManager(context, this.messageTransporter, outputChannel);
    this.webServer = new WebServer(context, this.messageTransporter, outputChannel);
    this.shaderLocker = new ShaderLocker(outputChannel, (editor) => this.sendShaderCallback(editor));
    
    this.registerCommands();
    this.registerEventHandlers();
  }

  private registerCommands(): void {
    this.context.subscriptions.push(
      vscode.commands.registerCommand("shader-view.view", () => {
        this.outputChannel.info("shader-view.view command executed");

        const editor = vscode.window.activeTextEditor ??
          vscode.window.visibleTextEditors.find((e) =>
            e.document.languageId === "glsl" ||
            e.document.fileName.endsWith(".glsl")
          );
        if (!editor) {
          vscode.window.showErrorMessage("No active GLSL file selected");
          return;
        }

        this.panelManager.createWebviewPanel(editor);
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shader-view.toggleLock", () => {
        this.shaderLocker.toggleLock();
      }),
    );
  }

  private registerEventHandlers(): void {
    // Update shader when switching active editor
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!editor) return;

      // Check for auto-lock behavior
      if (this.shaderLocker.shouldAutoLock(editor)) {
        return; // Don't update the shader, keep showing the locked one
      }

      this.sendShaderCallback(editor);
    });

    // Update shader as it's edited
    vscode.workspace.onDidChangeTextDocument((event) => {
      const editor = vscode.window.activeTextEditor;

      // Only process GLSL files
      if (
        event.document.languageId !== "glsl" &&
        !event.document.fileName.endsWith(".glsl")
      ) {
        return;
      }

      if (editor) {
        this.sendShaderCallback(editor);
      }
    });
  }

  private sendShaderCallback(editor: vscode.TextEditor): void {
    const panel = this.panelManager.getPanel();
    if (panel) {
      const finalEditor = this.shaderLocker.shouldUseLocked(editor);
      this.shaderLocker.setCurrentlyPreviewedEditor(finalEditor);
      this.panelManager.sendShaderToWebview(finalEditor, this.shaderLocker.getIsLocked());
    }
  }

  public dispose(): void {
    // Clean up resources when extension is deactivated
    this.webServer.stopWebServer();
    this.outputChannel.info("Shader extension disposed");
  }

  // Dev mode initialization
  public initializeDevMode(): void {
    // Close all empty editor groups (usually left from webview reloads)
    const layout = vscode.window.tabGroups.all;

    for (const group of layout) {
      if (group.tabs.length === 0) {
        vscode.window.tabGroups.close(group);
      }
    }

    // Then open the panel cleanly
    vscode.commands.executeCommand("shader-view.view");
  }

  // Public API for external access (if needed)
  public startWebSocketServer(): void {
    this.webServer.startWebServer();
  }

  public stopWebSocketServer(): void {
    this.webServer.stopWebServer();
  }

  public isWebSocketServerRunning(): boolean {
    return this.webServer.isRunning();
  }

  public getMessageTransporter(): MessageTransporter {
    return this.messageTransporter;
  }
}
