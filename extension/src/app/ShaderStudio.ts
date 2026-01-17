import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { Logger } from "./services/Logger";
import { PanelManager } from "./PanelManager";
import { ShaderProvider } from "./ShaderProvider";
import { WebServer } from "./WebServer";
import { WebSocketTransport } from "./transport/WebSocketTransport";
import { ConfigEditorProvider } from "./ConfigEditorProvider";
import { ShaderBrowserProvider } from "./ShaderBrowserProvider";
import { GlslFileTracker } from "./GlslFileTracker";
import { ConfigViewToggler } from "./ConfigViewToggler";
import { ShaderCreator } from "./ShaderCreator";
import { Messenger } from "./transport/Messenger";
import { ElectronLauncher } from "./ElectronLauncher";

export class ShaderStudio {
  private panelManager: PanelManager;
  private webServer: WebServer;
  private webSocketTransport: WebSocketTransport | null = null;
  private shaderProvider: ShaderProvider;
  private messenger: Messenger;
  private context: vscode.ExtensionContext;
  private logger!: Logger;
  private electronLauncher: ElectronLauncher;
  private configEditorProvider: vscode.Disposable;
  private shaderBrowserProvider: vscode.Disposable;
  private glslFileTracker: GlslFileTracker;
  private configViewToggler: ConfigViewToggler;
  private shaderCreator!: ShaderCreator;

  constructor(
    context: vscode.ExtensionContext,
    outputChannel: vscode.LogOutputChannel,
    diagnosticCollection: vscode.DiagnosticCollection,
  ) {
    this.context = context;

    Logger.initialize(outputChannel);
    this.logger = Logger.getInstance();

    this.configViewToggler = new ConfigViewToggler(this.logger);
    this.glslFileTracker = new GlslFileTracker(context);
    this.shaderCreator = new ShaderCreator(this.logger);
    this.messenger = new Messenger(outputChannel, diagnosticCollection);
    this.shaderProvider = new ShaderProvider(this.messenger);
    this.panelManager = new PanelManager(
      context,
      this.messenger,
      this.shaderProvider,
      this.glslFileTracker,
    );
    this.webServer = new WebServer(context, this.isDevelopmentMode());
    this.electronLauncher = new ElectronLauncher(context, this.logger);

    // Register custom editor for .sha.json files
    this.configEditorProvider = ConfigEditorProvider.register(
      context,
      this.shaderProvider,
    );

    // Register shader browser
    this.shaderBrowserProvider = ShaderBrowserProvider.register(context);

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
    this.shaderBrowserProvider.dispose();
    this.logger.info("Shader extension disposed");
  }

  private startWebSocketTransport(): void {
    const config = vscode.workspace.getConfiguration("shader-studio");
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
        this.shaderProvider,
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
      vscode.commands.registerCommand("shader-studio.view", () => {
        this.logger.info("shader-studio.view command executed");
        this.panelManager.createPanel();
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shader-studio.startWebServer", () => {
        this.logger.info("shader-studio.startWebServer command executed");
        this.startWebServer();
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shader-studio.openInBrowser", () => {
        this.logger.info("shader-studio.openInBrowser command executed");
        this.openInBrowser();
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shader-studio.copyServerUrl", () => {
        this.logger.info("shader-studio.copyServerUrl command executed");
        this.copyServerUrl();
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shader-studio.stopWebServer", () => {
        this.logger.info("shader-studio.stopWebServer command executed");
        this.webServer.stopWebServer();
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shader-studio.showWebServerMenu", () => {
        this.logger.info("shader-studio.showWebServerMenu command executed");
        this.webServer.showWebServerMenu();
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shader-studio.generateConfig", (uri?: vscode.Uri) => {
        this.logger.info("shader-studio.generateConfig command executed");
        this.generateConfig(uri);
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shader-studio.showShaderStudioMenu", () => {
        this.logger.info("shader-studio.showShaderStudioMenu command executed");
        this.webServer.getStatusBar().showShaderStudioMenu();
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shader-studio.openInElectron", () => {
        this.logger.info("shader-studio.openInElectron command executed");
        this.openInElectron();
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shader-studio.toggleConfigView", () => {
        this.logger.info("shader-studio.toggleConfigView command executed");
        this.toggleConfigView();
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shader-studio.toggleConfigViewToSource", () => {
        this.logger.info("shader-studio.toggleConfigViewToSource command executed");
        this.toggleConfigView();
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand(
        "shader-studio.refreshCurrentShader",
        () => {
          this.logger.info("shader-studio.refreshCurrentShader command executed");
          this.refreshCurrentShader();
        },
      ),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand(
        "shader-studio.refreshSpecificShaderByPath",
        (shaderPath: string) => {
          this.logger.info(
            `shader-studio.refreshSpecificShaderByPath command executed for: ${shaderPath}`,
          );
          this.refreshSpecificShaderByPath(shaderPath);
        },
      ),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand(
        "shader-studio.newShader",
        () => {
          this.logger.info("shader-studio.newShader command executed");
          this.newShader();
        },
      ),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shader-studio.openSettings", () => {
        this.logger.info("shader-studio.openSettings command executed");
        this.openSettings();
      }),
    );
  }

  private registerEventHandlers(): void {
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!editor) return;
      this.glslFileTracker.recommendGlslHighlighter(editor);
      if (this.glslFileTracker.isGlslEditor(editor)) {
        this.glslFileTracker.setLastViewedGlslFile(editor.document.uri.fsPath);
        this.performShaderUpdate(editor);
      }
    });

    vscode.workspace.onDidChangeTextDocument((event) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      this.glslFileTracker.recommendGlslHighlighter(editor);

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
      this.shaderProvider.sendShaderToWebview(editor);
    }
  }

  private async generateConfig(uri?: vscode.Uri): Promise<void> {
    try {
      let glslFilePath: string;
      
      if (uri) {
        // URI was provided (e.g., from shader browser)
        glslFilePath = uri.fsPath;
      } else {
        const activeEditor = vscode.window.activeTextEditor;

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
    await this.configViewToggler.toggle();
  }

  private refreshCurrentShader(): void {
    this.logger.info("Refreshing current/active shader");

    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && this.isGlslEditor(activeEditor)) {
      this.logger.info(
        `Refreshing current shader: ${activeEditor.document.fileName}`,
      );
      this.shaderProvider.sendShaderToWebview(activeEditor);
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
        this.shaderProvider.sendShaderToWebview(matchingEditor);
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
        this.shaderProvider.sendShaderToWebview(editor);
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

  private async openSettings(): Promise<void> {
    try {
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        '^shader-studio.'
      );
    } catch (error) {
      this.logger.error(`Failed to open settings: ${error}`);
      vscode.window.showErrorMessage(`Failed to open settings: ${error}`);
    }
  }

  private async newShader(): Promise<void> {
    await this.shaderCreator.create();
  }
}
