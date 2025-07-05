import * as vscode from "vscode";
import { PanelManager } from "./PanelManager";
import { WebServerManager } from "./WebServerManager";
import { LockManager } from "./LockManager";

export class ShaderViewController {
  private panelManager: PanelManager;
  private webServerManager: WebServerManager;
  private lockManager: LockManager;
  private context: vscode.ExtensionContext;
  private outputChannel: vscode.LogOutputChannel;

  constructor(
    context: vscode.ExtensionContext,
    outputChannel: vscode.LogOutputChannel,
    diagnosticCollection: vscode.DiagnosticCollection,
    wsPort: number = 8080,
  ) {
    this.context = context;
    this.outputChannel = outputChannel;
    
    this.panelManager = new PanelManager(context, outputChannel, diagnosticCollection);
    this.webServerManager = new WebServerManager(context, outputChannel, diagnosticCollection, wsPort);
    this.lockManager = new LockManager(outputChannel, (editor) => this.sendShaderCallback(editor));
    
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
        this.lockManager.toggleLock();
      }),
    );
  }

  private registerEventHandlers(): void {
    // Update shader when switching active editor
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!editor) return;

      // Check for auto-lock behavior
      if (this.lockManager.shouldAutoLock(editor)) {
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
      const finalEditor = this.lockManager.shouldUseLocked(editor);
      this.lockManager.setCurrentlyPreviewedEditor(finalEditor);
      this.panelManager.sendShaderToWebview(finalEditor, this.lockManager.getIsLocked());
    }
  }

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

  // Web server management methods
  public startWebServer(): void {
    this.webServerManager.startWebServer();
  }

  public stopWebServer(): void {
    this.webServerManager.stopWebServer();
  }

  public sendShaderToWebServer(editor: vscode.TextEditor, isLocked: boolean = false): void {
    this.webServerManager.sendShaderToWebServer(editor, isLocked);
  }

  public sendShaderToBoth(editor: vscode.TextEditor, isLocked: boolean = false): void {
    // Send to panel if it exists
    if (this.panelManager.getPanel()) {
      this.panelManager.sendShaderToWebview(editor, isLocked);
    }

    // Send to web server if it's running
    if (this.webServerManager.isRunning()) {
      this.webServerManager.sendShaderToWebServer(editor, isLocked);
    }
  }

  public isWebServerRunning(): boolean {
    return this.webServerManager.isRunning();
  }
}
