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
import type { ShaderConfig, ShaderSourceMessage, ErrorMessage, CustomUniformValuesMessage } from "@shader-studio/types";
import type { ShaderValidatorPreamblePreparation } from "./ShaderValidatorPreamble";

interface OwnedShaderPass {
  shaderPath: string;
  passName: string;
  config: ShaderConfig;
}

interface ActivePreamblePass {
  filePath: string;
  shaderPath: string;
  passName: string;
}

interface ActiveAnalysisContext {
  filePath: string;
  pass: ActivePreamblePass | null;
  preferredRootShaderPath: string | null;
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
  private readonly customDeclarationsByShader = new Map<string, string>();

  constructor(
    private messenger: Messenger,
    getDebugModeEnabled?: () => boolean,
    private configChangeClassifier: ConfigChangeClassifier = new ConfigChangeClassifier(),
    private readonly onPreamblePreparation?: (
      preparation: ShaderValidatorPreamblePreparation,
    ) => void | Promise<void>,
  ) {
    this.configProcessor = new ShaderConfigProcessor(this.messenger.getErrorHandler());
    this.getDebugModeEnabled = getDebugModeEnabled || (() => false);
  }

  public claimActiveAnalysisContext(filePath: string): void {
    if (getShaderLanguage(filePath) !== 'glsl') {
      return;
    }

    const contextKey = this.resolveAnalysisContextKey(filePath);
    const previous = this.activeAnalysisContexts.get(contextKey);
    this.activeAnalysisContexts.set(contextKey, {
      filePath,
      pass: null,
      preferredRootShaderPath:
        previous?.pass?.shaderPath
        ?? previous?.preferredRootShaderPath
        ?? null,
      generation: this.nextAnalysisContextGeneration++,
    });
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

    // Clear stale persistent errors before re-evaluating the shader.
    // This ensures "file not found" errors from a previous load don't survive
    // after the file has been created.
    this.messenger.getErrorHandler().clearPersistentErrors();

    if (await this.trySendNonMainImageShader(shaderPath, code, (owner) => (
      this.sendNonMainImageShaderFromEditor(owner, shaderPath, code, editor, options)
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

      if (await this.trySendNonMainImageShader(shaderPath, code, (owner) => (
        this.sendNonMainImageShaderFromPath(owner, shaderPath, code, options)
      ))) {
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

    if (await this.trySendNonMainImageShader(shaderPath, code, (owner) => (
      this.sendNonMainImageShaderFromDocument(owner, shaderPath, code, document, options)
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
      this.emitActiveRootPreamble(shaderPath, config, message, contextGeneration);

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

  private resolveOwnedShaderPassForRoot(
    filePath: string,
    shaderPath: string,
  ): OwnedShaderPass | null {
    const config = this.configProcessor.loadAndProcessConfig(shaderPath, {});
    if (!config) {
      return null;
    }
    const match = Object.entries(this.buildBufferPathMap(config, shaderPath))
      .find(([passName, candidatePath]) => passName !== "Image" && candidatePath === filePath);
    return match ? { shaderPath, passName: match[0], config } : null;
  }

  private resolveOwningShaderPass(filePath: string): OwnedShaderPass | null {
    const context = this.getActiveAnalysisContext(filePath);
    const preferredRoot = context?.pass?.shaderPath ?? context?.preferredRootShaderPath;
    if (preferredRoot) {
      const preferredOwner = this.resolveOwnedShaderPassForRoot(filePath, preferredRoot);
      if (preferredOwner) {
        return preferredOwner;
      }
    }

    const contextKey = this.resolveAnalysisContextKey(filePath);
    for (const shaderPath of this.activeShaders) {
      if (
        shaderPath === preferredRoot
        || this.resolveAnalysisContextKey(shaderPath) !== contextKey
      ) {
        continue;
      }
      const owner = this.resolveOwnedShaderPassForRoot(filePath, shaderPath);
      if (owner) {
        return owner;
      }
    }

    return null;
  }

  private async trySendNonMainImageShader(
    shaderPath: string,
    code: string,
    sendOwnedShader: (owner: OwnedShaderPass) => Promise<void>,
  ): Promise<boolean> {
    if (code.includes("mainImage")) {
      return false;
    }

    const owner = this.resolveOwningShaderPass(shaderPath);
    if (owner && owner.shaderPath !== shaderPath) {
      this.logger.debug(`Sending non-mainImage source ${shaderPath} with owner shader context ${owner.shaderPath}`);
      await sendOwnedShader(owner);
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
    this.emitActiveRootPreamble(shaderPath, config, message, expectedContextGeneration);
    this.messenger.send(message);
    this.startScriptPolling(config);
    this.logger.debug("Shader message sent to webview");

    if (trackActiveShader) {
      this.activeShaders.add(shaderPath);
    }
  }

  private async sendNonMainImageShaderFromEditor(
    owner: OwnedShaderPass,
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

    this.emitOwnedPassPreamble(owner, filePath);
    this.messenger.send(message);
  }

  private async sendNonMainImageShaderFromPath(
    owner: OwnedShaderPass,
    filePath: string,
    code: string,
    options?: { reload?: boolean },
  ): Promise<void> {
    const message = this.buildNonMainImageShaderMessage(
      filePath,
      code,
      options,
    );

    this.emitOwnedPassPreamble(owner, filePath);
    this.messenger.send(message);
  }

  // Uses the current in-memory TextDocument content, including unsaved edits.
  private async sendNonMainImageShaderFromDocument(
    owner: OwnedShaderPass,
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

    this.emitOwnedPassPreamble(owner, filePath);
    this.messenger.send(message);
  }

  private resolveActivePassName(
    rootShaderPath: string,
    config: ShaderConfig | null,
    context: ActiveAnalysisContext,
  ): string | null {
    if (context.filePath === rootShaderPath) {
      return "Image";
    }
    const preferredRoot = context.pass?.shaderPath ?? context.preferredRootShaderPath;
    if (preferredRoot && preferredRoot !== rootShaderPath) {
      return null;
    }
    return Object.entries(this.buildBufferPathMap(config, rootShaderPath))
      .find(([passName, candidatePath]) => (
        passName !== "Image" && candidatePath === context.filePath
      ))?.[0] ?? null;
  }

  private resolveRetainedActivePassName(
    rootShaderPath: string,
    context: ActiveAnalysisContext,
  ): string | null {
    if (context.filePath === rootShaderPath) {
      return "Image";
    }
    if (
      context.pass?.filePath === context.filePath
      && context.pass.shaderPath === rootShaderPath
    ) {
      return context.pass.passName;
    }
    return null;
  }

  private emitActiveRootPreamble(
    shaderPath: string,
    config: ShaderConfig | null,
    message: ShaderSourceMessage,
    expectedContextGeneration: number | null,
  ): void {
    if (getShaderLanguage(shaderPath) !== "glsl" || !this.onPreamblePreparation) {
      return;
    }

    const configPath = getConfigPathForShaderPath(shaderPath);
    const configInvalid = !config && fs.existsSync(configPath);
    const invalid = message.scriptBundleError !== undefined || configInvalid;
    if (!invalid) {
      this.customDeclarationsByShader.set(
        shaderPath,
        message.customUniformDeclarations ?? "",
      );
    }

    const context = this.getActiveAnalysisContext(shaderPath);
    if (
      expectedContextGeneration === null
      || !context
      || context.generation !== expectedContextGeneration
    ) {
      return;
    }

    const passName = configInvalid
      ? this.resolveRetainedActivePassName(shaderPath, context)
      : this.resolveActivePassName(shaderPath, config, context);
    if (!passName) {
      if (config && context.pass?.shaderPath === shaderPath) {
        context.pass = null;
      }
      return;
    }

    context.pass = {
      filePath: context.filePath,
      shaderPath,
      passName,
    };
    context.preferredRootShaderPath = shaderPath;
    this.emitPreamblePreparation(
      shaderPath,
      config,
      passName,
      this.customDeclarationsByShader.get(shaderPath),
      invalid,
    );
  }

  private emitOwnedPassPreamble(owner: OwnedShaderPass, filePath: string): void {
    const context = this.getActiveAnalysisContext(filePath);
    if (!context || context.filePath !== filePath) {
      return;
    }
    context.pass = {
      filePath,
      shaderPath: owner.shaderPath,
      passName: owner.passName,
    };
    context.preferredRootShaderPath = owner.shaderPath;
    this.emitPreamblePreparation(
      owner.shaderPath,
      owner.config,
      owner.passName,
      this.customDeclarationsByShader.get(owner.shaderPath),
      false,
    );
  }

  private emitPreamblePreparation(
    shaderPath: string,
    config: ShaderConfig | null,
    passName: string,
    customUniformDeclarations: string | undefined,
    invalid: boolean,
  ): void {
    if (getShaderLanguage(shaderPath) !== "glsl" || !this.onPreamblePreparation) {
      return;
    }
    const configPath = getConfigPathForShaderPath(shaderPath);
    const preparation: ShaderValidatorPreamblePreparation = invalid
      ? { kind: "invalid", shaderPath }
      : {
        kind: "valid",
        snapshot: {
          shaderPath,
          configPath: fs.existsSync(configPath) ? configPath : null,
          passName,
          inputs: config?.passes[passName]?.inputs,
          customUniformDeclarations,
        },
      };

    try {
      const callbackResult = this.onPreamblePreparation(preparation);
      void Promise.resolve(callbackResult).catch((error) => {
        this.logger.warn(`Failed to publish Shader Validator preamble context: ${error}`);
      });
    } catch (error) {
      this.logger.warn(`Failed to publish Shader Validator preamble context: ${error}`);
    }
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
