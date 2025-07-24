import * as vscode from "vscode";
import { PanelManager } from "./PanelManager";
import { WebServer } from "./WebServer";
import { ShaderProcessor } from "./ShaderProcessor";
import { Messenger } from "./transport/Messenger";
import { WebSocketTransport } from "./transport/WebSocketTransport";
import { Logger } from "./services/Logger";
import { ElectronLauncher } from "./ElectronLauncher";

export class ShaderView {
  private panelManager: PanelManager;
  private webServer: WebServer;
  private webSocketTransport: WebSocketTransport | null = null;
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
    this.webServer = new WebServer(context);
    this.electronLauncher = new ElectronLauncher(context, this.logger);

    this.startWebSocketTransport();

    this.registerCommands();
    this.registerEventHandlers();
  }

  public initializeDevMode(): void { }

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
    const config = vscode.workspace.getConfiguration('shaderView');
    const webSocketPort = config.get<number>('webSocketPort') || 51472;
    this.webSocketTransport = new WebSocketTransport(webSocketPort, this.shaderProcessor);
    this.messenger.addTransport(this.webSocketTransport);
  }

  private async startWebServer(): Promise<void> {
    this.webServer.startWebServer();
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

  private registerCommands(): void {
    this.context.subscriptions.push(
      vscode.commands.registerCommand("shader-view.view", () => {
        this.logger.info("shader-view.view command executed");
        this.panelManager.createShaderView();
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

      this.performShaderUpdate(editor);
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
        this.performShaderUpdate(editor);
      }
    });
  }

  private performShaderUpdate(editor: vscode.TextEditor): void {
    this.shaderProcessor.sendShaderToWebview(editor);
  }

  private async openInElectron(): Promise<void> {
    await this.electronLauncher.launch();
  }

}
