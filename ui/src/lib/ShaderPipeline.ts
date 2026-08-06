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

export type ShaderMessageTarget =
  | { kind: 'main' }
  | { kind: 'buffer'; passName: string }
  | { kind: 'vertex'; passName: string };

const VERTEX_SOURCE_PREFIX = '__shader_studio_vertex__:';

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
  private compilationState: Pick<ShaderCompilationState, 'setResult'> | null = null;
  private debugCompileInFlight = false;
  private debugCompilePending = false;

  constructor(
    transport: Transport,
    renderEngine: RenderingEngine,
    shaderLocker: ShaderLocker,
    shaderDebugManager: ShaderDebugManager,
    compilationState?: Pick<ShaderCompilationState, 'setResult'>,
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

  public setCompilationState(compilationState: Pick<ShaderCompilationState, 'setResult'> | null): void {
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

      const messageTarget = this.getShaderMessageTarget(message);
      if (!messageTarget) {
        return undefined;
      }

      if (this.shaderProcessor.isCurrentlyProcessing()) {
        this.pendingShaderEvent?.resolve(undefined);
        return await new Promise<CompilationResult | undefined>((resolve) => {
          this.pendingShaderEvent = { event, resolve };
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
        this.bufferUpdater.updateBuffer(path, buffers, code, bufferName);
        return undefined;
      }

      if (messageTarget.kind === 'vertex') {
        // Vertex sources are not fragment buffers. Ask the extension to resend
        // the owning shader so its current vertex source is compiled together
        // with the pass, rather than attempting a buffer-only recompile.
        this.refresh(this.shaderLocker.getLockedShaderPath());
        return undefined;
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
      ? matchingBuffer[0].startsWith(VERTEX_SOURCE_PREFIX)
        ? { kind: 'vertex', passName: matchingBuffer[0].slice(VERTEX_SOURCE_PREFIX.length) }
        : { kind: 'buffer', passName: matchingBuffer[0] }
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
    event: MessageEvent
  ): Promise<CompilationResult | undefined> {
    this.lastEvent = event;

    this.setDebugShaderContext(message);

    const result = await this.shaderProcessor.processMainShaderCompilation(
      message,
      message.reload || false,
    );
    this.handleCompilationResult(result);

    if (this.pendingShaderEvent) {
      const pending = this.pendingShaderEvent;
      this.pendingShaderEvent = null;
      void this.handleShaderMessage(pending.event).then(pending.resolve);
    }

    if (result.superseded) {
      return undefined;
    }

    return result;
  }

  private handleCompilationResult(result: CompilationResult): void {
    if (result.superseded) {
      return;
    }

    this.compilationState?.setResult(result);
    this.reportCompilationResult(result);
  }

  private reportCompilationResult(result: { success: boolean; errors?: string[]; warnings?: string[] }): void {
    if (result.success) {
      if (result.warnings && result.warnings.length > 0) {
        for (const warning of result.warnings) {
          this.sendWarningMessage(warning);
        }
      }

      this.sendSuccessMessage();
      return;
    }

    this.sendErrorMessage(result.errors || ["Unknown compilation error"]);
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

    this.setDebugShaderContext(nextMessage);
  }

  private sendErrorMessage(errors: string[]): void {
    const errorMessage: ErrorMessage = {
      type: "error",
      payload: errors,
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

  private sendSuccessMessage(): void {
    const logMessage: LogMessage = {
      type: "log",
      payload: ["Shader compiled and linked"],
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

    this.setDebugShaderContext(nextMessage);
  }

  private setDebugShaderContext(message: ShaderSourceMessage): void {
    const args: Parameters<ShaderDebugManager['setShaderContext']> = [
      message.config ?? null,
      message.path,
      message.buffers ?? {},
    ];
    if (message.slangModules) {
      args.push(message.slangModules);
    }
    if (message.bufferPathMap) {
      if (!message.slangModules) {
        args.push([]);
      }
      args.push(message.bufferPathMap);
    }
    this.shaderDebugManager.setShaderContext(...args);
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
        || this.messageContainsSlangModule(message ?? (this.lastEvent?.data as ShaderSourceMessage | undefined), filePath)
        || this.messageContainsBufferFile(message, filePath);
    }

    const currentMessage = message ?? (this.lastEvent?.data as ShaderSourceMessage | undefined);
    if (!currentMessage?.path) {
      return true;
    }

    return filePath === currentMessage.path
      || this.bufferPathResolver.bufferFileExistsInCurrentShader(filePath)
      || this.messageContainsSlangModule(currentMessage, filePath)
      || this.messageContainsBufferFile(currentMessage, filePath);
  }

  private messageContainsSlangModule(message: ShaderSourceMessage | undefined, filePath: string): boolean {
    const normalizedFilePath = this.normalizePath(filePath);
    return message?.slangModules?.some((module) =>
      this.normalizePath(module.path) === normalizedFilePath) ?? false;
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
