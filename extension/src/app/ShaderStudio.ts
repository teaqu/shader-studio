import * as vscode from "vscode";
import * as fs from "fs";
import { Logger } from "./services/Logger";
import { PanelManager } from "./PanelManager";
import { ShaderProvider } from "./ShaderProvider";
import { WebServer } from "./WebServer";
import { WebSocketTransport } from "./transport/WebSocketTransport";
import { ShaderExplorerProvider } from "./ShaderExplorerProvider";
import { SnippetLibraryProvider } from "./SnippetLibraryProvider";
import { GlslFileTracker } from "./GlslFileTracker";
import { ConfigViewToggler } from "./ConfigViewToggler";
import { ShaderCreator } from "./ShaderCreator";
import { Messenger } from "./transport/Messenger";
import { ErrorHandler } from "./ErrorHandler";
import { ConfigGenerator } from "./ConfigGenerator";
import { writeWorkspaceTypeDefs } from "./WorkspaceTypeDefs";
import { CompileController, type CompileMode } from "./CompileController";
import type { CursorPositionMessage, ErrorMessage, ResetLayoutMessage } from "@shader-studio/types";

export class ShaderStudio {
  private panelManager: PanelManager;
  private webServer: WebServer;
  private webSocketTransport: WebSocketTransport | null = null;
  private shaderProvider: ShaderProvider;
  private messenger: Messenger;
  private context: vscode.ExtensionContext;
  private logger!: Logger;
  private sShaderExplorerProvider: vscode.Disposable;
  private snippetLibraryProvider: vscode.Disposable;
  private glslFileTracker: GlslFileTracker;
  private configViewToggler: ConfigViewToggler;
  private shaderCreator!: ShaderCreator;
  private configGenerator: ConfigGenerator;
  private errorHandler: ErrorHandler;
  private cursorPositionTimeout: NodeJS.Timeout | null = null;
  private isDebugModeEnabled = false;
  private compileController: CompileController;

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
    this.shaderCreator = new ShaderCreator(this.logger, this.glslFileTracker);
    
    const errorHandler = new ErrorHandler(outputChannel, diagnosticCollection);
    this.errorHandler = errorHandler;
    this.messenger = new Messenger(
      outputChannel,
      errorHandler,
      (enabled) => this.setDebugModeEnabled(enabled)
    );
    this.shaderProvider = new ShaderProvider(
      this.messenger,
      () => this.isDebugModeEnabled,
    );
    this.compileController = new CompileController(
      context,
      this.glslFileTracker,
      this.shaderProvider,
      this.messenger,
    );
    this.configGenerator = new ConfigGenerator(this.glslFileTracker, this.messenger, this.logger);

    // On launch: update the workspace .d.ts only if it already exists and the source asset is newer
    writeWorkspaceTypeDefs(context.extensionPath, false);
    this.panelManager = new PanelManager(
      context,
      this.messenger,
      this.shaderProvider,
      this.glslFileTracker,
    );
    this.webServer = new WebServer(context, this.isDevelopmentMode());
    this.webServer.setMessenger(this.messenger);

    // Register shader explorer
    this.sShaderExplorerProvider = ShaderExplorerProvider.register(context);

    // Register snippet browser
    this.snippetLibraryProvider = SnippetLibraryProvider.register(context);

    // Start WebSocket transport unless in test mode
    this.startWebSocketTransport();

