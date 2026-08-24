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
import { collectSlangDependencies, resolveSlangIncludes, resolveSlangImports } from "./SlangDependencyGraph";
import type {
  ShaderConfig,
  ShaderSourceMessage,
  ErrorMessage,
  CustomUniformValuesMessage,
  SlangDependencyDiagnostic,
  SlangSourceModule,
} from "@shader-studio/types";
import {
  clearCustomUniformSnapshot,
  publishCustomUniformSnapshot,
} from "../language-services/ShaderAuthoringEnvironmentProvider";

interface ActiveAnalysisContext {
  generation: number;
}

const EXTENSION_HOST_CONTEXT_KEY = 'shader-studio:extension-host';

export class ShaderProvider {
  private logger = Logger.getInstance();
  private activeShaders: Set<string> = new Set(); // Track currently active shader paths
  private configProcessor: ShaderConfigProcessor;
  private getDebugModeEnabled: () => boolean;
  private scriptBundler = new ScriptBundler();
  private scriptEvaluator = new ScriptEvaluator();
  private readonly activeAnalysisContexts = new Map<string, ActiveAnalysisContext>();
  private nextAnalysisContextGeneration = 1;
  private readonly preparationGenerations = new Map<string, number>();

  constructor(
    private messenger: Messenger,
    getDebugModeEnabled?: () => boolean,
    private configChangeClassifier: ConfigChangeClassifier = new ConfigChangeClassifier(),
    private readonly getLockedShaderPath: () => string | undefined = () => undefined,
  ) {
    this.configProcessor = new ShaderConfigProcessor(this.messenger.getErrorHandler());
    this.getDebugModeEnabled = getDebugModeEnabled || (() => false);
  }

  public claimActiveAnalysisContext(filePath: string): void {
    if (getShaderLanguage(filePath) !== 'glsl') {
      return;
    }

    const contextKey = this.resolveAnalysisContextKey(filePath);
    this.activeAnalysisContexts.set(contextKey, {
      generation: this.nextAnalysisContextGeneration++,
    });
  }

