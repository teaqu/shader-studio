import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { Messenger } from "./transport/Messenger";
import { Logger } from "./services/Logger";
import { isShaderDocument, getShaderLanguage } from "./GlslFileTracker";
import { ShaderConfigProcessor } from "./ShaderConfigProcessor";
import { ConfigPathConverter } from "./transport/ConfigPathConverter";
import { PathResolver } from "./PathResolver";
import { ScriptBundler } from "./ScriptBundler";
import { ScriptEvaluator } from "./ScriptEvaluator";
import { ConfigChangeClassifier } from "./services/ConfigChangeClassifier";
import { getConfigPathForShaderPath } from "./ShaderConfigPaths";
import {
  createSlangShaderWorkspaceHost,
  SlangShaderWorkspaceCoordinator,
} from "./SlangShaderWorkspaceCoordinator";
import type { ShaderConfig, ShaderSourceMessage, ErrorMessage, CustomUniformValuesMessage } from "@shader-studio/types";

export interface ShaderSendOptions {
  reload?: boolean;
  ownerId?: string;
}

export class ShaderProvider {
  private logger = Logger.getInstance();
  private activeShaders: Set<string> = new Set(); // Track currently active shader paths
  private configProcessor: ShaderConfigProcessor;
  private getDebugModeEnabled: () => boolean;
  private scriptBundler = new ScriptBundler();
  private scriptEvaluator = new ScriptEvaluator();
  private readonly slangWorkspaceCoordinator: SlangShaderWorkspaceCoordinator;
  private nextCompileGeneration = 1;

  constructor(
    private messenger: Messenger,
    getDebugModeEnabled?: () => boolean,
    private configChangeClassifier: ConfigChangeClassifier = new ConfigChangeClassifier(),
    slangWorkspaceCoordinator?: SlangShaderWorkspaceCoordinator,
  ) {
    this.configProcessor = new ShaderConfigProcessor(this.messenger.getErrorHandler());
    this.getDebugModeEnabled = getDebugModeEnabled || (() => false);
    this.slangWorkspaceCoordinator = slangWorkspaceCoordinator
      ?? new SlangShaderWorkspaceCoordinator(createSlangShaderWorkspaceHost());
  }

  public async sendShaderFromEditor(
    editor: vscode.TextEditor,
    options?: ShaderSendOptions,
  ): Promise<void> {
    if (!this.messenger) {
      return;
    }
    const doc = editor?.document;
    if (!doc || !isShaderDocument(doc)) {
      return;
    }

    const code = editor.document.getText();
    const shaderPath = editor.document.uri.fsPath;

    // Clear stale persistent errors before re-evaluating the shader.
    // This ensures "file not found" errors from a previous load don't survive
    // after the file has been created.
    this.messenger.getErrorHandler().clearPersistentErrors();

    if (await this.trySendNonMainImageShader(shaderPath, code, options, () => (
      this.sendNonMainImageShaderFromEditor(shaderPath, code, editor, options)
    ))) {
      return;
    }

    const line = editor.selection.active.line;
    await this.sendMainImageShader(
      shaderPath,
      code,
      options,
      this.getDebugModeEnabled()
        ? {
          line,
          character: editor.selection.active.character,
          lineContent: editor.document.lineAt(line).text,
          filePath: shaderPath,
        }
        : undefined,
      true,
      options?.ownerId ?? "active-editor",
    );
  }

  public async sendShaderFromPath(
    shaderPath: string,
    options?: ShaderSendOptions,
  ): Promise<void> {
    if (!this.messenger) {
      return;
    }

    try {
      if (!fs.existsSync(shaderPath)) {
        return;
      }

      // Clear stale persistent errors before re-evaluating
      this.messenger.getErrorHandler().clearPersistentErrors();

      const code = fs.readFileSync(shaderPath, "utf-8");

      if (await this.trySendNonMainImageShader(shaderPath, code, options, () => (
        this.sendNonMainImageShaderFromPath(shaderPath, code, options)
      ))) {
        return;
      }

      await this.sendMainImageShader(
        shaderPath,
        code,
        options,
        undefined,
        false,
        options?.ownerId ?? "active-editor",
      );
    } catch {
      return;
    }
  }

