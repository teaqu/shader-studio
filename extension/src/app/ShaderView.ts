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
    try {

      const path = await import('path');

      this.logger.info(`Attempting to launch Electron (always on top) with URL: http://localhost:3000`);

      const extensionDir = path.dirname(this.context.extensionUri.fsPath);
      const extensionSubDir = path.join(extensionDir, 'extension');
      const localElectronPath = path.join(extensionSubDir, 'node_modules', '.bin', 'electron');
      const launcherScript = path.join(extensionSubDir, 'src', 'electron', 'electron-launch.js');
      this.logger.info(`Checking Electron binary at: ${localElectronPath}`);
      this.logger.info(`Checking launcher script at: ${launcherScript}`);
      this.logger.info(`Terminal working directory: ${extensionSubDir}`);

      const terminal = vscode.window.createTerminal({
        name: 'Open in Electron',
        cwd: extensionSubDir,
        hideFromUser: true
      });
      terminal.sendText(`"${localElectronPath}" "${launcherScript}" http://localhost:3000`);

      this.logger.info('Opened VS Code terminal to launch Electron with always-on-top.');
      vscode.window.showInformationMessage('Opened terminal to launch Electron (always on top) for http://localhost:3000');

    } catch (error) {
      this.logger.error(`Failed to launch Electron: ${error}`);
      vscode.window.showErrorMessage(`Failed to launch Electron: ${error}`);
    }
  }

}