  public isLockedToDifferentShader(shaderPath: string): boolean {
    const lockedShaderPath = this.getLockedShaderPath();
    return Boolean(
      lockedShaderPath
      && path.normalize(lockedShaderPath) !== path.normalize(shaderPath)
    );
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
    const contextGeneration = this.captureAnalysisContextGeneration(shaderPath);
    const selection = editor.selection?.active;
    const cursorPosition = this.getDebugModeEnabled() && selection
      ? {
        line: selection.line,
        character: selection.character,
        lineContent: editor.document.lineAt(selection.line).text,
        filePath: shaderPath,
      }
      : undefined;

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
      contextGeneration,
    );
  }

  public async sendShaderFromPath(
    shaderPath: string,
    options?: { reload?: boolean },
  ): Promise<void> {
    if (!this.messenger) {
      return;
    }
    const contextGeneration = this.captureAnalysisContextGeneration(shaderPath);

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

      await this.sendMainImageShader(
        shaderPath,
        code,
        options,
        undefined,
        false,
        contextGeneration,
      );
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
    const contextGeneration = this.captureAnalysisContextGeneration(shaderPath);

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

    await this.sendMainImageShader(
      shaderPath,
      code,
      options,
      cursorPosition,
      true,
      contextGeneration,
    );
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

    const preparationGeneration = this.beginPreparation(shaderPath);
    const contextGeneration = this.captureAnalysisContextGeneration(shaderPath);
    const isCurrentPreparation = () => (
      this.isCurrentPreparation(shaderPath, preparationGeneration)
    );
    const isCurrentAnalysisContext = () => (
      this.isCurrentAnalysisContext(shaderPath, contextGeneration)
    );

    try {
      if (!fs.existsSync(shaderPath)) {
        return;
      }

      const code = fs.readFileSync(shaderPath, "utf-8");
      if (!code.includes("mainImage") && getShaderLanguage(shaderPath) !== "slang") {
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
      if (getShaderLanguage(shaderPath) === "slang") {
        message.language = "slang";
        message.originalCode = code;
        this.attachSlangDependencies(message);
      }

      const prepared = await this.bundleScript(
        config,
        shaderPath,
        message,
        scriptContent,
        isCurrentPreparation,
        isCurrentAnalysisContext,
      );
      if (
        !prepared
        || !isCurrentPreparation()
        || !this.isCurrentAnalysisContext(shaderPath, contextGeneration)
      ) {
        return;
      }
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
    isCurrentPreparation: () => boolean = () => true,
    isCurrentAnalysisContext: () => boolean = () => true,
  ): Promise<boolean> {
    const scriptPath = this.getScriptPath(config, shaderPath);
    if (!scriptPath) {
      if (!isCurrentAnalysisContext()) {
        return false;
      }
      this.scriptEvaluator.dispose();
      clearCustomUniformSnapshot(shaderPath);
      return isCurrentPreparation();
    }

    // When bundling from editor content, skip the file existence check
    if (scriptContent === undefined && !fs.existsSync(scriptPath)) {
      if (!isCurrentAnalysisContext()) {
        return false;
      }
      message.scriptBundleError = `Script file not found: ${config!.script}`;
      this.scriptEvaluator.dispose();
      return isCurrentPreparation();
    }

    const result = await this.scriptBundler.bundle(scriptPath, scriptContent);
    if (!isCurrentPreparation() || !isCurrentAnalysisContext()) {
      return false;
    }
    if (!result.success || !result.code) {
      message.scriptBundleError = result.error || "Unknown bundling error";
      this.scriptEvaluator.dispose();
      return true;
    }

    // Evaluate script in extension host (Node.js context) to get declarations
    const loadResult = this.scriptEvaluator.loadScript(result.code, scriptPath);
    if (loadResult.error) {
      message.scriptBundleError = loadResult.error;
      return true;
    }

    // Send declarations and type info (not the bundle) to the webview
    message.customUniformDeclarations = loadResult.declarations;
    message.customUniformInfo = loadResult.uniforms;
    publishCustomUniformSnapshot(shaderPath, loadResult.uniforms);
    return true;
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
          if (pass.geometry?.type === 'model') {
            const originalPath = pass.geometry.path;
            const absolutePath = path.isAbsolute(originalPath) ? originalPath : path.join(configDir, originalPath);
            pathMap[originalPath] = ConfigPathConverter.convertUriForClient(absolutePath, webview);
          }
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
      if (passName !== 'Image' && pass && typeof pass === 'object' && 'path' in pass && pass.path && typeof pass.path === 'string') {
        bufferPathMap[passName] = PathResolver.resolvePath(shaderPath, pass.path);
      }
      if (pass && typeof pass === 'object' && 'vertex' in pass && typeof pass.vertex === 'string' && pass.vertex) {
        bufferPathMap[`__shader_studio_vertex__:${passName}`] = PathResolver.resolvePath(shaderPath, pass.vertex);
      }
    }

    return bufferPathMap;
  }

  private resolveAnalysisContextKey(filePath: string): string {
    try {
      return vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath))?.uri.toString()
        ?? EXTENSION_HOST_CONTEXT_KEY;
    } catch {
      return EXTENSION_HOST_CONTEXT_KEY;
    }
  }

  private getActiveAnalysisContext(filePath: string): ActiveAnalysisContext | undefined {
    return this.activeAnalysisContexts.get(this.resolveAnalysisContextKey(filePath));
  }

  private captureAnalysisContextGeneration(filePath: string): number | null {
    return this.getActiveAnalysisContext(filePath)?.generation ?? null;
  }

  private isCurrentAnalysisContext(
    filePath: string,
    generation: number | null,
  ): boolean {
    return generation === null || this.getActiveAnalysisContext(filePath)?.generation === generation;
  }

  private beginPreparation(shaderPath: string): number {
    const generation = (this.preparationGenerations.get(shaderPath) ?? 0) + 1;
    this.preparationGenerations.set(shaderPath, generation);
    return generation;
  }

  private isCurrentPreparation(shaderPath: string, generation: number): boolean {
    return this.preparationGenerations.get(shaderPath) === generation;
  }

  private async trySendNonMainImageShader(
    shaderPath: string,
    code: string,
    sendNonMainShader: () => Promise<void>,
    options?: { reload?: boolean },
    cursorPosition?: ShaderSourceMessage["cursorPosition"],
  ): Promise<boolean> {
    const language = getShaderLanguage(shaderPath);
    if (code.includes("mainImage")) {
      return false;
    }

    if (language === "slang") {
      const lockedShaderPath = this.getLockedShaderPath();
      const dependencyOwnerPath = lockedShaderPath
        ? this.resolveOwningSlangDependency(shaderPath)
        : null;
      if (dependencyOwnerPath && path.normalize(dependencyOwnerPath) === path.normalize(lockedShaderPath!)) {
        const ownerSource = this.readShaderSource(dependencyOwnerPath);
        if (ownerSource !== null) {
          await this.sendMainImageShader(dependencyOwnerPath, ownerSource, options, cursorPosition, false);
          return true;
        }
      }
      await sendNonMainShader();
      return true;
    }

    await sendNonMainShader();
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
        if (path.normalize(root.rootPath) === normalizedFilePath) {
          return shaderPath;
        }
        // Check import dependencies
        const result = collectSlangDependencies({
          rootPath: root.rootPath,
          rootSource: root.rootSource,
          ownerPass: root.passName,
          readSource: (dependencyPath) => this.readShaderSource(dependencyPath),
        });
        if (result.modules.some((module) => path.normalize(module.path) === normalizedFilePath)) {
          return shaderPath;
        }
        // Check include dependencies
        const { includedPaths } = resolveSlangIncludes(
          root.rootSource, root.rootPath, (p) => this.readShaderSource(p),
        );
        if (includedPaths.some((p) => path.normalize(p) === normalizedFilePath)) {
          return shaderPath;
        }
      }
    }
    return null;
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

  private refreshPreparedCursorPosition(
    cursorPosition: ShaderSourceMessage["cursorPosition"],
  ): ShaderSourceMessage["cursorPosition"] {
    if (!cursorPosition || !this.getDebugModeEnabled()) {
      return cursorPosition;
    }
    const editor = vscode.window.visibleTextEditors.find(
      (candidate) => path.normalize(candidate.document.uri.fsPath) === path.normalize(cursorPosition.filePath),
    );
    if (!editor) {
      return cursorPosition;
    }
    const line = Math.max(0, Math.min(editor.selection.active.line, editor.document.lineCount - 1));
    return {
      line,
      character: editor.selection.active.character,
      lineContent: editor.document.lineAt(line).text,
      filePath: cursorPosition.filePath,
    };
  }

  private async sendMainImageShader(
    shaderPath: string,
    code: string,
    options?: { reload?: boolean },
    cursorPosition?: ShaderSourceMessage["cursorPosition"],
    trackActiveShader: boolean = false,
    expectedContextGeneration: number | null = this.captureAnalysisContextGeneration(shaderPath),
  ): Promise<void> {
    const preparationGeneration = this.beginPreparation(shaderPath);
    const isCurrentPreparation = () => (
      this.isCurrentPreparation(shaderPath, preparationGeneration)
    );
    const isCurrentAnalysisContext = () => (
      this.isCurrentAnalysisContext(shaderPath, expectedContextGeneration)
    );
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
      message.originalCode = code;
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

    const prepared = await this.bundleScript(
      config,
      shaderPath,
      message,
      undefined,
      isCurrentPreparation,
      isCurrentAnalysisContext,
    );
    if (
      !prepared
      || !isCurrentPreparation()
      || !this.isCurrentAnalysisContext(shaderPath, expectedContextGeneration)
    ) {
      return;
    }
    message.cursorPosition = this.refreshPreparedCursorPosition(message.cursorPosition);
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
    const line = editor.selection?.active.line ?? 0;
    const message = this.buildNonMainImageShaderMessage(
      filePath,
      code,
      options,
      this.getDebugModeEnabled()
        ? {
          line,
          character: editor.selection?.active.character ?? 0,
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
      message.originalCode = code;
      this.attachSlangDependencies(message);
    }
    return message;
  }

  private attachSlangDependencies(message: ShaderSourceMessage): void {
    const bufferPathMap = message.bufferPathMap ?? this.buildBufferPathMap(message.config ?? null, message.path);

    // Build roots from the ORIGINAL sources — before inlining
    // includes/imports — so dependency tracking sees the directives.
    const roots: Array<{ passName: string; filePath: string; source: string }> = [{
      passName: "Image", filePath: message.path, source: message.code,
    }];
    for (const [passName, source] of Object.entries(message.buffers ?? {})) {
      const filePath = bufferPathMap[passName];
      if (filePath) {
        roots.push({ passName, filePath, source });
      }
    }

    // Step 1: Collect import dependencies BEFORE inlining (for hot reload).
    const modules: SlangSourceModule[] = [];
    const errors: SlangDependencyDiagnostic[] = [];
    const renderPassNames = roots.map((root) => root.passName).filter((passName) => passName !== "common");
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

    // Step 2: Resolve #include / __include directives. Hot reload of
    // include files is handled by resolveOwningSlangDependency which also
    // checks resolveSlangIncludes for dependency matching.
    const imageResult = resolveSlangIncludes(message.code, message.path, (p) => this.readShaderSource(p));
    message.code = imageResult.source;
    for (const [passName, source] of Object.entries(message.buffers ?? {})) {
      const filePath = bufferPathMap[passName];
      if (filePath) {
        message.buffers[passName] = resolveSlangIncludes(source, filePath, (p) => this.readShaderSource(p)).source;
      }
    }

    // Step 3: Resolve import declarations by inlining the imported source.
    message.code = resolveSlangImports(message.code, message.path, (p) => this.readShaderSource(p));
    for (const [passName, source] of Object.entries(message.buffers ?? {})) {
      const filePath = bufferPathMap[passName];
      if (filePath) {
        message.buffers[passName] = resolveSlangImports(source, filePath, (p) => this.readShaderSource(p));
      }
    }

    message.slangModules = Array.from(new Map(
      modules.map((module) => [`${module.ownerPass}\0${module.moduleName}\0${module.path}`, module]),
    ).values());
    message.slangDependencyDiagnostics = Array.from(new Map(
      errors.map((error) => [`${error.code}\0${error.importerPath}\0${error.moduleName}`, error]),
    ).values());
  }

}