  // Uses the current in-memory TextDocument content, including unsaved edits.
  public async sendShaderFromDocument(
    document: vscode.TextDocument,
    options?: ShaderSendOptions,
  ): Promise<void> {
    if (!this.messenger || !isShaderDocument(document)) {
      return;
    }

    const shaderPath = document.uri.fsPath;
    const code = document.getText();

    this.messenger.getErrorHandler().clearPersistentErrors();

    if (await this.trySendNonMainImageShader(shaderPath, code, options, () => (
      this.sendNonMainImageShaderFromDocument(shaderPath, code, document, options)
    ))) {
      return;
    }

    let cursorPosition: ShaderSourceMessage["cursorPosition"];
    if (this.getDebugModeEnabled()) {
      const matchingEditor = vscode.window.visibleTextEditors.find(
        (editor) => editor.document.uri.fsPath === shaderPath,
      );
      if (matchingEditor) {
        const line = Math.min(matchingEditor.selection.active.line, document.lineCount - 1);
        cursorPosition = {
          line,
          character: matchingEditor.selection.active.character,
          lineContent: document.lineAt(line).text,
          filePath: shaderPath,
        };
      }
    }

    await this.sendMainImageShader(
      shaderPath,
      code,
      options,
      cursorPosition,
      true,
      options?.ownerId ?? "active-editor",
    );
  }

  public async sendAffectedSlangRoots(
    filePath: string,
    source?: string,
    options?: ShaderSendOptions,
  ): Promise<void> {
    let currentSource = source;
    if (currentSource === undefined && fs.existsSync(filePath)) {
      try {
        currentSource = fs.readFileSync(filePath, "utf-8");
      } catch {
        currentSource = undefined;
      }
    }
    await this.sendSlangRootBatch(
      this.slangWorkspaceCoordinator.owningRoots(filePath, currentSource),
      options,
    );
  }

  public releaseSlangRootOwner(ownerId: string): void {
    this.slangWorkspaceCoordinator.releaseOwner(ownerId);
  }

  /**
   * Re-send the active shader, bundling the script from in-memory content
   * (the unsaved editor buffer) instead of from disk.
   */
  public async sendShaderWithScriptContent(
    shaderPath: string,
    scriptContent: string,
  ): Promise<void> {
    if (!this.messenger) {
      return;
    }

    try {
      if (!fs.existsSync(shaderPath)) {
        return;
      }

      const code = fs.readFileSync(shaderPath, "utf-8");
      if (!code.includes("mainImage")) {
        return;
      }

      const buffers: Record<string, string> = {};
      const config = this.configProcessor.loadAndProcessConfig(shaderPath, buffers);
      const pathMap = this.buildPathMap(config, shaderPath);
      const bufferPathMap = this.buildBufferPathMap(config, shaderPath);

      const message: ShaderSourceMessage = {
        type: "shaderSource",
        code,
        config,
        path: shaderPath,
        buffers,
        pathMap,
        bufferPathMap,
      };

      await this.bundleScript(config, shaderPath, message, scriptContent);

      this.messenger.send(message);
      this.startScriptPolling(config);
    } catch {
      return;
    }
  }

  /**
   * Load the config for a shader path (lightweight, no buffer processing).
   */
  public getActiveConfig(shaderPath: string): ShaderConfig | null {
    return this.configProcessor.loadAndProcessConfig(shaderPath, {});
  }

  /**
   * Get the resolved script path for a shader config, if any.
   */
  public getScriptPath(config: ShaderConfig | null, shaderPath: string): string | null {
    if (!config?.script) {
      return null;
    }
    return PathResolver.resolvePath(shaderPath, config.script);
  }

