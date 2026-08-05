import * as nodeFs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  buildShaderValidatorPreamble,
  type ShaderValidatorPreamblePreparation,
  type ShaderValidatorPreambleSnapshot,
} from './ShaderValidatorPreamble';
import type { Logger } from './services/Logger';

export const SHADER_VALIDATOR_EXTENSION_ID = 'antaalt.shader-validator';
export const SHADER_VALIDATOR_PREAMBLE_SETTING = 'glsl.preamble';
export const SHADER_VALIDATOR_TARGET_CLIENT_SETTING = 'glsl.targetClient';

const SHADER_VALIDATOR_OPENGL_TARGET = 'OpenGL450';

const PREAMBLE_FILE_NAME = 'shader-studio-preamble.glsl';
const LEGACY_MANAGED_PREAMBLE_SETTING = '${workspaceFolder}/.vscode/shader-studio-preamble.glsl';

type PreambleFs = Pick<typeof import('node:fs'),
  'existsSync' | 'readFileSync' | 'mkdirSync' | 'writeFileSync' | 'renameSync' | 'unlinkSync'>;

interface PreambleManagerDeps {
  fs: PreambleFs;
  getExtension(id: string): vscode.Extension<unknown> | undefined;
  getWorkspaceFolders(): readonly vscode.WorkspaceFolder[];
  onDidChangeExtensions(listener: () => void): vscode.Disposable;
  showInformationMessage(message: string): Thenable<string | undefined>;
}

interface WorkspacePreambleState {
  hasValidSnapshot: boolean;
  lastValidSnapshot?: ShaderValidatorPreambleSnapshot;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNonEmptySetting(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function managedPreamblePath(folder: vscode.WorkspaceFolder): string {
  return path.join(folder.uri.fsPath, '.vscode', PREAMBLE_FILE_NAME);
}

export class ShaderValidatorPreambleManager implements vscode.Disposable {
  private readonly deps: PreambleManagerDeps;
  private readonly extensionChangeListener: vscode.Disposable;
  private readonly workspaceStates = new Map<string, WorkspacePreambleState>();
  private readonly recentWorkspaceFolders = new Map<string, vscode.WorkspaceFolder>();
  private readonly notifiedConflictWorkspaces = new Set<string>();
  private disposed = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly logger: Pick<Logger, 'warn' | 'error'>,
    deps?: Partial<PreambleManagerDeps>,
  ) {
    this.deps = {
      fs: nodeFs,
      getExtension: (id) => vscode.extensions.getExtension(id),
      getWorkspaceFolders: () => vscode.workspace.workspaceFolders ?? [],
      onDidChangeExtensions: (listener) => vscode.extensions.onDidChange(listener),
      showInformationMessage: (message) => vscode.window.showInformationMessage(message),
      ...deps,
    };
    this.extensionChangeListener = this.deps.onDidChangeExtensions(() => {
      if (this.disposed) {
        return;
      }
      void this.coordinateRecentWorkspaces();
    });
    this.context.subscriptions.push(this.extensionChangeListener);
  }

  async apply(preparation: ShaderValidatorPreamblePreparation): Promise<void> {
    if (this.disposed) {
      return;
    }

    const shaderPath = preparation.kind === 'valid'
      ? preparation.snapshot.shaderPath
      : preparation.shaderPath;
    let folder: vscode.WorkspaceFolder | undefined;
    try {
      folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(shaderPath));
    } catch (error) {
      this.logger.error(`Unable to resolve the Shader Validator preamble workspace: ${errorText(error)}`);
      return;
    }

    if (!folder) {
      this.logger.error(`Unable to generate a Shader Validator preamble because no workspace owns ${shaderPath}.`);
      return;
    }

    const workspaceKey = folder.uri.toString();
    this.recentWorkspaceFolders.set(workspaceKey, folder);
    const state = this.workspaceStates.get(workspaceKey) ?? { hasValidSnapshot: false };
    let snapshot: ShaderValidatorPreambleSnapshot;

    if (preparation.kind === 'valid') {
      state.hasValidSnapshot = true;
      state.lastValidSnapshot = preparation.snapshot;
      snapshot = preparation.snapshot;
    } else if (state.hasValidSnapshot && state.lastValidSnapshot) {
      snapshot = state.lastValidSnapshot;
    } else {
      snapshot = {
        shaderPath: preparation.shaderPath,
        configPath: null,
        passName: 'Image',
      };
    }
    this.workspaceStates.set(workspaceKey, state);

    try {
      const result = buildShaderValidatorPreamble(snapshot);
      for (const warning of result.warnings) {
        this.logger.warn(warning);
      }
      this.replaceFileIfChanged(folder, result.content);
    } catch (error) {
      this.logger.error(`Unable to update the Shader Validator preamble: ${errorText(error)}`);
    }

    await this.coordinateWorkspace(folder);
  }

