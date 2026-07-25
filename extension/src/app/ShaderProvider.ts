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
import { SlangShaderWorkspaceCoordinator } from './SlangShaderWorkspaceCoordinator';
import type { ShaderConfig, ShaderSourceMessage, ErrorMessage, CustomUniformValuesMessage } from "@shader-studio/types";

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
    private readonly slangWorkspaces?: SlangShaderWorkspaceCoordinator,
    private readonly slangOwnerId: string = 'shader-provider',
  ) {
    this.configProcessor = new ShaderConfigProcessor(this.messenger.getErrorHandler());
    this.getDebugModeEnabled = getDebugModeEnabled || (() => false);
  }

  public forSlangOwner(ownerId: string): ShaderProvider {
    return new ShaderProvider(
      this.messenger,
      this.getDebugModeEnabled,
      this.configChangeClassifier,
      this.slangWorkspaces,
      ownerId,
    );
  }

  public releaseSlangOwner(): void {
    this.slangWorkspaces?.releaseOwner(this.slangOwnerId);
  }

  public async sendShaderFromEditor(
    editor: vscode.TextEditor,
    options?: { reload?: boolean; dependencyChange?: boolean; manual?: boolean },
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
    );
  }

  public async sendShaderFromPath(
    shaderPath: string,
    options?: { reload?: boolean; dependencyChange?: boolean; manual?: boolean },
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

      await this.sendMainImageShader(shaderPath, code, options, undefined, false);
    } catch {
      return;
    }
  }

  // Uses the current in-memory TextDocument content, including unsaved edits.
  public async sendShaderFromDocument(
    document: vscode.TextDocument,
    options?: { reload?: boolean; dependencyChange?: boolean },
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
    options: { reload?: boolean; dependencyChange?: boolean; manual?: boolean } | undefined,
    sendOwnedShader: () => Promise<void>,
  ): Promise<boolean> {
    if (code.includes("mainImage")) {
      return false;
    }

    if (getShaderLanguage(shaderPath) === 'slang' && this.slangWorkspaces) {
      const roots = this.slangWorkspaces.owningRoots(shaderPath, code);
      if (roots.length > 0 && options?.manual) {
        return true;
      }
      if (roots.length > 0) {
        await this.sendSlangDependencyGeneration(roots);
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
    options?: { reload?: boolean; dependencyChange?: boolean; manual?: boolean },
    cursorPosition?: ShaderSourceMessage["cursorPosition"],
    trackActiveShader: boolean = false,
  ): Promise<void> {
    const buffers: Record<string, string> = {};
    const config = this.configProcessor.loadAndProcessConfig(shaderPath, buffers);

    this.logger.debug(`Sending shader update for ${shaderPath}`);
    this.logger.debug(`Sending ${Object.keys(buffers).length} buffer(s)`);

    const language = getShaderLanguage(shaderPath);
    let slangRequest: ReturnType<SlangShaderWorkspaceCoordinator['beginOwnerRequest']> | undefined;
    let prepared: Awaited<ReturnType<SlangShaderWorkspaceCoordinator['prepareRoots']>>[number] | undefined;
    if (language === 'slang' && this.slangWorkspaces) {
      slangRequest = this.slangWorkspaces.beginOwnerRequest(this.slangOwnerId, shaderPath);
      try {
        const configuredFilePaths = Object.values(this.buildBufferPathMap(config, shaderPath))
          .filter((candidate) => candidate.endsWith('.slang'));
        [prepared] = await this.slangWorkspaces.prepareRoots([{ rootPath: shaderPath, configuredFilePaths }]);
      } catch {
        return;
      }
      if (!prepared || !this.slangWorkspaces.isOwnerRequestCurrent(slangRequest)) {
        return;
      }
    }

    const message: ShaderSourceMessage = {
      type: "shaderSource",
      code,
      config,
      path: shaderPath,
      buffers,
      language,
      reload: options?.reload,
      pathMap: this.buildPathMap(config, shaderPath),
      bufferPathMap: this.buildBufferPathMap(config, shaderPath),
      cursorPosition,
    };

    if (slangRequest && prepared) {
      message.workspace = prepared.snapshot;
      message.requestId = slangRequest.token;
      message.compileGeneration = {
        id: slangRequest.token,
        rootIndex: prepared.rootIndex,
        rootCount: prepared.rootCount,
        rootPath: shaderPath,
      };
      message.compileScope = { generationId: slangRequest.token, rootUris: [prepared.snapshot.rootUri], ownerId: this.slangOwnerId };
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
    if (slangRequest && (!this.slangWorkspaces?.isOwnerRequestCurrent(slangRequest) || !prepared)) {
      return;
    }
    this.messenger.send(message);
    if (slangRequest && prepared) {
      this.slangWorkspaces?.commitOwnerRequest(slangRequest, prepared);
    }
    this.startScriptPolling(config);
    this.logger.debug("Shader message sent to webview");

    if (trackActiveShader) {
      this.activeShaders.add(shaderPath);
    }
  }

  /** Sends all affected Slang roots as one ordered, all-or-nothing generation. */
  private async sendSlangDependencyGeneration(rootPaths: readonly string[]): Promise<void> {
    if (!this.slangWorkspaces) {
      return;
    }
    const orderedPaths = [...new Set(rootPaths)].sort((left, right) => left.localeCompare(right));
    const inputs: { path: string; code: string; config: ShaderConfig | null; buffers: Record<string, string>; configuredFilePaths: string[] }[] = [];
    for (const rootPath of orderedPaths) {
      try {
        if (!fs.existsSync(rootPath)) {
          return;
        }
        const code = fs.readFileSync(rootPath, 'utf-8');
        const buffers: Record<string, string> = {};
        const config = this.configProcessor.loadAndProcessConfig(rootPath, buffers);
        const configuredFilePaths = Object.values(this.buildBufferPathMap(config, rootPath))
          .filter((candidate) => candidate.endsWith('.slang'));
        inputs.push({ path: rootPath, code, config, buffers, configuredFilePaths });
      } catch {
        return;
      }
    }
    const requests = this.slangWorkspaces.beginOwnerRequests(this.slangOwnerId, orderedPaths);
    let prepared: readonly Awaited<ReturnType<SlangShaderWorkspaceCoordinator['prepareRoots']>>[number][];
    try {
      prepared = await this.slangWorkspaces.prepareRoots(inputs.map((input) => ({
        rootPath: input.path,
        configuredFilePaths: input.configuredFilePaths,
      })));
    } catch {
      return;
    }
    const requestsByUri = new Map(requests.map((request) => [request.rootUri, request]));
    const inputByPath = new Map(inputs.map((input) => [input.path, input]));
    if (prepared.length !== requests.length || !requests.every((request) => this.slangWorkspaces!.isOwnerRequestCurrent(request))) {
      return;
    }
    const messages: { request: typeof requests[number]; prepared: typeof prepared[number]; message: ShaderSourceMessage; config: ShaderConfig | null }[] = [];
    for (const root of prepared) {
      const request = requestsByUri.get(root.rootUri);
      const input = inputByPath.get(root.rootPath);
      if (!request || !input) {
        return;
      }
      const message: ShaderSourceMessage = {
        type: 'shaderSource', code: input.code, config: input.config, path: input.path, buffers: input.buffers,
        language: 'slang', pathMap: this.buildPathMap(input.config, input.path),
        bufferPathMap: this.buildBufferPathMap(input.config, input.path), workspace: root.snapshot,
        requestId: request.token,
        compileGeneration: { id: request.token, rootIndex: root.rootIndex, rootCount: root.rootCount, rootPath: input.path },
        compileScope: { generationId: request.token, rootUris: prepared.map((entry) => entry.snapshot.rootUri), ownerId: this.slangOwnerId },
      };
      messages.push({ request, prepared: root, message, config: input.config });
    }
    for (const entry of messages) {
      await this.bundleScript(entry.config, entry.message.path, entry.message);
      if (!requests.every((request) => this.slangWorkspaces!.isOwnerRequestCurrent(request))) {
        return;
      }
    }
    if (!requests.every((request) => this.slangWorkspaces!.isOwnerRequestCurrent(request))) {
      return;
    }
    if (!this.slangWorkspaces.commitOwnerRequests(messages.map(({ request, prepared: root }) => ({ request, prepared: root })))) {
      return;
    }
    for (const entry of messages) {
      this.messenger.send(entry.message);
    }
    for (const entry of messages) {
      this.startScriptPolling(entry.config);
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