  private async bundleScript(
    config: ShaderConfig | null,
    shaderPath: string,
    message: ShaderSourceMessage,
    scriptContent?: string,
  ): Promise<void> {
    const scriptPath = this.getScriptPath(config, shaderPath);
    if (!scriptPath) {
      this.scriptEvaluator.dispose();
      return;
    }

    // When bundling from editor content, skip the file existence check
    if (scriptContent === undefined && !fs.existsSync(scriptPath)) {
      message.scriptBundleError = `Script file not found: ${config!.script}`;
      this.scriptEvaluator.dispose();
      return;
    }

    const result = await this.scriptBundler.bundle(scriptPath, scriptContent);
    if (!result.success || !result.code) {
      message.scriptBundleError = result.error || "Unknown bundling error";
      this.scriptEvaluator.dispose();
      return;
    }

    // Evaluate script in extension host (Node.js context) to get declarations
    const loadResult = this.scriptEvaluator.loadScript(result.code, scriptPath);
    if (loadResult.error) {
      message.scriptBundleError = loadResult.error;
      return;
    }

    // Send declarations and type info (not the bundle) to the webview
    message.customUniformDeclarations = loadResult.declarations;
    message.customUniformInfo = loadResult.uniforms;
  }

  /**
   * Start polling uniform values after the shader message has been sent.
   * Must be called after messenger.send() so the webview has compiled the shader
   * and created the CustomUniformManager before values arrive.
   */
  private startScriptPolling(config: ShaderConfig | null): void {
    if (!this.scriptEvaluator.hasUniforms()) {
      return;
    }
    const pollingFps = config?.scriptMaxPollingFps ?? 30;
    const pollingMs = Math.round(1000 / pollingFps);
    this.scriptEvaluator.startPolling((values) => {
      const valuesMessage: CustomUniformValuesMessage = {
        type: "customUniformValues",
        payload: { values },
      };
      this.messenger.send(valuesMessage);
    }, pollingMs);
  }

  /**
   * Update the script polling rate without resetting the shader.
   */
  public updateScriptPollingRate(fps: number): void {
    const pollingMs = Math.round(1000 / fps);
    this.scriptEvaluator.updatePollingRate(pollingMs);
  }

  /**
   * Reset the script time origin (called on shader reset).
   */
  public resetScriptTime(): void {
    this.scriptEvaluator.resetTime();
  }

