import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  buildWebglGlslInjection,
  isManagedWebglGlslInjection,
  type WebglGlslInjectionPreparation,
  type WebglGlslInjectionSnapshot,
} from './WebglGlslInjection';
import type { Logger } from './services/Logger';

export const WEBGL_GLSL_EDITOR_EXTENSION_ID = 'raczzalan.webgl-glsl-editor';
export const WEBGL_GLSL_EDITOR_INJECTION_ENABLED_SETTING = 'codeInjection';
export const WEBGL_GLSL_EDITOR_INJECTION_SOURCE_SETTING = 'codeInjectionSource';

interface ManagerDeps {
  getExtension(id: string): vscode.Extension<unknown> | undefined;
  getWorkspaceFolders(): readonly vscode.WorkspaceFolder[];
  isIntegrationEnabled(folder: vscode.WorkspaceFolder): boolean;
  onDidChangeExtensions(listener: () => void): vscode.Disposable;
  showInformationMessage(message: string): Thenable<string | undefined>;
}

interface WorkspaceState {
  hasValidSnapshot: boolean;
  lastValidSnapshot?: WebglGlslInjectionSnapshot;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface SettingInspection<T> {
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
}

function hasUserValue<T>(inspection: SettingInspection<T> | undefined): boolean {
  return inspection !== undefined && [
    inspection.globalValue,
    inspection.workspaceValue,
    inspection.workspaceFolderValue,
  ].some((value) => value !== undefined);
}

export class WebglGlslEditorManager implements vscode.Disposable {
  private readonly deps: ManagerDeps;
  private readonly extensionChangeListener: vscode.Disposable;
  private readonly states = new Map<string, WorkspaceState>();
  private readonly recentWorkspaceFolders = new Map<string, vscode.WorkspaceFolder>();
  private readonly notifiedConflicts = new Set<string>();
  private disposed = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly logger: Pick<Logger, 'warn' | 'error'>,
    deps?: Partial<ManagerDeps>,
  ) {
    this.deps = {
      getExtension: (id) => vscode.extensions.getExtension(id),
      getWorkspaceFolders: () => vscode.workspace.workspaceFolders ?? [],
      isIntegrationEnabled: (folder) => (
        vscode.workspace.getConfiguration('shader-studio', folder.uri)
          .get<boolean>('webglGlslEditorIntegration', true) !== false
      ),
      onDidChangeExtensions: (listener) => vscode.extensions.onDidChange(listener),
      showInformationMessage: (message) => vscode.window.showInformationMessage(message),
      ...deps,
    };
    this.extensionChangeListener = this.deps.onDidChangeExtensions(() => {
      if (!this.disposed) {
        void this.coordinateRecentWorkspaces();
      }
    });
    this.context.subscriptions.push(this.extensionChangeListener);
    this.context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
      if (!this.disposed && event.affectsConfiguration('shader-studio.webglGlslEditorIntegration')) {
        void this.coordinateRecentWorkspaces();
      }
    }));
  }

  async initializeWorkspaceFolders(): Promise<void> {
    for (const folder of this.deps.getWorkspaceFolders()) {
      await this.applyToFolder(folder, {
        kind: 'valid',
        snapshot: { shaderPath: path.join(folder.uri.fsPath, 'shader-studio.glsl'), configPath: null, passName: 'Image' },
      });
    }
  }

  async apply(preparation: WebglGlslInjectionPreparation): Promise<void> {
    const shaderPath = preparation.kind === 'valid' ? preparation.snapshot.shaderPath : preparation.shaderPath;
    let folder: vscode.WorkspaceFolder | undefined;
    try {
      folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(shaderPath));
    } catch (error) {
      this.logger.error(`Unable to resolve the WebGL GLSL Editor workspace: ${errorText(error)}`);
      return;
    }
    if (!folder) {
      this.logger.error(`Unable to configure WebGL GLSL Editor because no workspace owns ${shaderPath}.`);
      return;
    }
    await this.applyToFolder(folder, preparation);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.extensionChangeListener.dispose();
  }

  private async applyToFolder(
    folder: vscode.WorkspaceFolder,
    preparation: WebglGlslInjectionPreparation,
  ): Promise<void> {
    if (this.disposed) {
      return;
    }
    const key = folder.uri.toString();
    this.recentWorkspaceFolders.set(key, folder);
    const state = this.states.get(key) ?? { hasValidSnapshot: false };
    let snapshot: WebglGlslInjectionSnapshot;
    if (preparation.kind === 'valid') {
      state.hasValidSnapshot = true;
      state.lastValidSnapshot = preparation.snapshot;
      snapshot = preparation.snapshot;
    } else if (state.lastValidSnapshot) {
      snapshot = state.lastValidSnapshot;
    } else {
      snapshot = { shaderPath: preparation.shaderPath, configPath: null, passName: 'Image' };
    }
    this.states.set(key, state);
    try {
      const result = buildWebglGlslInjection(snapshot);
      result.warnings.forEach((warning) => this.logger.warn(warning));
      await this.coordinateWorkspace(folder, result.lines);
    } catch (error) {
      this.logger.error(`Unable to configure WebGL GLSL Editor injection: ${errorText(error)}`);
    }
  }

  private async coordinateRecentWorkspaces(): Promise<void> {
    for (const folder of this.recentWorkspaceFolders.values()) {
      const snapshot = this.states.get(folder.uri.toString())?.lastValidSnapshot
        ?? { shaderPath: path.join(folder.uri.fsPath, 'shader-studio.glsl'), configPath: null, passName: 'Image' };
      await this.applyToFolder(folder, { kind: 'valid', snapshot });
    }
  }

  private async coordinateWorkspace(folder: vscode.WorkspaceFolder, lines: string[]): Promise<void> {
    if (!this.deps.getExtension(WEBGL_GLSL_EDITOR_EXTENSION_ID)) {
      return;
    }
    const configuration = vscode.workspace.getConfiguration('webgl-glsl-editor', folder.uri);
    const existingSource = configuration.get<unknown>(WEBGL_GLSL_EDITOR_INJECTION_SOURCE_SETTING);
    const sourceInspection = configuration.inspect<unknown>(WEBGL_GLSL_EDITOR_INJECTION_SOURCE_SETTING);
    const enabledInspection = configuration.inspect<boolean>(WEBGL_GLSL_EDITOR_INJECTION_ENABLED_SETTING);
    if (!this.deps.isIntegrationEnabled(folder)) {
      if (isManagedWebglGlslInjection(existingSource)) {
        await configuration.update(
          WEBGL_GLSL_EDITOR_INJECTION_ENABLED_SETTING,
          false,
          vscode.ConfigurationTarget.Workspace,
        );
      }
      return;
    }
    if (isManagedWebglGlslInjection(existingSource)) {
      if (existingSource.join('\n') !== lines.join('\n')) {
        await configuration.update(WEBGL_GLSL_EDITOR_INJECTION_SOURCE_SETTING, lines, vscode.ConfigurationTarget.Workspace);
      }
      if (!hasUserValue(enabledInspection)) {
        await configuration.update(WEBGL_GLSL_EDITOR_INJECTION_ENABLED_SETTING, true, vscode.ConfigurationTarget.Workspace);
      }
      return;
    }
    if (!hasUserValue(sourceInspection) && !hasUserValue(enabledInspection)) {
      await configuration.update(WEBGL_GLSL_EDITOR_INJECTION_SOURCE_SETTING, lines, vscode.ConfigurationTarget.Workspace);
      await configuration.update(WEBGL_GLSL_EDITOR_INJECTION_ENABLED_SETTING, true, vscode.ConfigurationTarget.Workspace);
      return;
    }
    const key = folder.uri.toString();
    if (this.notifiedConflicts.has(key)) {
      return;
    }
    this.notifiedConflicts.add(key);
    await this.deps.showInformationMessage(
      `WebGL GLSL Editor already has code injection configured for ${folder.name}; Shader Studio left it unchanged.`,
    );
  }
}
