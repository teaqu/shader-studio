import * as vscode from "vscode";
import { ShaderProvider } from "./ShaderProvider";
import { GlslFileTracker } from "./GlslFileTracker";
import { Messenger } from "./transport/Messenger";
import { OverlayPanelHandler } from "./OverlayPanelHandler";
import { Logger } from "./services/Logger";
import { ConfigUpdateHandler } from "./handlers/ConfigUpdateHandler";
import { NavigationHandler } from "./handlers/NavigationHandler";
import { FileDialogHandler } from "./handlers/FileDialogHandler";

export class ClientMessageHandler {
  readonly overlay: OverlayPanelHandler;
  readonly config: ConfigUpdateHandler;
  readonly nav: NavigationHandler;
  readonly files: FileDialogHandler;
  private logger: Logger;

  constructor(
    private context: vscode.ExtensionContext,
    private shaderProvider: ShaderProvider,
    glslFileTracker: GlslFileTracker,
    messenger: Messenger | null,
    extensionPath: string,
    getPanelColumns?: () => Set<vscode.ViewColumn>,
  ) {
    this.logger = Logger.getInstance();
    this.overlay = new OverlayPanelHandler();
    this.config = new ConfigUpdateHandler(glslFileTracker, shaderProvider, messenger, this.logger);
    this.nav = new NavigationHandler(glslFileTracker, getPanelColumns ?? (() => new Set()), this.logger);
    this.files = new FileDialogHandler(
      context,
      glslFileTracker,
      extensionPath,
      messenger,
      (shaderPath) => this.nav.resolveTargetColumn(shaderPath),
      this.logger,
    );
  }

  async handle(
    message: any,
    respondFn: (msg: any) => void,
    pathConverter: (absPath: string) => string = (p) => p,
  ): Promise<void> {
    this.logger.debug(`ClientMessageHandler: handling ${message.type}`);

    switch (message.type) {
      case 'updateConfig':
        await this.config.handleConfigUpdate(message.payload);
        break;
      case 'selectFile':
        await this.files.handleSelectFile(message.payload, respondFn);
        break;
      case 'createFile':
        await this.files.handleCreateFile(message.payload, respondFn);
        break;
      case 'updateShaderSource':
        await this.overlay.handleUpdateShaderSource(message.payload);
        break;
      case 'requestFileContents':
        await this.overlay.handleRequestFileContents(message.payload, respondFn);
        break;
      case 'navigateToBuffer':
        await this.nav.handleNavigateToBuffer(message.payload);
        break;
      case 'requestWorkspaceFiles':
        await this.files.handleRequestWorkspaceFiles(message.payload, respondFn, pathConverter);
        break;
      case 'forkShader':
        await this.files.handleForkShader(message.payload);
        break;
      case 'saveFile':
        await this.files.handleSaveFile(message.payload, respondFn);
        break;
      case 'goToLine':
        await this.nav.handleGoToLine(message.payload);
        break;
      case 'extensionCommand': {
        const cmd = message.payload?.command;
        if (cmd && cmd !== 'moveToNewWindow') {
          await vscode.commands.executeCommand(`shader-studio.${cmd}`);
        }
        break;
      }
      case 'updateScriptPollingRate': {
        const fps = message.payload?.fps;
        if (typeof fps === 'number' && fps > 0) {
          this.shaderProvider.updateScriptPollingRate(fps);
        }
        break;
      }
      case 'resetScriptTime':
        this.shaderProvider.resetScriptTime();
        break;
      case 'saveLayout':
        await this.context.workspaceState.update('shader-studio.dockviewLayout', message.payload);
        break;
      case 'requestLayout': {
        const layout = this.context.workspaceState.get('shader-studio.dockviewLayout', null);
        respondFn({ type: 'restoreLayout', payload: layout });
        break;
      }
      case 'setCompileMode':
        await vscode.commands.executeCommand('shader-studio.setCompileMode', message.payload?.mode);
        break;
    }
  }
}
