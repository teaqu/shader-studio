import type { RenderingEngine } from "../../../rendering/src/types/RenderingEngine";
import type { ShaderLocker } from "./ShaderLocker";
import type { Transport } from "./transport/MessageTransport";
import type {
  CompileDiagnosticScope,
  CursorPositionMessage,
  ErrorMessage,
  LogMessage,
  RefreshMessage,
  ShaderSourceMessage,
  WarningMessage,
} from "@shader-studio/types";
import { BufferUpdater } from './util/BufferUpdater';
import { BufferPathResolver } from './util/BufferPathResolver';
import { ShaderDebugManager } from './ShaderDebugManager';
import { ShaderProcessor, type CompilationResult } from './ShaderProcessor';
import { getEditorOverlayVisible } from './state/editorOverlayState.svelte';
import {
  getShaderRequestScope,
  type ShaderCompilationState,
} from './state/ShaderCompilationState.svelte';
import type { ShaderConfig } from "@shader-studio/types";

export class ShaderPipeline {
  private renderEngine: RenderingEngine;
  private shaderLocker: ShaderLocker;
  private transport: Transport;
  private bufferUpdater: BufferUpdater;
  private bufferPathResolver: BufferPathResolver;
  private shaderDebugManager: ShaderDebugManager;
  private shaderProcessor: ShaderProcessor;
  private lastEvent: MessageEvent | null = null;
  private pendingShaderEvents: Array<{
    event: MessageEvent;
    resolve: (result: CompilationResult | undefined) => void;
  }> = [];
  private readonly compilationGenerations = new Map<number, {
    rootCount: number;
    results: Map<string, {
      compileScope?: CompileDiagnosticScope;
      index: number;
      result: CompilationResult | null;
    }>;
  }>();
  private latestCompileGenerationId = 0;
  private compilationState: (
    Pick<ShaderCompilationState, 'setResult'>
    & Partial<Pick<ShaderCompilationState, 'acceptRequest'>>
  ) | null = null;
  private debugCompileInFlight = false;
  private debugCompilePending = false;

  constructor(
    transport: Transport,
    renderEngine: RenderingEngine,
    shaderLocker: ShaderLocker,
    shaderDebugManager: ShaderDebugManager,
    compilationState?: Pick<ShaderCompilationState, 'setResult'>
      & Partial<Pick<ShaderCompilationState, 'acceptRequest'>>,
  ) {
    this.transport = transport;
    this.renderEngine = renderEngine;
    this.shaderLocker = shaderLocker;
    this.bufferUpdater = new BufferUpdater(renderEngine, transport);
    this.bufferPathResolver = new BufferPathResolver(renderEngine);
    this.shaderDebugManager = shaderDebugManager;
    this.shaderProcessor = new ShaderProcessor(renderEngine, shaderDebugManager);
    this.compilationState = compilationState ?? null;
  }

  public setCompilationState(
    compilationState: Pick<ShaderCompilationState, 'setResult'>
      & Partial<Pick<ShaderCompilationState, 'acceptRequest'>> | null,
  ): void {
    this.compilationState = compilationState;
  }