  /**
   * Build a path map for converting resource paths to webview URIs
   */
  private buildPathMap(config: ShaderConfig | null, shaderPath: string): Record<string, string> {
    const pathMap: Record<string, string> = {};

    if (!config) {
      return pathMap;
    }

    try {
      const configDir = path.dirname(shaderPath);
      const webview = this.messenger.getWebview();

      if (!webview) {
        return pathMap;
      }

      // Collect all texture/video paths and convert them
      for (const [passName, pass] of Object.entries(config.passes || {})) {
        if (pass && typeof pass === 'object' && 'inputs' in pass) {
          const inputs = pass.inputs;
          if (inputs) {
            for (const key of Object.keys(inputs)) {
              const input = inputs[key as keyof typeof inputs];
              if (input && typeof input === 'object' && 'path' in input && input.path) {
                const originalPath = input.path as string;
                // Resolve relative path to absolute
                const absolutePath = path.isAbsolute(originalPath)
                  ? originalPath
                  : path.join(configDir, originalPath);
                // Convert to webview URI
                const webviewUri = ConfigPathConverter.convertUriForClient(absolutePath, webview);
                pathMap[originalPath] = webviewUri;
              }
            }
          }
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to build path map: ${error}`);
    }

    return pathMap;
  }

  /**
   * Build a map of buffer names to their absolute file paths.
   * Used by the UI to sync buffer tab selection with VS Code editor tabs.
   */
  private buildBufferPathMap(config: ShaderConfig | null, shaderPath: string): Record<string, string> {
    const bufferPathMap: Record<string, string> = { Image: shaderPath };

    if (!config?.passes) {
      return bufferPathMap;
    }

    for (const [passName, pass] of Object.entries(config.passes)) {
      if (passName === 'Image') {
        continue;
      }
      if (pass && typeof pass === 'object' && 'path' in pass && pass.path && typeof pass.path === 'string') {
        bufferPathMap[passName] = PathResolver.resolvePath(shaderPath, pass.path);
      }
    }

    return bufferPathMap;
  }

  private resolveOwningShaderPath(filePath: string): string | null {
    for (const shaderPath of this.activeShaders) {
      const config = this.configProcessor.loadAndProcessConfig(shaderPath, {});
      const bufferPathMap = this.buildBufferPathMap(config, shaderPath);
      const matchedPath = Object.entries(bufferPathMap).find(([passName, candidatePath]) => {
        if (passName === 'Image') {
          return false;
        }
        return candidatePath === filePath;
      });
      if (matchedPath) {
        return shaderPath;
      }
    }

    return null;
  }

  private async trySendNonMainImageShader(
    shaderPath: string,
    code: string,
    options: ShaderSendOptions | undefined,
    sendOwnedShader: () => Promise<void>,
  ): Promise<boolean> {
    const slangOwners = getShaderLanguage(shaderPath) === "slang"
      ? this.slangWorkspaceCoordinator.owningRoots(shaderPath, code)
      : [];
    if (slangOwners.some((owner) => owner !== shaderPath)) {
      this.logger.debug(`Recompiling ${slangOwners.length} Slang root(s) affected by ${shaderPath}`);
      await this.sendSlangRootBatch(slangOwners, options);
      return true;
    }

    if (code.includes("mainImage")) {
      return false;
    }

    if (getShaderLanguage(shaderPath) === "slang") {
      if (slangOwners.length > 0) {
        this.logger.debug(`Recompiling ${slangOwners.length} Slang root(s) affected by ${shaderPath}`);
        await this.sendSlangRootBatch(slangOwners, options);
        return true;
      }
    }

    const ownerShaderPath = this.resolveOwningShaderPath(shaderPath);
    if (ownerShaderPath && ownerShaderPath !== shaderPath) {
      this.logger.debug(`Sending non-mainImage source ${shaderPath} with owner shader context ${ownerShaderPath}`);
      await sendOwnedShader();
      return true;
    }

    const errorMsg: ErrorMessage = {
      type: "error",
      payload: ["Missing mainImage function"],
    };
    this.messenger.send(errorMsg);
    return true;
  }

  private async sendMainImageShader(
    shaderPath: string,
    code: string,
    options?: ShaderSendOptions,
    cursorPosition?: ShaderSourceMessage["cursorPosition"],
    trackActiveShader: boolean = false,
    ownerId?: string,
    compileGeneration?: ShaderSourceMessage["compileGeneration"],
  ): Promise<void> {
    const buffers: Record<string, string> = {};
    const config = this.configProcessor.loadAndProcessConfig(shaderPath, buffers);
    const bufferPathMap = this.buildBufferPathMap(config, shaderPath);
    const language = getShaderLanguage(shaderPath);

    this.logger.debug(`Sending shader update for ${shaderPath}`);
    this.logger.debug(`Sending ${Object.keys(buffers).length} buffer(s)`);

    const message: ShaderSourceMessage = {
      type: "shaderSource",
      code,
      config,
      path: shaderPath,
      buffers,
      language,
      reload: options?.reload,
      pathMap: this.buildPathMap(config, shaderPath),
      bufferPathMap,
      cursorPosition,
    };

    if (language === "slang") {
      if (ownerId) {
        this.slangWorkspaceCoordinator.activateRoot(ownerId, shaderPath);
      }
      message.workspace = await this.slangWorkspaceCoordinator.registerRoot(
        shaderPath,
        Object.entries(bufferPathMap)
          .filter(([passName]) => passName !== "Image")
          .map(([, filePath]) => filePath),
      );
      message.compileGeneration = compileGeneration ?? {
        id: this.nextCompileGeneration++,
        rootIndex: 0,
        rootCount: 1,
        rootPath: shaderPath,
      };
    } else if (ownerId) {
      this.slangWorkspaceCoordinator.releaseOwner(ownerId);
    }

    // Snapshot the RAW config file text (not the processed `config` above, which
    // injects resolved_path etc. and would make every diff look structural) so the
    // next watcher/fallback change can be classified against what we actually sent.
    const configPath = getConfigPathForShaderPath(shaderPath);
    try {
      this.configChangeClassifier.recordSentConfig(configPath, fs.readFileSync(configPath, "utf-8"));
    } catch {
      this.configChangeClassifier.recordSentConfig(configPath, null);
    }

    await this.bundleScript(config, shaderPath, message);
    this.messenger.send(message);
    this.startScriptPolling(config);
    this.logger.debug("Shader message sent to webview");

    if (trackActiveShader || language === "slang") {
      this.activeShaders.add(shaderPath);
    }
  }

  private async sendSlangRoot(
    rootPath: string,
    options?: ShaderSendOptions,
    compileGeneration?: ShaderSourceMessage["compileGeneration"],
  ): Promise<void> {
    const openDocument = vscode.workspace.textDocuments.find(
      (document) => document.uri.fsPath === rootPath,
    );
    if (openDocument) {
      await this.sendMainImageShader(
        rootPath,
        openDocument.getText(),
        options,
        undefined,
        true,
        undefined,
        compileGeneration,
      );
      return;
    }
    if (!fs.existsSync(rootPath)) {
      this.activeShaders.delete(rootPath);
      this.slangWorkspaceCoordinator.removeRoot(rootPath);
      return;
    }
    await this.sendMainImageShader(
      rootPath,
      fs.readFileSync(rootPath, "utf-8"),
      options,
      undefined,
      true,
      undefined,
      compileGeneration,
    );
  }

  private async sendSlangRootBatch(
    rootPaths: readonly string[],
    options?: ShaderSendOptions,
  ): Promise<void> {
    const roots = [...new Set(rootPaths)]
      .filter((rootPath) => {
        const canSend = fs.existsSync(rootPath) || vscode.workspace.textDocuments.some(
          (document) => document.uri.fsPath === rootPath,
        );
        if (!canSend) {
          this.activeShaders.delete(rootPath);
          this.slangWorkspaceCoordinator.removeRoot(rootPath);
        }
        return canSend;
      })
      .sort();
    if (roots.length === 0) {
      return;
    }
    const id = this.nextCompileGeneration++;
    for (const [rootIndex, rootPath] of roots.entries()) {
      await this.sendSlangRoot(rootPath, options, {
        id,
        rootIndex,
        rootCount: roots.length,
        rootPath,
      });
    }
  }

  private async sendNonMainImageShaderFromEditor(
    filePath: string,
    code: string,
    editor: vscode.TextEditor,
    options?: { reload?: boolean },
  ): Promise<void> {
    const line = editor.selection.active.line;
    const message = this.buildNonMainImageShaderMessage(
      filePath,
      code,
      options,
      this.getDebugModeEnabled()
        ? {
          line,
          character: editor.selection.active.character,
          lineContent: editor.document.lineAt(line).text,
          filePath,
        }
        : undefined,
    );

    this.messenger.send(message);
  }

  private async sendNonMainImageShaderFromPath(
    filePath: string,
    code: string,
    options?: { reload?: boolean },
  ): Promise<void> {
    const message = this.buildNonMainImageShaderMessage(
      filePath,
      code,
      options,
    );

    this.messenger.send(message);
  }

  // Uses the current in-memory TextDocument content, including unsaved edits.
  private async sendNonMainImageShaderFromDocument(
    filePath: string,
    code: string,
    document: vscode.TextDocument,
    options?: { reload?: boolean },
  ): Promise<void> {
    let cursorPosition: ShaderSourceMessage["cursorPosition"];

    if (this.getDebugModeEnabled()) {
      const matchingEditor = vscode.window.visibleTextEditors.find(
        (editor) => editor.document.uri.fsPath === document.uri.fsPath,
      );
      if (matchingEditor) {
        const line = Math.min(matchingEditor.selection.active.line, document.lineCount - 1);
        cursorPosition = {
          line,
          character: matchingEditor.selection.active.character,
          lineContent: document.lineAt(line).text,
          filePath,
        };
      }
    }

    const message = this.buildNonMainImageShaderMessage(
      filePath,
      code,
      options,
      cursorPosition,
    );

    this.messenger.send(message);
  }

  private buildNonMainImageShaderMessage(
    filePath: string,
    code: string,
    options?: { reload?: boolean },
    cursorPosition?: ShaderSourceMessage["cursorPosition"],
  ): ShaderSourceMessage {
    return {
      type: "shaderSource",
      code,
      config: null,
      path: filePath,
      buffers: {},
      reload: true,
      cursorPosition,
    };
  }

}
