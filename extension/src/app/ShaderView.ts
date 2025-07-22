import * as vscode from "vscode";
import { PanelManager } from "./PanelManager";
import { WebServer } from "./WebServer";
import { ShaderLocker } from "./ShaderLocker";
import { ShaderProcessor } from "./ShaderProcessor";
import { Messenger } from "./communication/Messenger";
import { WebSocketTransport } from "./communication/WebSocketTransport";
import { Logger } from "./services/Logger";
import { ShaderUtils } from "./util/ShaderUtils";
import { ElectronLauncher } from "./ElectronLauncher";

export class ShaderExtension {
  private panelManager: PanelManager;
  private webServer: WebServer;
  private webSocketTransport: WebSocketTransport | null = null;
  private shaderLocker: ShaderLocker;
  private shaderProcessor: ShaderProcessor;
  private messenger: Messenger;
  private context: vscode.ExtensionContext;
  private logger!: Logger;
  private electronLauncher: ElectronLauncher;

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
    this.electronLauncher = new ElectronLauncher(context, this.logger);

    this.startWebSocketTransport();

    this.registerCommands();
    this.registerEventHandlers();
  }

  public initializeDevMode(): void {
    vscode.commands.executeCommand("shader-view.view");
  }

  public dispose(): void {
    this.webServer.stopWebServer();
    if (this.webSocketTransport) {
      this.messenger.removeTransport(this.webSocketTransport);
      this.webSocketTransport.close();
      this.webSocketTransport = null;
    }
    this.logger.info("Shader extension disposed");
  }

  private startWebSocketTransport(): void {
    try {
      this.webSocketTransport = new WebSocketTransport(51472);
      this.messenger.addTransport(this.webSocketTransport);
      this.logger.info("WebSocket transport started");
    } catch (error) {
      this.logger.error(`Failed to start WebSocket transport: ${error}`);
    }
  }

  private async startWebServer(): Promise<void> {
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

      vscode.window.showInformationMessage(
        `Shader View web server started.`
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

  private async openInBrowser(): Promise<void> {
    if (!this.webServer.isRunning()) {
      vscode.window.showWarningMessage('Web server is not running. Start the server first.');
      return;
    }

    try {
      const httpUrl = this.webServer.getHttpUrl();
      await vscode.env.openExternal(vscode.Uri.parse(httpUrl));
    } catch (error) {
      this.logger.error(`Failed to open browser: ${error}`);
      vscode.window.showErrorMessage(`Failed to open browser: ${error}`);
    }
  }

  private async copyServerUrl(): Promise<void> {
    if (!this.webServer.isRunning()) {
      vscode.window.showWarningMessage('Web server is not running. Start the server first.');
      return;
    }

    try {
      const httpUrl = this.webServer.getHttpUrl();
      await vscode.env.clipboard.writeText(httpUrl);
      vscode.window.showInformationMessage(`Server URL copied to clipboard: ${httpUrl}`);
    } catch (error) {
      this.logger.error(`Failed to copy URL: ${error}`);
      vscode.window.showErrorMessage(`Failed to copy URL: ${error}`);
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
        this.startWebServer();
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shader-view.openInBrowser", () => {
        this.logger.info("shader-view.openInBrowser command executed");
        this.openInBrowser();
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shader-view.copyServerUrl", () => {
        this.logger.info("shader-view.copyServerUrl command executed");
        this.copyServerUrl();
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

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shader-view.showShaderViewMenu", () => {
        this.logger.info("shader-view.showShaderViewMenu command executed");
        this.webServer.getStatusBar().showShaderViewMenu();
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shader-view.openInElectron", () => {
        this.logger.info("shader-view.openInElectron command executed");
        this.openInElectron();
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
    this.performShaderUpdate(editor);
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

  private async openInElectron(): Promise<void> {
    await this.electronLauncher.launch();
  }

}