  public async handleShaderMessage(
    event: MessageEvent,
  ): Promise<CompilationResult | undefined> {
    try {
      const message = event.data as ShaderSourceMessage;
      const { type, code, config, path, buffers = {}, cursorPosition } = message;

      if (!this.isValidShaderMessage(type)) {
        return undefined;
      }

      if (!this.acceptRequest(message)) {
        return undefined;
      }

      if (!this.acceptCompileGeneration(message)) {
        return undefined;
      }

      if (this.shaderProcessor.isCurrentlyProcessing()) {
        return await new Promise<CompilationResult | undefined>((resolve) => {
          const currentGeneration = message.compileGeneration;
          if (currentGeneration) {
            const duplicate = this.pendingShaderEvents.some(({ event: pendingEvent }) => {
              const pending = pendingEvent.data as ShaderSourceMessage;
              const pendingGeneration = pending.compileGeneration;
              return pendingGeneration?.id === currentGeneration.id
                && pendingGeneration.rootPath === currentGeneration.rootPath;
            });
            if (duplicate || this.isGenerationRootCompleted(message)) {
              resolve(undefined);
              return;
            }
            this.pendingShaderEvents.push({ event, resolve });
            return;
          }

          const legacyIndex = this.pendingShaderEvents.findIndex(({ event: pendingEvent }) => (
            !(pendingEvent.data as ShaderSourceMessage).compileGeneration
          ));
          if (legacyIndex >= 0) {
            this.pendingShaderEvents[legacyIndex].resolve(undefined);
            this.pendingShaderEvents.splice(legacyIndex, 1, { event, resolve });
          } else {
            this.pendingShaderEvents.push({ event, resolve });
          }
        });
      }

      if (this.isGenerationRootCompleted(message)) {
        this.drainPendingShaderEvent();
        return undefined;
      }

      // Update cursor position if provided. Don't notify capture here: the
      // currentShaderCode reactive change fires the $effect, and the paired
      // standalone cursorPosition message handles the capture trigger.
      if (cursorPosition) {
        const { line, lineContent, filePath } = cursorPosition;

        // If shader is locked, accept cursors from the locked file and its buffer files
        if (this.isCursorFileAccepted(filePath, message)) {
          this.shaderDebugManager.updateDebugLine(line, lineContent, filePath, false);
        }
      }

      if (this.shaderLocker.isLocked()) {
        const currentBufferName =
          path && this.bufferPathResolver.getBufferNameForFilePath(path);
        const lockedPath = this.shaderLocker.getLockedShaderPath();

        if (lockedPath === undefined || lockedPath !== path) {
          if (!this.hasBufferContent(buffers, code)) {
            // Skip processing entirely - shader is locked to a different path or path is undefined
            this.completeSkippedGeneration(message);
            return undefined;
          }

          // Check if this is a common buffer file update
          if (currentBufferName === 'common') {
            this.syncStoredShaderContextForBufferUpdate(currentBufferName, code);
            // For common buffer files, we need special handling since they don't have mainImage
            return await this.handleCommonBufferUpdate(path, buffers, code);
          }

          if (!currentBufferName) {
            this.completeSkippedGeneration(message);
            return undefined;
          }

          this.syncStoredShaderContextForBufferUpdate(currentBufferName, code);
          this.bufferUpdater.updateBuffer(path, buffers, code);
          // BufferUpdater returns void (fire-and-forget), so we're done here
          this.completeSkippedGeneration(message);
          return undefined;
        }
      }

      return await this.processMainShaderCompilation(message, event);

    } catch (err) {
      this.handleFatalError(err, event);
      return {
        success: false,
        errors: [`Fatal error: ${err}`]
      };
    }
  }

  private isValidShaderMessage(type: string): boolean {
    return type === "shaderSource";
  }

  private acceptRequest(message: ShaderSourceMessage): boolean {
    const lockedPath = this.shaderLocker.isLocked()
      ? this.shaderLocker.getLockedShaderPath()
      : undefined;
    const scope = getShaderRequestScope(message.path, lockedPath);
    return this.compilationState?.acceptRequest?.(message, scope) ?? true;
  }

  private hasBufferContent(buffers: Record<string, string>, code: string): boolean {
    return Object.keys(buffers).length > 0 || !!code;
  }

  private async handleCommonBufferUpdate(_path: string, _buffers: Record<string, string>, _code: string): Promise<CompilationResult> {
    // Common updates are only valid while locked; refresh the locked main shader
    // so the pipeline picks up the updated common content.
    this.refresh(this.shaderLocker.getLockedShaderPath());
    return { success: true };
  }

  private async processMainShaderCompilation(
    message: ShaderSourceMessage,
    event: MessageEvent
  ): Promise<CompilationResult | undefined> {
    this.lastEvent = event;

    this.shaderDebugManager.setShaderContext(
      message.config ?? null,
      message.path,
      message.buffers ?? {},
    );

    const result = await this.shaderProcessor.processMainShaderCompilation(
      message,
      message.reload || false,
    );
    this.handleCompilationResult(result, message);

    this.drainPendingShaderEvent();

    if (result.superseded) {
      return undefined;
    }

    return result;
  }

