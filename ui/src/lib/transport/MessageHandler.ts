import type { RenderingEngine } from "../../../../rendering/src/types/RenderingEngine";
import type { ShaderLocker } from "../ShaderLocker";
import type { Transport } from "./MessageTransport";
import type {
  CursorPositionMessage,
  ErrorMessage,
  LogMessage,
  RefreshMessage,
  ShaderSourceMessage,
  WarningMessage
} from "@shader-studio/types";
import { BufferUpdater } from '../util/BufferUpdater';
import { BufferPathResolver } from '../util/BufferPathResolver';
import { ShaderDebugManager } from '../ShaderDebugManager';
import { ShaderProcessor, type CompilationResult } from '../ShaderProcessor';

export class MessageHandler {
  private renderEngine: RenderingEngine;
  private shaderLocker: ShaderLocker;
  private transport: Transport;
  private bufferUpdater: BufferUpdater;
  private bufferPathResolver: BufferPathResolver;
  private shaderProcessor: ShaderProcessor;
  private lastEvent: MessageEvent | null = null;
  private shaderDebugManager: ShaderDebugManager;
  private audioOptions: { muted?: boolean; volume?: number } | undefined;

  constructor(
    transport: Transport,
    renderEngine: RenderingEngine,
    shaderLocker: ShaderLocker,
    shaderDebugManager: ShaderDebugManager
  ) {
    this.transport = transport;
    this.renderEngine = renderEngine;
    this.shaderLocker = shaderLocker;
    this.bufferUpdater = new BufferUpdater(renderEngine, transport);
    this.bufferPathResolver = new BufferPathResolver(renderEngine);
    this.shaderDebugManager = shaderDebugManager;

    this.shaderProcessor = new ShaderProcessor(renderEngine, shaderDebugManager);
  }

  public getLastEvent(): MessageEvent | null {
    return this.lastEvent;
  }

  public setAudioOptions(options: { muted?: boolean; volume?: number }): void {
    this.audioOptions = options;
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

      // Update cursor position if provided
      if (cursorPosition) {
        const { line, lineContent, filePath } = cursorPosition;

        // If shader is locked, accept cursors from the locked file and its buffer files
        if (!this.shaderLocker.isLocked()
            || this.shaderLocker.getLockedShaderPath() === filePath
            || this.bufferPathResolver.bufferFileExistsInCurrentShader(filePath)) {
          this.shaderDebugManager.updateDebugLine(line, lineContent, filePath);
        }
      }

      if (this.shaderLocker.isLocked()) {
        const currentBufferName =
          path && this.bufferPathResolver.getBufferNameForFilePath(path);
        const lockedPath = this.shaderLocker.getLockedShaderPath();

        if (lockedPath === undefined || lockedPath !== path) {
          if (!this.hasBufferContent(buffers, code)) {
            // Skip processing entirely - shader is locked to a different path or path is undefined
            return undefined;
          }

          // Check if this is a common buffer file update
          if (currentBufferName === 'common') {
            this.syncStoredShaderContextForBufferUpdate(currentBufferName, code);
            // For common buffer files, we need special handling since they don't have mainImage
            return await this.handleCommonBufferUpdate(path, buffers, code);
          }

          if (!currentBufferName) {
            return undefined;
          }

          this.syncStoredShaderContextForBufferUpdate(currentBufferName, code);
          this.bufferUpdater.updateBuffer(path, buffers, code);
          // BufferUpdater returns void (fire-and-forget), so we're done here
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
    return type === "shaderSource" && !this.shaderProcessor.isCurrentlyProcessing();
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
  ): Promise<CompilationResult> {
    this.lastEvent = event;

    this.shaderDebugManager.setShaderContext(
      message.config ?? null,
      message.path,
      message.buffers ?? {},
    );

    // Delegate to shader processor
    const result = await this.shaderProcessor.processMainShaderCompilation(message, message.forceCleanup || false, this.audioOptions);
    this.handleCompilationResult(result);
    return result;
  }

  private handleCompilationResult(result: { success: boolean; errors?: string[]; warnings?: string[] }): void {
    if (result.success) {
      // Send warnings first if any
      if (result.warnings && result.warnings.length > 0) {
        for (const warning of result.warnings) {
          this.sendWarningMessage(warning);
        }
      }

      // Then send success
      this.sendSuccessMessages();
    } else {
      // Send all errors in a single message
      this.sendErrorMessage(result.errors || ["Unknown compilation error"]);
    }
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

  private sendSuccessMessages(): void {
    // Send success log message - this will clear previous errors
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
    this.cleanup();
    this.renderEngine.getTimeManager().cleanup();

    if (this.lastEvent && onReset) {
      await onReset();
    } else {
      const errorMessage: ErrorMessage = {
        type: "error",
        payload: ["❌ No shader to reset"],
      };
      this.transport.postMessage(errorMessage);
    }
  }

  private cleanup() {
    this.renderEngine.cleanup();
  }

  public handleCursorPositionMessage(message: CursorPositionMessage): void {
    const { line, lineContent, filePath } = message.payload;

    // If shader is locked, accept cursors from the locked file and its buffer files
    if (this.shaderLocker.isLocked()) {
      const lockedPath = this.shaderLocker.getLockedShaderPath();
      if (lockedPath && filePath !== lockedPath && !this.bufferPathResolver.bufferFileExistsInCurrentShader(filePath)) {
        return;
      }
    }

    this.shaderDebugManager.updateDebugLine(line, lineContent, filePath);

    // If debug mode is active, recompile shader
    if (this.shaderDebugManager.getState().isActive && this.shaderProcessor.getImageShaderCode() && this.lastEvent) {
      this.debugCompile();
    }
  }

  public triggerDebugRecompile(): void {
    this.debugCompile();
  }

  private async debugCompile(): Promise<CompilationResult | undefined> {
    if (!this.shaderProcessor.getImageShaderCode() || !this.lastEvent) {
      return undefined;
    }

    const message = this.lastEvent.data as ShaderSourceMessage;
    const result = await this.shaderProcessor.debugCompile(message);
    this.handleCompilationResult(result);
    return result;
  }

  public refresh(path?: string): void {
    console.log(
      "MessageHandler: Refresh requested",
      path ? `for shader: ${path}` : "(current)",
    );

    const refreshMessage: RefreshMessage = {
      type: "refresh",
      payload: {
        path: path,
      },
    };
    this.transport.postMessage(refreshMessage);
  }
}
