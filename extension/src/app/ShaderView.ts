import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { PanelManager } from "./PanelManager";
import { WebServer } from "./WebServer";
import { ShaderProcessor } from "./ShaderProcessor";
import { Messenger } from "./transport/Messenger";
import { WebSocketTransport } from "./transport/WebSocketTransport";
import { Logger } from "./services/Logger";
import { ElectronLauncher } from "./ElectronLauncher";
import { ConfigEditorProvider } from "./ConfigEditorProvider";

export class ShaderView {
  private panelManager: PanelManager;
  private webServer: WebServer;
  private webSocketTransport: WebSocketTransport | null = null;
  private shaderProcessor: ShaderProcessor;
  private messenger: Messenger;
  private context: vscode.ExtensionContext;
  private logger!: Logger;
  private electronLauncher: ElectronLauncher;
  private configEditorProvider: vscode.Disposable;

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

    // Register custom editor for .sv.json files
    this.configEditorProvider = ConfigEditorProvider.register(context, this.shaderProcessor);

    // Start WebSocket transport unless in test mode
    this.startWebSocketTransport();

    this.registerCommands();
    this.registerEventHandlers();
  }

  public isDevelopmentMode(): boolean {
    return this.context.extensionMode === vscode.ExtensionMode.Development;
  }

  public dispose(): void {
    this.webServer.stopWebServer();
    if (this.webSocketTransport) {
      this.messenger.removeTransport(this.webSocketTransport);
      this.webSocketTransport.close();
      this.webSocketTransport = null;
    }
    this.configEditorProvider.dispose();
    this.logger.info("Shader extension disposed");
  }

  private startWebSocketTransport(): void {
    const config = vscode.workspace.getConfiguration('shaderView');
    let webSocketPort = config.get<number>('webSocketPort') || 51472;
    
    if (this.context.extensionMode === vscode.ExtensionMode.Test) {
      webSocketPort = 51473;
      this.logger.debug(`Using test port ${webSocketPort} for WebSocket during tests`);
    }

    try {
      this.webSocketTransport = new WebSocketTransport(webSocketPort, this.shaderProcessor);
      this.messenger.addTransport(this.webSocketTransport);
    } catch (error) {
      this.logger.error(`Failed to start WebSocket transport: ${error}`);
    }
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
      vscode.commands.registerCommand("shader-view.generateConfig", () => {
        this.logger.info("shader-view.generateConfig command executed");
        this.generateConfig();
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

  private async generateConfig(): Promise<void> {
    try {
      // Get the active editor
      const activeEditor = vscode.window.activeTextEditor;

      // If no active editor, ask user to select a GLSL file
      let glslFilePath: string;
      if (!activeEditor || !activeEditor.document.fileName.endsWith('.glsl')) {
        const fileUri = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          filters: {
            'GLSL Files': ['glsl']
          },
          title: 'Select GLSL file to generate config for'
        });

        if (!fileUri || fileUri.length === 0) {
          return; // User cancelled
        }

        glslFilePath = fileUri[0].fsPath;
      } else {
        glslFilePath = activeEditor.document.fileName;
      }

      // Get the base name without extension
      const baseName = path.basename(glslFilePath, '.glsl');
      const dirName = path.dirname(glslFilePath);

      // Create the config file path
      const configFilePath = path.join(dirName, `${baseName}.sv.json`);

      // Check if config file already exists
      if (fs.existsSync(configFilePath)) {
        const overwrite = await vscode.window.showWarningMessage(
          `Config file ${baseName}.sv.json already exists. Overwrite?`,
          'Yes', 'No'
        );
        if (overwrite !== 'Yes') {
          return;
        }
      }

      // Create base config
      const relativeGlslPath = path.relative(dirName, glslFilePath).replace(/\\/g, '/');
      const baseConfig = {
        version: "1.0",
        Image: {
          inputs: {}
        }
      };

      // Write the config file
      fs.writeFileSync(configFilePath, JSON.stringify(baseConfig, null, 2));

      // Open the config file
      const configUri = vscode.Uri.file(configFilePath);
      await vscode.commands.executeCommand('vscode.open', configUri);

      vscode.window.showInformationMessage(`Generated config file: ${baseName}.sv.json`);

    } catch (error) {
      this.logger.error(`Failed to generate config: ${error}`);
      vscode.window.showErrorMessage(`Failed to generate config: ${error}`);
    }
  }

  private performShaderUpdate(editor: vscode.TextEditor): void {
    this.shaderProcessor.sendShaderToWebview(editor);
  }

  private async openInElectron(): Promise<void> {
    await this.electronLauncher.launch();
  }

}