  async initializeWorkspaceFolders(): Promise<void> {
    for (const folder of this.deps.getWorkspaceFolders()) {
      if (this.disposed) {
        return;
      }

      const workspaceKey = folder.uri.toString();
      this.recentWorkspaceFolders.set(workspaceKey, folder);
      try {
        const result = buildShaderValidatorPreamble({
          shaderPath: path.join(folder.uri.fsPath, 'shader-studio.glsl'),
          configPath: null,
          passName: 'Image',
        });
        this.replaceFileIfChanged(folder, result.content);
      } catch (error) {
        this.logger.error(`Unable to initialize the Shader Validator preamble: ${errorText(error)}`);
      }

      await this.coordinateWorkspace(folder);
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.extensionChangeListener.dispose();
  }

  private replaceFileIfChanged(folder: vscode.WorkspaceFolder, content: string): void {
    const vscodeDirectory = path.join(folder.uri.fsPath, '.vscode');
    const destination = path.join(vscodeDirectory, PREAMBLE_FILE_NAME);
    const tempPath = `${destination}.tmp-${process.pid}`;

    try {
      if (
        this.deps.fs.existsSync(destination)
        && this.deps.fs.readFileSync(destination, 'utf8') === content
      ) {
        return;
      }

      this.deps.fs.mkdirSync(vscodeDirectory, { recursive: true });
      this.deps.fs.writeFileSync(tempPath, content, 'utf8');
      this.deps.fs.renameSync(tempPath, destination);
    } catch (error) {
      this.logger.error(`Unable to write the Shader Validator preamble: ${errorText(error)}`);
      this.removeTempFile(tempPath);
    }
  }

  private removeTempFile(tempPath: string): void {
    try {
      if (this.deps.fs.existsSync(tempPath)) {
        this.deps.fs.unlinkSync(tempPath);
      }
    } catch (error) {
      this.logger.error(`Unable to remove the Shader Validator preamble temp file: ${errorText(error)}`);
    }
  }

  private async coordinateRecentWorkspaces(): Promise<void> {
    for (const folder of this.recentWorkspaceFolders.values()) {
      if (this.disposed) {
        return;
      }
      await this.coordinateWorkspace(folder);
    }
  }

  private async coordinateWorkspace(folder: vscode.WorkspaceFolder): Promise<void> {
    if (this.disposed) {
      return;
    }

    try {
      if (!this.deps.getExtension(SHADER_VALIDATOR_EXTENSION_ID)) {
        return;
      }

      const configuration = vscode.workspace.getConfiguration('shader-validator', folder.uri);
      const managedPreambleSetting = managedPreamblePath(folder);
      const effectiveValue = configuration.get<string>(SHADER_VALIDATOR_PREAMBLE_SETTING);
      if (effectiveValue === managedPreambleSetting) {
        await this.coordinateTargetClient(configuration);
        return;
      }

      if (effectiveValue === LEGACY_MANAGED_PREAMBLE_SETTING) {
        await configuration.update(
          SHADER_VALIDATOR_PREAMBLE_SETTING,
          managedPreambleSetting,
          vscode.ConfigurationTarget.Workspace,
        );
        await this.coordinateTargetClient(configuration);
        return;
      }

      const inspected = configuration.inspect<string>(SHADER_VALIDATOR_PREAMBLE_SETTING);
      const hasExistingUserValue = inspected !== undefined && [
        inspected.globalValue,
        inspected.workspaceValue,
        inspected.workspaceFolderValue,
      ].some(isNonEmptySetting);

      if (!hasExistingUserValue) {
        await configuration.update(
          SHADER_VALIDATOR_PREAMBLE_SETTING,
          managedPreambleSetting,
          vscode.ConfigurationTarget.Workspace,
        );
        await this.coordinateTargetClient(configuration);
        return;
      }

      const workspaceKey = folder.uri.toString();
      if (this.notifiedConflictWorkspaces.has(workspaceKey)) {
        return;
      }
      this.notifiedConflictWorkspaces.add(workspaceKey);
      try {
        await this.deps.showInformationMessage(
          `Shader Validator already has a GLSL preamble configured for ${folder.name}; `
            + `Shader Studio left it unchanged. To use Shader Studio's generated preamble, `
            + `manually set shader-validator.glsl.preamble to ${managedPreambleSetting}.`,
        );
      } catch (error) {
        this.notifiedConflictWorkspaces.delete(workspaceKey);
        throw error;
      }
      await this.coordinateTargetClient(configuration);
    } catch (error) {
      this.logger.error(`Unable to coordinate the Shader Validator preamble setting: ${errorText(error)}`);
    }
  }

  private async coordinateTargetClient(configuration: vscode.WorkspaceConfiguration): Promise<void> {
    const inspected = configuration.inspect<string>(SHADER_VALIDATOR_TARGET_CLIENT_SETTING);
    const hasExistingUserValue = inspected !== undefined && [
      inspected.globalValue,
      inspected.workspaceValue,
      inspected.workspaceFolderValue,
    ].some(isNonEmptySetting);
    if (hasExistingUserValue) {
      return;
    }

    await configuration.update(
      SHADER_VALIDATOR_TARGET_CLIENT_SETTING,
      SHADER_VALIDATOR_OPENGL_TARGET,
      vscode.ConfigurationTarget.Workspace,
    );
  }
}