  private handleCompilationResult(result: CompilationResult | null, message?: ShaderSourceMessage): void {
    if (result?.superseded) {
      return;
    }

    let compileScope = message?.compileScope;
    const generation = message?.compileGeneration;
    if (generation) {
      if (generation.id < this.latestCompileGenerationId) {
        this.compilationGenerations.delete(generation.id);
        return;
      }
      const state = this.compilationGenerations.get(generation.id) ?? {
        rootCount: generation.rootCount,
        results: new Map<string, {
          compileScope?: CompileDiagnosticScope;
          index: number;
          result: CompilationResult | null;
        }>(),
      };
      state.rootCount = Math.max(state.rootCount, generation.rootCount);
      state.results.set(generation.rootPath, {
        compileScope,
        index: generation.rootIndex,
        result,
      });
      this.compilationGenerations.set(generation.id, state);
      if (state.results.size < state.rootCount) {
        return;
      }

      const completed = [...state.results.values()].sort((left, right) => left.index - right.index);
      this.compilationGenerations.delete(generation.id);
      const compiled = completed.filter((item): item is typeof item & { result: CompilationResult } => (
        item.result !== null
      ));
      if (compiled.length === 0) {
        return;
      }
      const ordered = compiled.map(({ result: rootResult }) => rootResult);
      result = {
        success: ordered.every((rootResult) => rootResult.success),
        errors: this.combineResultItems(ordered, "errors"),
        warnings: this.combineResultItems(ordered, "warnings"),
        diagnostics: this.combineDiagnostics(ordered),
      };
      compileScope = this.combineCompileScopes(
        compiled.map((compiledRoot) => compiledRoot.compileScope),
        generation.id,
      );
    }

    if (!result) {
      return;
    }
    this.compilationState?.setResult(result);
    this.reportCompilationResult(result, compileScope);
  }

  private isGenerationRootCompleted(message: ShaderSourceMessage): boolean {
    const generation = message.compileGeneration;
    return generation !== undefined
      && this.compilationGenerations.get(generation.id)?.results.has(generation.rootPath) === true;
  }

  private acceptCompileGeneration(message: ShaderSourceMessage): boolean {
    const generation = message.compileGeneration;
    if (!generation) {
      return true;
    }
    if (generation.id < this.latestCompileGenerationId) {
      return false;
    }
    if (generation.id === this.latestCompileGenerationId) {
      return true;
    }

    this.latestCompileGenerationId = generation.id;
    for (const id of this.compilationGenerations.keys()) {
      if (id < generation.id) {
        this.compilationGenerations.delete(id);
      }
    }
    this.pendingShaderEvents = this.pendingShaderEvents.filter((pending) => {
      const pendingGeneration = (pending.event.data as ShaderSourceMessage).compileGeneration;
      if (pendingGeneration && pendingGeneration.id < generation.id) {
        pending.resolve(undefined);
        return false;
      }
      return true;
    });
    return true;
  }

  private drainPendingShaderEvent(): void {
    if (this.shaderProcessor.isCurrentlyProcessing()) {
      return;
    }
    const pending = this.pendingShaderEvents.shift();
    if (!pending) {
      return;
    }
    void this.handleShaderMessage(pending.event)
      .then(pending.resolve)
      .finally(() => this.drainPendingShaderEvent());
  }

  private completeSkippedGeneration(message: ShaderSourceMessage): void {
    if (message.compileGeneration) {
      this.handleCompilationResult(null, message);
    }
  }

  private combineResultItems(
    results: readonly CompilationResult[],
    key: "errors" | "warnings",
  ): string[] | undefined {
    const items = results.flatMap((result) => result[key] ?? []);
    return items.length > 0 ? items : undefined;
  }

