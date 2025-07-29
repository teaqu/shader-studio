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
import { GlslFileTracker } from "./GlslFileTracker";

export class Shadera {
  private panelManager: PanelManager;
  private webServer: WebServer;
  private webSocketTransport: WebSocketTransport | null = null;
  private shaderProcessor: ShaderProcessor;
  private messenger: Messenger;
  private context: vscode.ExtensionContext;
  private logger!: Logger;
  private electronLauncher: ElectronLauncher;
  private configEditorProvider: vscode.Disposable;
  private glslFileTracker: GlslFileTracker;

  constructor(
    context: vscode.ExtensionContext,
    outputChannel: vscode.LogOutputChannel,
    diagnosticCollection: vscode.DiagnosticCollection,
  ) {
    this.context = context;

    Logger.initialize(outputChannel);
    this.logger = Logger.getInstance();

    this.glslFileTracker = new GlslFileTracker(context);

    this.messenger = new Messenger(outputChannel, diagnosticCollection);
    this.shaderProcessor = new ShaderProcessor(this.messenger);
    this.panelManager = new PanelManager(
      context,
      this.messenger,
      this.shaderProcessor,
      this.glslFileTracker,
    );
    this.webServer = new WebServer(context);
    this.electronLauncher = new ElectronLauncher(context, this.logger);

    // Register custom editor for .sha.json files
    this.configEditorProvider = ConfigEditorProvider.register(
      context,
      this.shaderProcessor,
    );

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
    this.messenger.close();
    this.configEditorProvider.dispose();
    this.logger.info("Shader extension disposed");
  }

  private startWebSocketTransport(): void {
    const config = vscode.workspace.getConfiguration("shadera");
    let webSocketPort = config.get<number>("webSocketPort") || 51472;

    if (this.context.extensionMode === vscode.ExtensionMode.Test) {
      webSocketPort = 51473;
      this.logger.debug(
        `Using test port ${webSocketPort} for WebSocket during tests`,
      );
    }

    try {
      this.webSocketTransport = new WebSocketTransport(
        webSocketPort,
        this.shaderProcessor,
        this.glslFileTracker,
      );
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
      vscode.window.showWarningMessage(
        "Web server is not running. Start the server first.",
      );
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
      vscode.window.showWarningMessage(
        "Web server is not running. Start the server first.",
      );
      return;
    }

    try {
      const httpUrl = this.webServer.getHttpUrl();
      await vscode.env.clipboard.writeText(httpUrl);
      vscode.window.showInformationMessage(
        `Server URL copied to clipboard: ${httpUrl}`,
      );
    } catch (error) {
      this.logger.error(`Failed to copy URL: ${error}`);
      vscode.window.showErrorMessage(`Failed to copy URL: ${error}`);
    }
  }

  private registerCommands(): void {
    this.context.subscriptions.push(
      vscode.commands.registerCommand("shadera.view", () => {
        this.logger.info("shadera.view command executed");
        this.panelManager.createPanel();
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shadera.startWebServer", () => {
        this.logger.info("shadera.startWebServer command executed");
        this.startWebServer();
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shadera.openInBrowser", () => {
        this.logger.info("shadera.openInBrowser command executed");
        this.openInBrowser();
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shadera.copyServerUrl", () => {
        this.logger.info("shadera.copyServerUrl command executed");
        this.copyServerUrl();
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shadera.stopWebServer", () => {
        this.logger.info("shadera.stopWebServer command executed");
        this.webServer.stopWebServer();
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shadera.showWebServerMenu", () => {
        this.logger.info("shadera.showWebServerMenu command executed");
        this.webServer.showWebServerMenu();
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shadera.generateConfig", () => {
        this.logger.info("shadera.generateConfig command executed");
        this.generateConfig();
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shadera.showShaderaMenu", () => {
        this.logger.info("shadera.showShaderaMenu command executed");
        this.webServer.getStatusBar().showShaderaMenu();
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shadera.openInElectron", () => {
        this.logger.info("shadera.openInElectron command executed");
        this.openInElectron();
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shadera.toggleConfigView", () => {
        this.logger.info("shadera.toggleConfigView command executed");
        this.toggleConfigView();
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand(
        "shadera.refreshCurrentShader",
        () => {
          this.logger.info("shadera.refreshCurrentShader command executed");
          this.refreshCurrentShader();
        },
      ),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand(
        "shadera.refreshSpecificShaderByPath",
        (shaderPath: string) => {
          this.logger.info(
            `shadera.refreshSpecificShaderByPath command executed for: ${shaderPath}`,
          );
          this.refreshSpecificShaderByPath(shaderPath);
        },
      ),
    );
  }

  private registerEventHandlers(): void {
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && this.glslFileTracker.isGlslEditor(editor)) {
        this.glslFileTracker.setLastViewedGlslFile(editor.document.uri.fsPath);
        this.performShaderUpdate(editor);
      }
    });

