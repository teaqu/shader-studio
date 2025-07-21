import * as vscode from "vscode";
import { PanelManager } from "./PanelManager";
import { WebServer } from "./WebServer";
import { ShaderLocker } from "./ShaderLocker";
import { ShaderProcessor } from "./ShaderProcessor";
import { Messenger } from "./communication/Messenger";
import { Logger } from "./services/Logger";
import { ShaderUtils } from "./util/ShaderUtils";

export class ShaderExtension {
  private panelManager: PanelManager;
  private webServer: WebServer;
  private shaderLocker: ShaderLocker;
  private shaderProcessor: ShaderProcessor;
  private messenger: Messenger;
  private context: vscode.ExtensionContext;
  private logger!: Logger;
  private updateThrottle: NodeJS.Timeout | null = null;

  constructor(
    context: vscode.ExtensionContext,
    outputChannel: vscode.LogOutputChannel,
    diagnosticCollection: vscode.DiagnosticCollection,
  ) {
    this.context = context;

    Logger.initialize(outputChannel);
    this.logger = Logger.getInstance();

    this.messenger = new Messenger(outputChannel, diagnosticCollection);
    this.shaderProcessor = new ShaderProcessor(this.messenger);
    this.panelManager = new PanelManager(context, this.messenger, this.shaderProcessor);
    this.webServer = new WebServer(context, this.messenger, this.shaderProcessor);
    this.shaderLocker = new ShaderLocker((editor: vscode.TextEditor) => this.sendShaderCallback(editor));

    this.registerCommands();
    this.registerEventHandlers();
  }

  public initializeDevMode(): void {
    vscode.commands.executeCommand("shader-view.view");
  }

  public dispose(): void {
    this.webServer.stopWebServer();
    this.logger.info("Shader extension disposed");
  }

  private async startWebServerAndOpenBrowser(): Promise<void> {
    try {
      this.webServer.startWebServer();

      await new Promise(resolve => setTimeout(resolve, 1000));

      const workspaceUri = vscode.Uri.joinPath(this.context.extensionUri, '..');
      const uiPath = vscode.Uri.joinPath(workspaceUri, 'ui', 'dist', 'index.html');

      try {
        await vscode.workspace.fs.stat(uiPath);
      } catch {
        vscode.window.showInformationMessage('Building UI for web server...');
        await this.buildUI();
      }

      const httpUrl = this.webServer.getHttpUrl();
      await vscode.env.openExternal(vscode.Uri.parse(httpUrl));

      vscode.window.showInformationMessage(
        `Shader View web server started on ${httpUrl}. Check the status bar to stop it.`
      );

      const activeEditor = ShaderUtils.getActiveGLSLEditor();
      if (activeEditor && this.webServer.isRunning()) {
        this.webServer.sendShaderToWebServer(activeEditor, this.shaderLocker.getIsLocked());
      }
    } catch (error) {
      this.logger.error(`Failed to start web server: ${error}`);
      vscode.window.showErrorMessage(`Failed to start Shader View web server: ${error}`);
    }
  }

  private async buildUI(): Promise<void> {
    const workspaceUri = vscode.Uri.joinPath(this.context.extensionUri, '..');
    const uiDirectory = vscode.Uri.joinPath(workspaceUri, 'ui');

    const terminal = vscode.window.createTerminal({
      name: 'Shader View Build',
      cwd: uiDirectory.fsPath
    });

    terminal.sendText('npm run build');
    terminal.show();

    await new Promise(resolve => setTimeout(resolve, 10000));
  }

  private registerCommands(): void {
    this.context.subscriptions.push(
      vscode.commands.registerCommand("shader-view.view", () => {
        this.logger.info("shader-view.view command executed");
        this.panelManager.createShaderView();
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shader-view.toggleLock", () => {
        this.shaderLocker.toggleLock();
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shader-view.startWebServer", () => {
        this.logger.info("shader-view.startWebServer command executed");
        this.startWebServerAndOpenBrowser();
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shader-view.stopWebServer", () => {
        this.logger.info("shader-view.stopWebServer command executed");
        this.webServer.stopWebServer();
        vscode.window.showInformationMessage("Shader View web server stopped");
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shader-view.showWebServerMenu", () => {
        this.logger.info("shader-view.showWebServerMenu command executed");
        this.webServer.showWebServerMenu();
      }),
    );
  }

  private registerEventHandlers(): void {
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!editor) {
        return;
      }

      if (this.shaderLocker.shouldAutoLock(editor)) {
        return;
      }

      this.sendShaderCallback(editor);
    });

    vscode.workspace.onDidChangeTextDocument((event) => {
      const editor = vscode.window.activeTextEditor;

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
    if (this.updateThrottle) {
      clearTimeout(this.updateThrottle);
    }

    this.updateThrottle = setTimeout(() => {
      this.performShaderUpdate(editor);
    }, 100);
  }

  private performShaderUpdate(editor: vscode.TextEditor): void {
    const finalEditor = this.shaderLocker.shouldUseLocked(editor);
    this.shaderLocker.setCurrentlyPreviewedEditor(finalEditor);

    const panel = this.panelManager.getPanel();
    if (panel) {
      this.panelManager.sendShaderToWebview(finalEditor, this.shaderLocker.getIsLocked());
      this.logger.info("Shader sent to webview panel");
    }

    if (this.webServer.isRunning()) {
      this.webServer.sendShaderToWebServer(finalEditor, this.shaderLocker.getIsLocked());
      this.logger.info("Shader sent to web server");
    }

    this.logger.info(`Shader update: Panel=${!!panel}, WebServer=${this.webServer.isRunning()}`);
  }

}