  private combineDiagnostics(results: readonly CompilationResult[]): CompilationResult["diagnostics"] {
    const seen = new Set<string>();
    const diagnostics = results
      .flatMap((result) => result.diagnostics ?? [])
      .filter((diagnostic) => {
        const key = JSON.stringify(diagnostic);
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
    return diagnostics.length > 0 ? diagnostics : undefined;
  }

  private combineCompileScopes(
    scopes: readonly (CompileDiagnosticScope | undefined)[],
    generationId: number,
  ): CompileDiagnosticScope | undefined {
    const present = scopes.filter((scope): scope is CompileDiagnosticScope => scope !== undefined);
    if (present.length === 0) {
      return undefined;
    }
    const ownerIds = new Set(present.map((scope) => scope.ownerId).filter(Boolean));
    return {
      rootUris: [...new Set(present.flatMap((scope) => scope.rootUris))].sort(),
      ...(ownerIds.size === 1 ? { ownerId: [...ownerIds][0] } : {}),
      generationId,
    };
  }

  private reportCompilationResult(result: CompilationResult, compileScope?: CompileDiagnosticScope): void {
    if (result.success) {
      if (result.warnings && result.warnings.length > 0) {
        for (const warning of result.warnings) {
          this.sendWarningMessage(warning);
        }
      }

      this.sendSuccessMessage(result.diagnostics, compileScope);
      return;
    }

    this.sendErrorMessage(result.errors || ["Unknown compilation error"], result.diagnostics, compileScope);
  }

  private syncStoredShaderContextForBufferUpdate(
    bufferName: string | null,
    code: string,
  ): void {
    if (!bufferName || !this.lastEvent) {
      return;
    }

    const lastMessage = this.lastEvent.data as ShaderSourceMessage;
    const nextMessage: ShaderSourceMessage = {
      ...lastMessage,
      buffers: {
        ...(lastMessage.buffers ?? {}),
        [bufferName]: code,
      },
    };

    this.lastEvent = {
      ...this.lastEvent,
      data: nextMessage,
    } as MessageEvent;

    this.shaderDebugManager.setShaderContext(
      nextMessage.config ?? null,
      nextMessage.path,
      nextMessage.buffers ?? {},
    );
  }

  private sendErrorMessage(
    errors: string[],
    diagnostics?: CompilationResult["diagnostics"],
    compileScope?: CompileDiagnosticScope,
  ): void {
    const errorMessage: ErrorMessage = {
      type: "error",
      payload: errors,
      ...(diagnostics && diagnostics.length > 0 ? { diagnostics } : {}),
      ...(compileScope ? { compileScope } : {}),
    };
    this.transport.postMessage(errorMessage);
  }

  private sendWarningMessage(warning: string): void {
    const warningMessage: WarningMessage = {
      type: "warning",
      payload: [warning],
    };
    this.transport.postMessage(warningMessage);
  }

  private sendSuccessMessage(
    diagnostics?: CompilationResult["diagnostics"],
    compileScope?: CompileDiagnosticScope,
  ): void {
    const logMessage: LogMessage = {
      type: "log",
      payload: ["Shader compiled and linked"],
      ...(diagnostics && diagnostics.length > 0 ? { diagnostics } : {}),
      ...(compileScope ? { compileScope } : {}),
    };
    this.transport.postMessage(logMessage);
  }

  private handleFatalError(err: unknown, event: MessageEvent): void {
    console.error("MessageHandler: Fatal error in handleShaderMessage:", err);
    console.error(
      "MessageHandler: Error stack:",
      err instanceof Error ? err.stack : "No stack",
    );
    console.error("MessageHandler: Event data:", event.data);

    // Try to send error message, but don't throw if this fails too
    try {
      const errorMessage: ErrorMessage = {
        type: "error",
        payload: [`Fatal shader processing error: ${err}`],
        ...((event.data as ShaderSourceMessage).compileScope
          ? { compileScope: (event.data as ShaderSourceMessage).compileScope }
          : {}),
      };
      this.transport.postMessage(errorMessage);
    } catch (transportErr) {
      console.error(
        "MessageHandler: Failed to send error message:",
        transportErr,
      );
    }
  }

  public async reset(onReset?: () => void | Promise<void>): Promise<void> {
    if (this.lastEvent && onReset) {
      // resetTime() flags the render pipeline to clear buffers on the next
      // atomic shader swap — no early cleanup() here to avoid a black flash
      // while the async recompile runs. Only called when a reset is actually
      // going to happen: calling it unconditionally would arm the WebGL
      // engine's video-resume hold even with no shader to replay, and
      // nothing would ever release it.
      this.renderEngine.resetTime();
      await onReset();
    } else {
      const errorMessage: ErrorMessage = {
        type: "error",
        payload: ["❌ No shader to reset"],
      };
      this.transport.postMessage(errorMessage);
    }
  }

  public handleCursorPositionMessage(message: CursorPositionMessage): void {
    if (getEditorOverlayVisible()) {
      return;
    }
    const { line, lineContent, filePath } = message.payload;

    if (!this.isCursorFileAccepted(filePath)) {
      return;
    }

    this.shaderDebugManager.updateDebugLine(line, lineContent, filePath);

    // If debug mode is active, recompile shader
    if (this.shaderDebugManager.getState().isActive && this.shaderProcessor.getImageShaderCode() && this.lastEvent) {
      void this.debugCompile();
    }
  }

  public handleOverlayCursor(line: number, lineContent: string, bufferName: string): void {
    let filePath: string;
    if (bufferName === 'Image') {
      const lastMessage = (this.lastEvent?.data as { path?: string } | undefined);
      filePath = lastMessage?.path ?? bufferName;
    } else {
      const config = this.renderEngine.getCurrentConfig();
      const passConfig = config?.passes[bufferName];
      const configPath =
        passConfig && typeof passConfig === 'object' && 'path' in passConfig
          ? (passConfig as { path?: string }).path
          : undefined;
      filePath = configPath ?? bufferName;
    }

    if (this.shaderLocker.isLocked()) {
      const lockedPath = this.shaderLocker.getLockedShaderPath();
      if (
        lockedPath
        && filePath !== lockedPath
        && !this.bufferPathResolver.bufferFileExistsInCurrentShader(filePath)
      ) {
        return;
      }
    }

    this.shaderDebugManager.updateDebugLine(line, lineContent, filePath);

    if (
      this.shaderDebugManager.getState().isActive
      && this.shaderProcessor.getImageShaderCode()
      && this.lastEvent
    ) {
      void this.debugCompile();
    }
  }

  public getLastEvent(): MessageEvent | null {
    return this.lastEvent;
  }

  public updateCurrentConfig(config: ShaderConfig): void {
    if (!this.lastEvent) {
      return;
    }

    const lastMessage = this.lastEvent.data as ShaderSourceMessage;
    const nextMessage: ShaderSourceMessage = {
      ...lastMessage,
      config,
    };

    this.lastEvent = {
      ...this.lastEvent,
      data: nextMessage,
    } as MessageEvent;

    this.shaderDebugManager.setShaderContext(
      config,
      nextMessage.path,
      nextMessage.buffers ?? {},
    );
  }

  public triggerDebugRecompile(): void {
    void this.debugCompile();
  }

  public recompileCurrentShader(): void {
    if (!this.lastEvent) {
      return;
    }
    void this.handleShaderMessage(this.lastEvent);
  }

  private async debugCompile(): Promise<CompilationResult | undefined> {
    if (!this.shaderProcessor.getImageShaderCode() || !this.lastEvent) {
      return undefined;
    }

    if (this.debugCompileInFlight) {
      this.debugCompilePending = true;
      return undefined;
    }

    this.debugCompileInFlight = true;
    try {
      const message = this.lastEvent.data as ShaderSourceMessage;
      const result = await this.shaderProcessor.debugCompile(message);
      this.handleCompilationResult(result);
      return result;
    } finally {
      this.debugCompileInFlight = false;
      if (this.debugCompilePending) {
        this.debugCompilePending = false;
        void this.debugCompile();
      }
    }
  }

  public refresh(path?: string): void {
    const refreshMessage: RefreshMessage = {
      type: "refresh",
      payload: {
        path: path,
      },
    };
    this.transport.postMessage(refreshMessage);
  }

  private isCursorFileAccepted(filePath: string, message?: ShaderSourceMessage): boolean {
    const lockedPath = this.shaderLocker.getLockedShaderPath();
    if (this.shaderLocker.isLocked()) {
      return !lockedPath
        || filePath === lockedPath
        || this.bufferPathResolver.bufferFileExistsInCurrentShader(filePath)
        || this.messageContainsBufferFile(message, filePath);
    }

    const currentMessage = message ?? (this.lastEvent?.data as ShaderSourceMessage | undefined);
    if (!currentMessage?.path) {
      return true;
    }

    return filePath === currentMessage.path
      || this.bufferPathResolver.bufferFileExistsInCurrentShader(filePath)
      || this.messageContainsBufferFile(currentMessage, filePath);
  }

  private messageContainsBufferFile(message: ShaderSourceMessage | undefined, filePath: string): boolean {
    const passes = message?.config?.passes ?? {};
    for (const [passName, passConfig] of Object.entries(passes)) {
      if (passName === "Image" || typeof passConfig !== "object" || !passConfig || !("path" in passConfig)) {
        continue;
      }

      const configPath = (passConfig as { path?: string }).path;
      if (!configPath) {
        continue;
      }

      const normalizedFilePath = filePath.replace(/\\/g, "/");
      const normalizedConfigPath = configPath.replace(/\\/g, "/");
      if (
        normalizedFilePath === normalizedConfigPath
        || normalizedFilePath.endsWith("/" + normalizedConfigPath.split("/").pop())
        || normalizedConfigPath.endsWith("/" + normalizedFilePath.split("/").pop())
      ) {
        return true;
      }
    }

    return false;
  }
}
