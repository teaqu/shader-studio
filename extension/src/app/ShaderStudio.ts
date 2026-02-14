import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { Logger } from "./services/Logger";
import { PanelManager } from "./PanelManager";
import { ShaderProvider } from "./ShaderProvider";
import { WebServer } from "./WebServer";
import { WebSocketTransport } from "./transport/WebSocketTransport";
import { ConfigEditorProvider } from "./ConfigEditorProvider";
import { ShaderExplorerProvider } from "./ShaderExplorerProvider";
import { GlslFileTracker } from "./GlslFileTracker";
import { ConfigViewToggler } from "./ConfigViewToggler";
import { ShaderCreator } from "./ShaderCreator";
import { Messenger } from "./transport/Messenger";
import { ErrorHandler } from "./ErrorHandler";
import { ConfigGenerator } from "./ConfigGenerator";
import type { CursorPositionMessage } from "@shader-studio/types";

export class ShaderStudio {
  private panelManager: PanelManager;
  private webServer: WebServer;
  private webSocketTransport: WebSocketTransport | null = null;
  private shaderProvider: ShaderProvider;
  private messenger: Messenger;
  private context: vscode.ExtensionContext;
  private logger!: Logger;
  private configEditorProvider: vscode.Disposable;
  private sShaderExplorerProvider: vscode.Disposable;
  private glslFileTracker: GlslFileTracker;
  private configViewToggler: ConfigViewToggler;
  private shaderCreator!: ShaderCreator;
  private configGenerator: ConfigGenerator;
  private errorHandler: ErrorHandler;
  private cursorPositionTimeout: NodeJS.Timeout | null = null;

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
    
    const errorHandler = new ErrorHandler(outputChannel, diagnosticCollection);
    this.errorHandler = errorHandler;
    this.messenger = new Messenger(outputChannel, errorHandler);
    this.shaderProvider = new ShaderProvider(this.messenger);
    this.configGenerator = new ConfigGenerator(this.glslFileTracker, this.messenger, this.logger);
    this.panelManager = new PanelManager(
      context,
      this.messenger,
      this.shaderProvider,
      this.glslFileTracker,
    );
    this.webServer = new WebServer(context, this.isDevelopmentMode());

    // Register custom editor for .sha.json files
    this.configEditorProvider = ConfigEditorProvider.register(
      context,
      this.shaderProvider,
    );

    // Register shader explorer
    this.sShaderExplorerProvider = ShaderExplorerProvider.register(context);

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
    this.sShaderExplorerProvider.dispose();
    this.errorHandler.dispose();
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
      vscode.commands.registerCommand("shader-studio.viewInNewWindow", async () => {
        this.logger.info("shader-studio.viewInNewWindow command executed");
        await this.panelManager.createPanelInNewWindow();
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
        this.configGenerator.generateConfig(uri);
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shader-studio.generateConfigFromUI", (uri?: vscode.Uri) => {
        this.logger.info("shader-studio.generateConfigFromUI command executed");
        this.configGenerator.generateConfig(uri, true); // Show confirmation
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shader-studio.showShaderStudioMenu", () => {
        this.logger.info("shader-studio.showShaderStudioMenu command executed");
        this.webServer.getStatusBar().showShaderStudioMenu();
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
      if (!editor) {
        return;
      }
      this.glslFileTracker.recommendGlslHighlighter(editor);
      if (this.glslFileTracker.isGlslEditor(editor)) {
        this.glslFileTracker.setLastViewedGlslFile(editor.document.uri.fsPath);
        this.performShaderUpdate(editor);
      }
    });

    vscode.workspace.onDidChangeTextDocument((event) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }

      this.glslFileTracker.recommendGlslHighlighter(editor);

      if (editor && this.glslFileTracker.isGlslEditor(editor)) {
        this.glslFileTracker.setLastViewedGlslFile(editor.document.uri.fsPath);
        this.performShaderUpdate(editor);
      }
    });

    // Track cursor position in GLSL editors for debug mode
    this.context.subscriptions.push(
      vscode.window.onDidChangeTextEditorSelection((event) => {
        this.handleCursorPositionChange(event);
      })
    );
  }

  private isGlslEditor(editor: vscode.TextEditor): boolean {
    return this.glslFileTracker.isGlslEditor(editor);
  }

  private performShaderUpdate(editor: vscode.TextEditor): void {
    if (this.messenger.hasActiveClients()) {
      this.shaderProvider.sendShaderToWebview(editor);
    }
  }

  private handleCursorPositionChange(event: vscode.TextEditorSelectionChangeEvent): void {
    const editor = event.textEditor;

    // Only track GLSL editors
    if (!this.glslFileTracker.isGlslEditor(editor)) {
      return;
    }

    // Only send on cursor movement (not text selection)
    if (event.selections.some(sel => !sel.isEmpty)) {
      return;
    }

    // Debounce to avoid excessive messages
    if (this.cursorPositionTimeout) {
      clearTimeout(this.cursorPositionTimeout);
    }

    this.cursorPositionTimeout = setTimeout(() => {
      const line = editor.selection.active.line;
      const character = editor.selection.active.character;
      const lineContent = editor.document.lineAt(line).text;
      const filePath = editor.document.uri.fsPath;

      const message: CursorPositionMessage = {
        type: "cursorPosition",
        payload: {
          line,
          character,
          lineContent,
          filePath,
        },
      };

      this.messenger.send(message);
    }, 150); // 150ms debounce
  }

  private async toggleConfigView(): Promise<void> {
    await this.configViewToggler.toggle();
  }

  private async refreshCurrentShader(): Promise<void> {
    this.logger.info("Refreshing current/active shader");

    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && this.isGlslEditor(activeEditor)) {
      this.logger.info(
        `Refreshing current shader: ${activeEditor.document.fileName}`,
      );
      this.shaderProvider.sendShaderToWebview(activeEditor, { forceCleanup: true });
    } else {
      const lastViewedFile = this.glslFileTracker.getLastViewedGlslFile();
      if (lastViewedFile) {
        this.logger.info(
          `No active GLSL editor, using last viewed file: ${lastViewedFile}`,
        );
        // Use sendShaderFromPath to avoid switching focus
        await this.shaderProvider.sendShaderFromPath(lastViewedFile, { forceCleanup: true });
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

      // Always read from file to avoid switching focus
      this.logger.info(`Sending shader from path: ${shaderPath}`);
      this.glslFileTracker.setLastViewedGlslFile(shaderPath);
      await this.shaderProvider.sendShaderFromPath(shaderPath, { forceCleanup: true });
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
