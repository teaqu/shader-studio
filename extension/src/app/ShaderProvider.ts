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
  type SlangRootSpec,
  SlangShaderWorkspaceCoordinator,
} from "./SlangShaderWorkspaceCoordinator";
import type { ShaderConfig, ShaderSourceMessage, ErrorMessage, CustomUniformValuesMessage } from "@shader-studio/types";

export interface ShaderSendOptions {
  reload?: boolean;
  ownerId?: string;
}

export interface SlangSourceChange {
  filePath: string;
  source?: string;
}

interface PreparedShaderSend {
  config: ShaderConfig | null;
  evaluator: ScriptEvaluator;
  language: "glsl" | "slang";
  message: ShaderSourceMessage;
  shaderPath: string;
  trackActiveShader: boolean;
}

export class ShaderProvider {
  private logger = Logger.getInstance();
  private activeShaders: Set<string> = new Set(); // Track currently active shader paths
  private configProcessor: ShaderConfigProcessor;
  private getDebugModeEnabled: () => boolean;
  private scriptBundler = new ScriptBundler();
  private scriptEvaluator = new ScriptEvaluator();
  private readonly slangWorkspaceCoordinator: SlangShaderWorkspaceCoordinator;
  private nextRequestId = 1;
  private latestSlangRootRequests = new Map<string, number>();

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
    const requestId = this.nextRequestId++;
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

