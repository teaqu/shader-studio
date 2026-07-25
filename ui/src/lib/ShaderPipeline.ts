import type { RenderingEngine } from "../../../rendering/src/types/RenderingEngine";
import type { ShaderLocker } from "./ShaderLocker";
import type { Transport } from "./transport/MessageTransport";
import type {
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
import type { ShaderCompilationState } from './state/ShaderCompilationState.svelte';
import type { ShaderConfig } from "@shader-studio/types";
import { cloneSlangWorkspace } from './slangSourceIdentity';
import { getShaderRequestScope } from './state/ShaderCompilationState.svelte';

export type ShaderMessageTarget =
  | { kind: 'main' }
  | { kind: 'buffer'; passName: string };

type CompilationStateSink = Pick<ShaderCompilationState, 'setResult'>
  & Partial<Pick<ShaderCompilationState, 'acceptRequest' | 'isRequestCurrent'>>;

export class ShaderPipeline {
  private renderEngine: RenderingEngine;
  private shaderLocker: ShaderLocker;
  private transport: Transport;
  private bufferUpdater: BufferUpdater;
  private bufferPathResolver: BufferPathResolver;
  private shaderDebugManager: ShaderDebugManager;
  private shaderProcessor: ShaderProcessor;
  private lastEvent: MessageEvent | null = null;
  private pendingShaderEvent: {
    event: MessageEvent;
    resolve: (result: CompilationResult | undefined) => void;
  } | null = null;
  private compilationState: CompilationStateSink | null = null;
  private debugCompileInFlight = false;
  private debugCompilePending = false;
  private preacceptedEvents = new WeakSet<MessageEvent>();

  constructor(
    transport: Transport,
    renderEngine: RenderingEngine,
    shaderLocker: ShaderLocker,
    shaderDebugManager: ShaderDebugManager,
    compilationState?: CompilationStateSink,
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

  public setCompilationState(compilationState: CompilationStateSink | null): void {
    this.compilationState = compilationState;
  }

  public acceptShaderMessage(event: MessageEvent): boolean {
    const message = event.data as ShaderSourceMessage;
    const scope = getShaderRequestScope(message.path, this.shaderLocker.getLockedShaderPath());
    const accepted = !this.compilationState?.acceptRequest
      || this.compilationState.acceptRequest(message, scope);
    if (accepted) {
      this.preacceptedEvents.add(event);
    }
    return accepted;
  }

  public async handleShaderMessage(
    event: MessageEvent,
  ): Promise<CompilationResult | undefined> {
    try {
      const wasPreaccepted = this.preacceptedEvents.delete(event);
      const incomingMessage = event.data as ShaderSourceMessage;
      const message: ShaderSourceMessage = incomingMessage.workspace
        ? { ...incomingMessage, workspace: cloneSlangWorkspace(incomingMessage.workspace) }
        : incomingMessage;
      const { type, code, config, path, buffers = {}, cursorPosition } = message;

      if (!this.isValidShaderMessage(type)) {
        return undefined;
      }

      const messageTarget = this.getShaderMessageTarget(message);
      if (!messageTarget) {
        return undefined;
      }

      const scope = getShaderRequestScope(message.path, this.shaderLocker.getLockedShaderPath());
      if (!wasPreaccepted && this.compilationState?.acceptRequest && !this.compilationState.acceptRequest(message, scope)) {
        return { success: false, errors: ['Superseded by a newer compile'], superseded: true };
      }

      if (this.shaderProcessor.isCurrentlyProcessing()) {
        this.pendingShaderEvent?.resolve(undefined);
        return await new Promise<CompilationResult | undefined>((resolve) => {
          this.pendingShaderEvent = { event: { ...event, data: message } as MessageEvent, resolve };
        });
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

      if (messageTarget.kind === 'buffer') {
        if (!path || !this.hasBufferContent(buffers, code)) {
          return undefined;
        }

        const bufferName = messageTarget.passName;
        if (bufferName === 'common') {
          this.syncStoredShaderContextForBufferUpdate(bufferName, code);
          return await this.handleCommonBufferUpdate(path, buffers, code);
        }

        this.syncStoredShaderContextForBufferUpdate(bufferName, code);
        this.bufferUpdater.updateBuffer(
          path,
          buffers,
          code,
          bufferName,
          message.workspace,
          message.compileScope,
        );
        return undefined;
      }

      return await this.processMainShaderCompilation(message, { ...event, data: message } as MessageEvent, scope);

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

  public getShaderMessageTarget(
    message: Pick<ShaderSourceMessage, "path">,
  ): ShaderMessageTarget | null {
    if (!this.shaderLocker.isLocked()) {
      return { kind: 'main' };
    }

    const lockedPath = this.shaderLocker.getLockedShaderPath();
    const messagePath = message.path;
    if (!lockedPath || !messagePath) {
      return null;
    }

    if (this.pathsEqual(messagePath, lockedPath)) {
      return { kind: 'main' };
    }

    const currentMessage = this.lastEvent?.data as ShaderSourceMessage | undefined;
    const matchingBuffer = Object.entries(currentMessage?.bufferPathMap ?? {}).find(
      ([passName, passPath]) => passName !== 'Image'
        && this.pathsEqual(passPath, messagePath),
    );

    return matchingBuffer
      ? { kind: 'buffer', passName: matchingBuffer[0] }
      : null;
  }

  public canHandleShaderMessage(message: Pick<ShaderSourceMessage, "path">): boolean {
    return this.getShaderMessageTarget(message) !== null;
  }

  private pathsEqual(firstPath: string, secondPath: string): boolean {
    return this.normalizePath(firstPath) === this.normalizePath(secondPath);
  }

  private normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, "/");
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
    event: MessageEvent,
    scope: string,
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
    if (this.pendingShaderEvent) {
      const pending = this.pendingShaderEvent;
      this.pendingShaderEvent = null;
      void this.handleShaderMessage(pending.event).then(pending.resolve);
    }

    if (result.superseded || !this.isRequestCurrent(message, scope)) {
      return undefined;
    }

    this.handleCompilationResult(result, message.compileScope);

    return result;
  }

  private isRequestCurrent(message: ShaderSourceMessage, scope: string): boolean {
    return !this.compilationState?.isRequestCurrent
      || this.compilationState.isRequestCurrent(message, scope);
  }

  private handleCompilationResult(result: CompilationResult, compileScope?: ShaderSourceMessage['compileScope']): void {
    if (result.superseded) {
      return;
    }

    this.compilationState?.setResult(result);
    this.reportCompilationResult(result, compileScope);
  }

  private reportCompilationResult(result: { success: boolean; errors?: string[]; warnings?: string[]; diagnostics?: ErrorMessage['diagnostics'] }, compileScope?: ShaderSourceMessage['compileScope']): void {
    if (result.success) {
      if (result.warnings && result.warnings.length > 0) {
        for (const warning of result.warnings) {
          this.sendWarningMessage(warning);
        }
      }

      this.sendSuccessMessage(compileScope);
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

  private sendErrorMessage(errors: string[], diagnostics?: ErrorMessage['diagnostics'], compileScope?: ShaderSourceMessage['compileScope']): void {
    const errorMessage: ErrorMessage = {
      type: "error",
      payload: errors,
      ...(diagnostics ? { diagnostics } : {}),
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

  private sendSuccessMessage(compileScope?: ShaderSourceMessage['compileScope']): void {
    const logMessage: LogMessage = {
      type: "log",
      payload: ["Shader compiled and linked"],
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
        ...((event.data as ShaderSourceMessage | undefined)?.compileScope
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
      const scope = getShaderRequestScope(message.path, this.shaderLocker.getLockedShaderPath());
      const result = await this.shaderProcessor.debugCompile(message);
      if (!this.isRequestCurrent(message, scope)) {
        return undefined;
      }
      this.handleCompilationResult(result, message.compileScope);
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
