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
import { collectSlangDependencies } from "./SlangDependencyGraph";
import type {
  ShaderConfig,
  ShaderSourceMessage,
  CustomUniformValuesMessage,
  SlangDependencyDiagnostic,
  SlangSourceModule,
} from "@shader-studio/types";

export class ShaderProvider {
  private logger = Logger.getInstance();
  private activeShaders: Set<string> = new Set(); // Track currently active shader paths
  private configProcessor: ShaderConfigProcessor;
  private getDebugModeEnabled: () => boolean;
  private scriptBundler = new ScriptBundler();
  private scriptEvaluator = new ScriptEvaluator();

  constructor(
    private messenger: Messenger,
    getDebugModeEnabled?: () => boolean,
    private configChangeClassifier: ConfigChangeClassifier = new ConfigChangeClassifier(),
    private getLockedShaderPath: () => string | undefined = () => undefined,
  ) {
    this.configProcessor = new ShaderConfigProcessor(this.messenger.getErrorHandler());
    this.getDebugModeEnabled = getDebugModeEnabled || (() => false);
  }

  public async sendShaderFromEditor(
    editor: vscode.TextEditor,
    options?: { reload?: boolean },
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
    let cursorPosition: ShaderSourceMessage["cursorPosition"];
    if (this.getDebugModeEnabled()) {
      const line = editor.selection.active.line;
      cursorPosition = {
        line,
        character: editor.selection.active.character,
        lineContent: editor.document.lineAt(line).text,
        filePath: shaderPath,
      };
    }

    // Clear stale persistent errors before re-evaluating the shader.
    // This ensures "file not found" errors from a previous load don't survive
    // after the file has been created.
    this.messenger.getErrorHandler().clearPersistentErrors();

    if (await this.trySendNonMainImageShader(shaderPath, code, () => (
      this.sendNonMainImageShaderFromEditor(shaderPath, code, editor, options)
    ), options, cursorPosition)) {
      return;
    }

    await this.sendMainImageShader(
      shaderPath,
      code,
      options,
      cursorPosition,
      true,
    );
  }