    if (await this.trySendNonMainImageShader(shaderPath, code, options, requestId, () => (
      this.sendNonMainImageShaderFromEditor(shaderPath, code, editor, options, requestId)
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
      requestId,
    );
  }

  public async sendShaderFromPath(
    shaderPath: string,
    options?: ShaderSendOptions,
  ): Promise<void> {
    const requestId = this.nextRequestId++;
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

      if (await this.trySendNonMainImageShader(shaderPath, code, options, requestId, () => (
        this.sendNonMainImageShaderFromPath(shaderPath, code, options, requestId)
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
        requestId,
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
    const requestId = this.nextRequestId++;
    if (!this.messenger || !isShaderDocument(document)) {
      return;
    }

    const shaderPath = document.uri.fsPath;
    const code = document.getText();

    this.messenger.getErrorHandler().clearPersistentErrors();

    if (await this.trySendNonMainImageShader(shaderPath, code, options, requestId, () => (
      this.sendNonMainImageShaderFromDocument(shaderPath, code, document, options, requestId)
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
      requestId,
    );
  }

  public async sendAffectedSlangRoots(
    filePath: string,
    source?: string,
    options?: ShaderSendOptions,
  ): Promise<void> {
    await this.sendAffectedSlangChanges([{ filePath, source }], options);
  }

  public async sendAffectedSlangChanges(
    changes: readonly SlangSourceChange[],
    options?: ShaderSendOptions,
  ): Promise<void> {
    const requestId = this.nextRequestId++;
    const roots = new Set<string>();
    for (const change of changes) {
      let currentSource = change.source;
      if (currentSource === undefined && fs.existsSync(change.filePath)) {
        try {
          currentSource = fs.readFileSync(change.filePath, "utf-8");
        } catch {
          currentSource = undefined;
        }
      }
      for (const root of this.slangWorkspaceCoordinator.owningRoots(change.filePath, currentSource)) {
        roots.add(root);
      }
    }
    await this.sendSlangRootBatch([...roots].sort(), options, requestId);
  }

  public releaseSlangRootOwner(ownerId: string): void {
    this.slangWorkspaceCoordinator.releaseOwner(ownerId);
  }

  public activateSlangRootOwner(ownerId: string, rootPath: string): void {
    this.slangWorkspaceCoordinator.activateRoot(ownerId, rootPath);
  }

  /**
   * Re-send the active shader, bundling the script from in-memory content
   * (the unsaved editor buffer) instead of from disk.
   */
  public async sendShaderWithScriptContent(
    shaderPath: string,
    scriptContent: string,
  ): Promise<void> {
    const requestId = this.nextRequestId++;
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
      const evaluator = new ScriptEvaluator();

      const message: ShaderSourceMessage = {
        type: "shaderSource",
        requestId,
        compileScope: this.compileScope(shaderPath, requestId),
        code,
        config,
        path: shaderPath,
        buffers,
        language: getShaderLanguage(shaderPath),
        pathMap,
        bufferPathMap,
      };

      await this.bundleScript(config, shaderPath, message, scriptContent, evaluator);
      if (requestId < this.nextRequestId - 1) {
        evaluator.dispose();
        return;
      }
      this.commitPreparedShader({
        config,
        evaluator,
        language: message.language ?? "glsl",
        message,
        shaderPath,
        trackActiveShader: false,
      });
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
    evaluator: ScriptEvaluator = this.scriptEvaluator,
  ): Promise<void> {
    const scriptPath = this.getScriptPath(config, shaderPath);
    if (!scriptPath) {
      evaluator.dispose();
      return;
    }

    // When bundling from editor content, skip the file existence check
    if (scriptContent === undefined && !fs.existsSync(scriptPath)) {
      message.scriptBundleError = `Script file not found: ${config!.script}`;
      evaluator.dispose();
      return;
    }

    const result = await this.scriptBundler.bundle(scriptPath, scriptContent);
    if (!result.success || !result.code) {
      message.scriptBundleError = result.error || "Unknown bundling error";
      evaluator.dispose();
      return;
    }

    // Evaluate script in extension host (Node.js context) to get declarations
    const loadResult = evaluator.loadScript(result.code, scriptPath);
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
    requestId: number = this.nextRequestId++,
    sendOwnedShader: () => Promise<void>,
  ): Promise<boolean> {
    const slangOwners = getShaderLanguage(shaderPath) === "slang"
      ? this.slangWorkspaceCoordinator.owningRoots(shaderPath, code)
      : [];
    if (slangOwners.some((owner) => owner !== shaderPath)) {
      this.logger.debug(`Recompiling ${slangOwners.length} Slang root(s) affected by ${shaderPath}`);
      await this.sendSlangRootBatch(slangOwners, options, requestId);
      return true;
    }

    if (code.includes("mainImage")) {
      return false;
    }

    if (getShaderLanguage(shaderPath) === "slang") {
      if (slangOwners.length > 0) {
        this.logger.debug(`Recompiling ${slangOwners.length} Slang root(s) affected by ${shaderPath}`);
        await this.sendSlangRootBatch(slangOwners, options, requestId);
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
    requestId: number = this.nextRequestId++,
    compileGeneration?: ShaderSourceMessage["compileGeneration"],
  ): Promise<void> {
    const language = getShaderLanguage(shaderPath);
    if (language === "slang") {
      this.markSlangRootRequest(shaderPath, requestId);
    }
    const ownerRequest = ownerId
      ? this.slangWorkspaceCoordinator.beginOwnerRequest(ownerId, shaderPath)
      : undefined;
    const buffers: Record<string, string> = {};
    const config = this.configProcessor.loadAndProcessConfig(shaderPath, buffers);
    const bufferPathMap = this.buildBufferPathMap(config, shaderPath);
    const spec = this.rootSpec(shaderPath, bufferPathMap);
    const preparedRoot = language === "slang"
      ? (await this.slangWorkspaceCoordinator.prepareRoots([spec]))[0]
      : undefined;
    if (language === "slang" && !preparedRoot) {
      throw new Error(`Could not prepare Slang root "${shaderPath}"`);
    }
    const prepared = await this.prepareShaderSend({
      shaderPath,
      code,
      config,
      buffers,
      bufferPathMap,
      language,
      options,
      cursorPosition,
      trackActiveShader: trackActiveShader || language === "slang",
      requestId,
      compileGeneration: language === "slang"
        ? compileGeneration ?? { id: requestId, rootIndex: 0, rootCount: 1, rootPath: shaderPath }
        : undefined,
      workspace: preparedRoot?.snapshot,
      diagnosticOwnerId: ownerId,
    });

    const current = (language !== "slang" || this.isSlangRootRequestCurrent(shaderPath, requestId)) && (ownerRequest
      ? language === "slang"
        ? this.slangWorkspaceCoordinator.commitOwnerRequest(ownerRequest, preparedRoot!)
        : this.slangWorkspaceCoordinator.commitOwnerRelease(ownerRequest)
      : true);
    if (!current) {
      prepared.evaluator.dispose();
      return;
    }
    this.commitPreparedShader(prepared);
  }

  private async sendSlangRootBatch(
    rootPaths: readonly string[],
    options?: ShaderSendOptions,
    requestId: number = this.nextRequestId++,
  ): Promise<void> {
    const roots = [...new Set(rootPaths)]
      .filter((rootPath) => {
        const canSend = fs.existsSync(rootPath) || vscode.workspace.textDocuments.some(
          (document) => document.uri.fsPath === rootPath,
        );
        if (!canSend) {
          this.activeShaders.delete(rootPath);
          this.latestSlangRootRequests.delete(rootPath);
          this.slangWorkspaceCoordinator.removeRoot(rootPath);
        }
        return canSend;
      })
      .sort();
    for (const rootPath of roots) {
      this.markSlangRootRequest(rootPath, requestId);
    }
    if (roots.length === 0) {
      return;
    }
    const inputs = roots.map((rootPath) => this.loadRootInput(rootPath, options, requestId));
    const availableInputs = inputs.filter((input): input is NonNullable<typeof input> => input !== null);
    if (availableInputs.length === 0) {
      return;
    }
    const preparedRoots = await this.slangWorkspaceCoordinator.prepareRoots(
      availableInputs.map((input) => input.spec),
    );
    const rootsByPath = new Map(preparedRoots.map((prepared) => [prepared.rootPath, prepared]));
    const preparedMessages: PreparedShaderSend[] = [];
    try {
      for (const input of availableInputs) {
        const workspace = rootsByPath.get(input.shaderPath)?.snapshot;
        if (!workspace) {
          throw new Error(`Could not prepare Slang root "${input.shaderPath}"`);
        }
        preparedMessages.push(await this.prepareShaderSend({ ...input, workspace }));
      }
    } catch (error) {
      preparedMessages.forEach((prepared) => prepared.evaluator.dispose());
      throw error;
    }
    const currentMessages = preparedMessages.filter((prepared) => (
      this.isSlangRootRequestCurrent(prepared.shaderPath, requestId)
    ));
    for (const prepared of preparedMessages) {
      if (!currentMessages.includes(prepared)) {
        prepared.evaluator.dispose();
      }
    }
    const stillAvailable = currentMessages.filter((prepared) => this.rootIsAvailable(prepared.shaderPath));
    const availablePaths = new Set(stillAvailable.map((prepared) => prepared.shaderPath));
    for (const prepared of currentMessages) {
      if (!availablePaths.has(prepared.shaderPath)) {
        prepared.evaluator.dispose();
        this.activeShaders.delete(prepared.shaderPath);
        this.latestSlangRootRequests.delete(prepared.shaderPath);
        this.slangWorkspaceCoordinator.removeRoot(prepared.shaderPath);
      }
    }
    const committedRoots = this.slangWorkspaceCoordinator.commitActiveRoots(
      preparedRoots.filter((prepared) => availablePaths.has(prepared.rootPath)),
    );
    const committedPaths = new Set(committedRoots.map((prepared) => prepared.rootPath));
    const batch = stillAvailable.filter((prepared) => committedPaths.has(prepared.shaderPath));
    for (const [rootIndex, prepared] of batch.entries()) {
      prepared.message.compileGeneration = {
        id: requestId,
        rootIndex,
        rootCount: batch.length,
        rootPath: prepared.shaderPath,
      };
      this.commitPreparedShader(prepared);
    }
    for (const prepared of stillAvailable) {
      if (!committedPaths.has(prepared.shaderPath)) {
        prepared.evaluator.dispose();
      }
    }
  }

  private async sendNonMainImageShaderFromEditor(
    filePath: string,
    code: string,
    editor: vscode.TextEditor,
    options?: { reload?: boolean },
    requestId: number = this.nextRequestId++,
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
      requestId,
    );

    this.messenger.send(message);
  }

  private async sendNonMainImageShaderFromPath(
    filePath: string,
    code: string,
    options?: { reload?: boolean },
    requestId: number = this.nextRequestId++,
  ): Promise<void> {
    const message = this.buildNonMainImageShaderMessage(
      filePath,
      code,
      options,
      undefined,
      requestId,
    );

    this.messenger.send(message);
  }

  // Uses the current in-memory TextDocument content, including unsaved edits.
  private async sendNonMainImageShaderFromDocument(
    filePath: string,
    code: string,
    document: vscode.TextDocument,
    options?: { reload?: boolean },
    requestId: number = this.nextRequestId++,
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
      requestId,
    );

    this.messenger.send(message);
  }

  private buildNonMainImageShaderMessage(
    filePath: string,
    code: string,
    options?: { reload?: boolean },
    cursorPosition?: ShaderSourceMessage["cursorPosition"],
    requestId: number = this.nextRequestId++,
  ): ShaderSourceMessage {
    return {
      type: "shaderSource",
      requestId,
      compileScope: this.compileScope(filePath, requestId),
      code,
      config: null,
      path: filePath,
      buffers: {},
      reload: true,
      cursorPosition,
    };
  }

  private rootSpec(
    shaderPath: string,
    bufferPathMap: Readonly<Record<string, string>>,
  ): SlangRootSpec {
    return {
      rootPath: shaderPath,
      configuredFilePaths: Object.entries(bufferPathMap)
        .filter(([passName]) => passName !== "Image")
        .map(([, filePath]) => filePath),
    };
  }

  private loadRootInput(
    shaderPath: string,
    options: ShaderSendOptions | undefined,
    requestId: number,
  ): ({
    shaderPath: string;
    code: string;
    config: ShaderConfig | null;
    buffers: Record<string, string>;
    bufferPathMap: Record<string, string>;
    language: "slang";
    options: ShaderSendOptions | undefined;
    trackActiveShader: true;
    requestId: number;
    spec: SlangRootSpec;
  } | null) {
    const document = vscode.workspace.textDocuments.find(
      (candidate) => candidate.uri.fsPath === shaderPath,
    );
    let code: string;
    if (document) {
      code = document.getText();
    } else {
      try {
        code = fs.readFileSync(shaderPath, "utf-8");
      } catch {
        return null;
      }
    }
    const buffers: Record<string, string> = {};
    const config = this.configProcessor.loadAndProcessConfig(shaderPath, buffers);
    const bufferPathMap = this.buildBufferPathMap(config, shaderPath);
    return {
      shaderPath,
      code,
      config,
      buffers,
      bufferPathMap,
      language: "slang",
      options,
      trackActiveShader: true,
      requestId,
      spec: this.rootSpec(shaderPath, bufferPathMap),
    };
  }

  private rootIsAvailable(shaderPath: string): boolean {
    return fs.existsSync(shaderPath) || vscode.workspace.textDocuments.some(
      (document) => document.uri.fsPath === shaderPath,
    );
  }

  private markSlangRootRequest(rootPath: string, requestId: number): void {
    this.latestSlangRootRequests.set(
      rootPath,
      Math.max(this.latestSlangRootRequests.get(rootPath) ?? 0, requestId),
    );
  }

  private isSlangRootRequestCurrent(rootPath: string, requestId: number): boolean {
    return this.latestSlangRootRequests.get(rootPath) === requestId;
  }

  private async prepareShaderSend(args: {
    shaderPath: string;
    code: string;
    config: ShaderConfig | null;
    buffers: Record<string, string>;
    bufferPathMap: Record<string, string>;
    language: "glsl" | "slang";
    options?: ShaderSendOptions;
    cursorPosition?: ShaderSourceMessage["cursorPosition"];
    trackActiveShader: boolean;
    requestId: number;
    compileGeneration?: ShaderSourceMessage["compileGeneration"];
    workspace?: ShaderSourceMessage["workspace"];
    diagnosticOwnerId?: string;
  }): Promise<PreparedShaderSend> {
    const evaluator = new ScriptEvaluator();
    const message: ShaderSourceMessage = {
      type: "shaderSource",
      requestId: args.requestId,
      compileScope: this.compileScope(args.shaderPath, args.requestId, args.diagnosticOwnerId),
      code: args.code,
      config: args.config,
      path: args.shaderPath,
      buffers: args.buffers,
      language: args.language,
      workspace: args.workspace,
      compileGeneration: args.compileGeneration,
      reload: args.options?.reload,
      pathMap: this.buildPathMap(args.config, args.shaderPath),
      bufferPathMap: args.bufferPathMap,
      cursorPosition: args.cursorPosition,
    };
    try {
      await this.bundleScript(args.config, args.shaderPath, message, undefined, evaluator);
      return {
        config: args.config,
        evaluator,
        language: args.language,
        message,
        shaderPath: args.shaderPath,
        trackActiveShader: args.trackActiveShader,
      };
    } catch (error) {
      evaluator.dispose();
      throw error;
    }
  }

  private commitPreparedShader(prepared: PreparedShaderSend): void {
    const configPath = getConfigPathForShaderPath(prepared.shaderPath);
    try {
      this.configChangeClassifier.recordSentConfig(configPath, fs.readFileSync(configPath, "utf-8"));
    } catch {
      this.configChangeClassifier.recordSentConfig(configPath, null);
    }
    this.scriptEvaluator.dispose();
    this.scriptEvaluator = prepared.evaluator;
    this.messenger.send(prepared.message);
    this.startScriptPolling(prepared.config);
    if (prepared.trackActiveShader) {
      this.activeShaders.add(prepared.shaderPath);
    }
  }

  private compileScope(shaderPath: string, generationId: number, ownerId?: string) {
    return {
      rootUris: [vscode.Uri.file(shaderPath).toString()],
      ...(ownerId ? { ownerId } : {}),
      generationId,
    };
  }

}