    this.registerCommands();
    this.registerEventHandlers();
  }

  public isDevelopmentMode(): boolean {
    return this.context.extensionMode === vscode.ExtensionMode.Development;
  }

  public setDebugModeEnabled(enabled: boolean): void {
    this.isDebugModeEnabled = enabled;
    this.logger.debug(`Debug mode ${enabled ? 'enabled' : 'disabled'}`);
  }

  public dispose(): void {
    this.webServer.stopWebServer();
    this.messenger.close();
    this.sShaderExplorerProvider.dispose();
    this.snippetLibraryProvider.dispose();
    this.errorHandler.dispose();
    this.logger.info("Shader extension disposed");
  }

  private startWebSocketTransport(): void {
    if (this.context.extensionMode === vscode.ExtensionMode.Test) {
      const testPort = 51473;
      this.logger.debug(
        `Using test port ${testPort} for WebSocket during tests`,
      );
      this.createWebSocketTransport(testPort);
      return;
    }

    const preferredPort = 51472;
    this.createWebSocketTransport(preferredPort);
  }

  private createWebSocketTransport(port: number): void {
    try {
      this.webSocketTransport = new WebSocketTransport(
        port,
        this.shaderProvider,
        this.glslFileTracker,
        this.context,
        this.context.extensionPath,
        (actualPort) => {
          this.webServer.setWebSocketPort(actualPort);
          this.logger.info(`WebSocket server ready on port ${actualPort}`);
        },
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

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shader-studio.toggleEditorOverlay", () => {
        this.logger.info("shader-studio.toggleEditorOverlay command executed");
        this.panelManager.toggleEditorOverlayInActivePanel();
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shader-studio.manualCompile", () => {
        this.logger.info("shader-studio.manualCompile command executed");
        if (this.compileController.getMode() !== "manual") {
          return;
        }
        void this.compileController.manualCompileCurrentShader(vscode.window.activeTextEditor);
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shader-studio.saveCurrentShader", async () => {
        this.logger.info("shader-studio.saveCurrentShader command executed");
        const editor = this.glslFileTracker.getActiveOrLastViewedGLSLEditor();
        if (!editor) {
          return;
        }
        await editor.document.save();
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shader-studio.setCompileMode", (mode: CompileMode) => {
        this.logger.info(`shader-studio.setCompileMode command executed: ${mode}`);
        this.compileController.setMode(mode);
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shader-studio.hasActiveViewer", () => {
        return this.messenger.hasActiveClients();
      }),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("shader-studio.resetLayout", () => {
        this.logger.info("shader-studio.resetLayout command executed");
        this.context.workspaceState.update('shader-studio.dockviewLayouts', undefined);
        this.context.workspaceState.update('shader-studio.dockviewLayout', undefined);
        const message: ResetLayoutMessage = { type: "resetLayout" };
        this.messenger.send(message);
      }),
    );
  }

  private registerEventHandlers(): void {
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      this.compileController.handleActiveEditorChange(editor);
    });

    vscode.workspace.onDidChangeTextDocument((event) => {
      this.compileController.handleTextDocumentChange(event);
    });

    vscode.workspace.onDidSaveTextDocument((document) => {
      this.compileController.handleTextDocumentSave(
        document,
        vscode.window.visibleTextEditors,
      );
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

    this.sendCursorPosition(editor);
  }

  private sendCursorPosition(editor: vscode.TextEditor, debounce: boolean = true): void {
    const sendMessage = () => {
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
    };

    if (debounce) {
      // Debounce to avoid excessive messages when moving cursor
      if (this.cursorPositionTimeout) {
        clearTimeout(this.cursorPositionTimeout);
      }

      this.cursorPositionTimeout = setTimeout(sendMessage, 150);
    } else {
      // Send immediately (for document changes)
      sendMessage();
    }
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
      this.shaderProvider.sendShaderFromEditor(activeEditor, { forceCleanup: true });
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
        const errorMsg: ErrorMessage = { type: "error", payload: ["No GLSL file to refresh. Open a .glsl file first."] };
        this.messenger.send(errorMsg);
      }
    }
  }

  private async refreshSpecificShaderByPath(shaderPath: string): Promise<void> {
    this.logger.info(`Refreshing shader by path: ${shaderPath}`);

    try {
      if (!fs.existsSync(shaderPath)) {
        this.logger.warn(`Shader file not found at path: ${shaderPath}`);
        const errorMsg: ErrorMessage = { type: "error", payload: [`Shader file not found: ${shaderPath}`] };
        this.messenger.send(errorMsg);
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
      const errorMsg: ErrorMessage = { type: "error", payload: [`Failed to refresh shader: ${error}`] };
      this.messenger.send(errorMsg);
    }
  }

  private async openSettings(): Promise<void> {
    try {
      // Focus ViewColumn.One so settings opens in the left pane
      // (consistent with Shader Explorer and Snippet Library)
      await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
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