    vscode.workspace.onDidChangeTextDocument((event) => {
      const editor = vscode.window.activeTextEditor;
      if (editor && this.glslFileTracker.isGlslEditor(editor)) {
        this.glslFileTracker.setLastViewedGlslFile(editor.document.uri.fsPath);
        this.performShaderUpdate(editor);
      }
    });
  }

  private isGlslEditor(editor: vscode.TextEditor): boolean {
    return this.glslFileTracker.isGlslEditor(editor);
  }

  private performShaderUpdate(editor: vscode.TextEditor): void {
    if (this.messenger.hasActiveClients()) {
      this.shaderProcessor.sendShaderToWebview(editor);
    }
  }

  private async generateConfig(): Promise<void> {
    try {
      const activeEditor = vscode.window.activeTextEditor;

      let glslFilePath: string;
      if (!activeEditor || !activeEditor.document.fileName.endsWith(".glsl")) {
        const fileUri = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          filters: {
            "GLSL Files": ["glsl"],
          },
          title: "Select GLSL file to generate config for",
        });

        if (!fileUri || fileUri.length === 0) {
          return; // User cancelled
        }

        glslFilePath = fileUri[0].fsPath;
      } else {
        glslFilePath = activeEditor.document.fileName;
      }

      // Get the base name without extension
      const baseName = path.basename(glslFilePath, ".glsl");
      const dirName = path.dirname(glslFilePath);

      // Create the config file path
      const configFilePath = path.join(dirName, `${baseName}.sha.json`);

      // Check if config file already exists
      if (fs.existsSync(configFilePath)) {
        const overwrite = await vscode.window.showWarningMessage(
          `Config file ${baseName}.sha.json already exists. Overwrite?`,
          "Yes",
          "No",
        );
        if (overwrite !== "Yes") {
          return;
        }
      }

      // Create base config
      const relativeGlslPath = path.relative(dirName, glslFilePath).replace(
        /\\/g,
        "/",
      );
      const baseConfig = {
        version: "1.0",
        passes: {
          Image: {
            inputs: {},
          },
        },
      };

      // Write the config file
      fs.writeFileSync(configFilePath, JSON.stringify(baseConfig, null, 2));

      // Open the config file
      const configUri = vscode.Uri.file(configFilePath);
      await vscode.commands.executeCommand("vscode.open", configUri);

      vscode.window.showInformationMessage(
        `Generated config file: ${baseName}.sha.json`,
      );
    } catch (error) {
      this.logger.error(`Failed to generate config: ${error}`);
      vscode.window.showErrorMessage(`Failed to generate config: ${error}`);
    }
  }

  private async openInElectron(): Promise<void> {
    await this.electronLauncher.launch(this.isDevelopmentMode());
  }

  private async toggleConfigView(): Promise<void> {
    const activeEditor = vscode.window.activeTextEditor;
    const currentTab = vscode.window.tabGroups.activeTabGroup.activeTab;

    // Check if we have a .sha.json file either in text editor or custom editor
    let documentUri: vscode.Uri | undefined;
    let isCustomEditor = false;

    if (activeEditor && activeEditor.document.fileName.endsWith(".sha.json")) {
      // Text editor with .sha.json file
      documentUri = activeEditor.document.uri;
      isCustomEditor = false;
    } else if (
      currentTab?.input instanceof vscode.TabInputCustom &&
      (currentTab.input as vscode.TabInputCustom).viewType ===
      "shadera.configEditor"
    ) {
      // Custom editor for .sha.json file
      documentUri = (currentTab.input as vscode.TabInputCustom).uri;
      isCustomEditor = true;
    }

    if (!documentUri) {
      return;
    }

    try {
      if (isCustomEditor) {
        // Switch to text editor
        await vscode.commands.executeCommand(
          "vscode.openWith",
          documentUri,
          "default",
        );
      } else {
        // Switch to custom editor
        await vscode.commands.executeCommand(
          "vscode.openWith",
          documentUri,
          "shadera.configEditor",
        );
      }

      // Refresh the status bar toggle button after a short delay
      setTimeout(() => {
        this.webServer.getStatusBar().refreshConfigToggle();
      }, 100);
    } catch (error) {
      this.logger.error(`Failed to toggle config view: ${error}`);
      vscode.window.showErrorMessage(`Failed to toggle view: ${error}`);
    }
  }

  private refreshCurrentShader(): void {
    this.logger.info("Refreshing current/active shader");

    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && this.isGlslEditor(activeEditor)) {
      this.logger.info(
        `Refreshing current shader: ${activeEditor.document.fileName}`,
      );
      this.shaderProcessor.sendShaderToWebview(activeEditor);
    } else {
      const lastViewedFile = this.glslFileTracker.getLastViewedGlslFile();
      if (lastViewedFile) {
        this.logger.info(
          `No active GLSL editor, using last viewed file: ${lastViewedFile}`,
        );
        this.refreshSpecificShaderByPath(lastViewedFile);
      } else {
        this.logger.warn(
          "No active GLSL editor and no last viewed file to refresh",
        );
        vscode.window.showWarningMessage(
          "No GLSL file to refresh. Open a .glsl file first.",
        );
      }
    }
  }

  private async refreshSpecificShaderByPath(shaderPath: string): Promise<void> {
    this.logger.info(`Refreshing shader by path: ${shaderPath}`);

    try {
      if (!fs.existsSync(shaderPath)) {
        this.logger.warn(`Shader file not found at path: ${shaderPath}`);
        vscode.window.showWarningMessage(
          `Shader file not found: ${shaderPath}`,
        );
        return;
      }

      const matchingEditor = vscode.window.visibleTextEditors.find((editor) => {
        return editor.document.uri.fsPath === shaderPath &&
          this.isGlslEditor(editor);
      });

      if (matchingEditor) {
        this.logger.info(`Found open editor for ${shaderPath}, refreshing`);
        this.glslFileTracker.setLastViewedGlslFile(shaderPath);
        this.shaderProcessor.sendShaderToWebview(matchingEditor);
      } else {
        this.logger.info(`Opening shader file at path: ${shaderPath}`);
        const document = await vscode.workspace.openTextDocument(
          vscode.Uri.file(shaderPath),
        );
        const editor = await vscode.window.showTextDocument(document, {
          preview: false,
        });

        this.logger.info(`Opened and refreshing shader file: ${shaderPath}`);
        this.glslFileTracker.setLastViewedGlslFile(shaderPath);
        this.shaderProcessor.sendShaderToWebview(editor);
      }
    } catch (error) {
      this.logger.error(
        `Failed to refresh shader at path '${shaderPath}': ${error}`,
      );
      vscode.window.showErrorMessage(
        `Failed to refresh shader at '${shaderPath}': ${error}`,
      );
    }
  }
}