  public async sendShaderFromPath(
    shaderPath: string,
    options?: { reload?: boolean },
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

      if (await this.trySendNonMainImageShader(shaderPath, code, () => (
        this.sendNonMainImageShaderFromPath(shaderPath, code, options)
      ), options)) {
        return;
      }

      await this.sendMainImageShader(shaderPath, code, options, undefined, false);
    } catch {
      return;
    }
  }

  // Uses the current in-memory TextDocument content, including unsaved edits.
  public async sendShaderFromDocument(
    document: vscode.TextDocument,
    options?: { reload?: boolean },
  ): Promise<void> {
    if (!this.messenger || !isShaderDocument(document)) {
      return;
    }

    const shaderPath = document.uri.fsPath;
    const code = document.getText();

    this.messenger.getErrorHandler().clearPersistentErrors();

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

    if (await this.trySendNonMainImageShader(shaderPath, code, () => (
      this.sendNonMainImageShaderFromDocument(shaderPath, code, document, options)
    ), options, cursorPosition)) {
      return;
    }

    await this.sendMainImageShader(shaderPath, code, options, cursorPosition, true);
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
        language: getShaderLanguage(shaderPath),
        pathMap,
        bufferPathMap,
      };

      if (message.language === "slang") {
        this.attachSlangDependencies(message);
      }

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
    sendOwnedShader: () => Promise<void>,
    options?: { reload?: boolean },
    cursorPosition?: ShaderSourceMessage["cursorPosition"],
  ): Promise<boolean> {
    if (code.includes("mainImage")) {
      return false;
    }

    const ownerShaderPath = this.resolveOwningShaderPath(shaderPath);
    if (ownerShaderPath && ownerShaderPath !== shaderPath) {
      this.logger.debug(`Sending non-mainImage source ${shaderPath} with owner shader context ${ownerShaderPath}`);
      await sendOwnedShader();
      return true;
    }


    const lockedShaderPath = this.getLockedShaderPath();
    const dependencyOwnerPath = lockedShaderPath
      ? this.resolveOwningSlangDependency(shaderPath)
      : null;
    if (dependencyOwnerPath && path.normalize(dependencyOwnerPath) === path.normalize(lockedShaderPath!)) {
      const ownerSource = this.readShaderSource(dependencyOwnerPath);
      if (ownerSource !== null) {
        this.logger.debug(`Sending imported Slang source ${shaderPath} with owner shader context ${dependencyOwnerPath}`);
        await this.sendMainImageShader(
          dependencyOwnerPath,
          ownerSource,
          options,
          cursorPosition,
          false,
        );
        return true;
      }
    }

    // Treat an unlocked file without an entry point as a normal shader switch.
    // Both renderers clear the previous shader when compilation fails for a
    // different path, while preserving last-good output for same-path edits.
    await sendOwnedShader();
    return true;
  }

  private resolveOwningSlangDependency(filePath: string): string | null {
    const normalizedFilePath = path.normalize(filePath);
    for (const shaderPath of this.activeShaders) {
      if (getShaderLanguage(shaderPath) !== "slang") {
        continue;
      }
      const source = this.readShaderSource(shaderPath);
      if (source === null) {
        continue;
      }
      const buffers: Record<string, string> = {};
      const config = this.configProcessor.loadAndProcessConfig(shaderPath, buffers);
      const bufferPathMap = this.buildBufferPathMap(config, shaderPath);
      const roots = [{ passName: "Image", rootPath: shaderPath, rootSource: source }];
      for (const [passName, rootSource] of Object.entries(buffers)) {
        const rootPath = bufferPathMap[passName];
        if (rootPath) {
          roots.push({ passName, rootPath, rootSource });
        }
      }
      for (const root of roots) {
        const result = collectSlangDependencies({
          rootPath: root.rootPath,
          rootSource: root.rootSource,
          ownerPass: root.passName,
          readSource: (dependencyPath) => this.readShaderSource(dependencyPath),
        });
        if (result.modules.some((module) => path.normalize(module.path) === normalizedFilePath)) {
          return shaderPath;
        }
      }
    }
    return null;
  }

  private async sendMainImageShader(
    shaderPath: string,
    code: string,
    options?: { reload?: boolean },
    cursorPosition?: ShaderSourceMessage["cursorPosition"],
    trackActiveShader: boolean = false,
  ): Promise<void> {
    const buffers: Record<string, string> = {};
    const config = this.configProcessor.loadAndProcessConfig(shaderPath, buffers);

    this.logger.debug(`Sending shader update for ${shaderPath}`);
    this.logger.debug(`Sending ${Object.keys(buffers).length} buffer(s)`);

    const message: ShaderSourceMessage = {
      type: "shaderSource",
      code,
      config,
      path: shaderPath,
      buffers,
      language: getShaderLanguage(shaderPath),
      reload: options?.reload,
      pathMap: this.buildPathMap(config, shaderPath),
      bufferPathMap: this.buildBufferPathMap(config, shaderPath),
      cursorPosition,
    };

    if (message.language === "slang") {
      this.attachSlangDependencies(message);
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

    if (trackActiveShader) {
      this.activeShaders.add(shaderPath);
    }
  }

  private async sendNonMainImageShaderFromEditor(
    filePath: string,
    code: string,
    editor: vscode.TextEditor,
    options?: { reload?: boolean },
  ): Promise<void> {
    const activePosition = this.getDebugModeEnabled()
      ? editor.selection.active
      : undefined;
    const message = this.buildNonMainImageShaderMessage(
      filePath,
      code,
      options,
      activePosition
        ? {
          line: activePosition.line,
          character: activePosition.character,
          lineContent: editor.document.lineAt(activePosition.line).text,
          filePath,
        }
        : undefined,
    );

    this.messenger.send(message);
  }

  private attachSlangDependencies(message: ShaderSourceMessage): void {
    const bufferPathMap = message.bufferPathMap ?? this.buildBufferPathMap(message.config ?? null, message.path);
    const roots: Array<{ passName: string; filePath: string; source: string }> = [{
      passName: "Image",
      filePath: message.path,
      source: message.code,
    }];
    for (const [passName, source] of Object.entries(message.buffers ?? {})) {
      const filePath = bufferPathMap[passName];
      if (filePath) {
        roots.push({ passName, filePath, source });
      }
    }

    const modules: SlangSourceModule[] = [];
    const errors: SlangDependencyDiagnostic[] = [];
    const renderPassNames = roots
      .map((root) => root.passName)
      .filter((passName) => passName !== "common");
    for (const root of roots) {
      const owners = root.passName === "common" ? renderPassNames : [root.passName];
      for (const ownerPass of owners) {
        const result = collectSlangDependencies({
          rootPath: root.filePath,
          rootSource: root.source,
          ownerPass,
          readSource: (filePath) => this.readShaderSource(filePath),
        });
        modules.push(...result.modules);
        errors.push(...result.errors);
      }
    }
    message.slangModules = Array.from(new Map(
      modules.map((module) => [`${module.ownerPass}\0${module.moduleName}\0${module.path}`, module]),
    ).values());
    message.slangDependencyDiagnostics = Array.from(new Map(
      errors.map((error) => [`${error.code}\0${error.importerPath}\0${error.moduleName}`, error]),
    ).values());
  }

  private readShaderSource(filePath: string): string | null {
    const openDocument = vscode.workspace.textDocuments.find(
      (document) => path.normalize(document.uri.fsPath) === path.normalize(filePath),
    );
    if (openDocument) {
      return openDocument.getText();
    }
    try {
      return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : null;
    } catch {
      return null;
    }
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
    const message: ShaderSourceMessage = {
      type: "shaderSource",
      code,
      config: null,
      path: filePath,
      buffers: {},
      language: getShaderLanguage(filePath),
      reload: true,
      cursorPosition,
    };

    if (message.language === "slang") {
      this.attachSlangDependencies(message);
    }

    return message;
  }

}
