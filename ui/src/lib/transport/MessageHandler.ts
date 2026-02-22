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
import { ShaderDebugManager } from '../ShaderDebugManager';
import { ShaderProcessor, type CompilationResult } from '../ShaderProcessor';

export class MessageHandler {
  private renderEngine: RenderingEngine;
  private shaderLocker: ShaderLocker;
  private transport: Transport;
  private bufferUpdater: BufferUpdater;
  private shaderProcessor: ShaderProcessor;
  private lastEvent: MessageEvent | null = null;
  private shaderDebugManager: ShaderDebugManager;

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
    this.shaderDebugManager = shaderDebugManager;

    this.shaderProcessor = new ShaderProcessor(renderEngine, shaderDebugManager);
  }

  public getLastEvent(): MessageEvent | null {
    return this.lastEvent;
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

        // If shader is locked, only debug lines from the locked shader
        if (!this.shaderLocker.isLocked() || this.shaderLocker.getLockedShaderPath() === filePath) {
          this.shaderDebugManager.updateDebugLine(line, lineContent, filePath);
        }
      }

      if (this.shaderLocker.isLocked()) {
        const lockedPath = this.shaderLocker.getLockedShaderPath();

        if (lockedPath === undefined || lockedPath !== path) {
          if (!this.hasBufferContent(buffers, code)) {
            // Skip processing entirely - shader is locked to a different path or path is undefined
            return undefined;
          }

          // Check if this is a common buffer file update
          if (this.isCommonBufferFile(path)) {
            // For common buffer files, we need special handling since they don't have mainImage
            return await this.handleCommonBufferUpdate(path, buffers, code);
          }

          const bufferUpdateResult = this.bufferUpdater.updateBuffer(path, buffers, code);
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

  private isCommonBufferFile(filePath: string): boolean {
    // Check if the file path indicates this is a common buffer file
    const filename = filePath.split(/[\\/]/).pop();

    if (!filename) {
      return false;
    }

    const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");
    const isCommon = nameWithoutExt.toLowerCase() === 'common';

    // Also check if the path contains 'common' as a fallback
    const pathContainsCommon = filePath.toLowerCase().includes('common');

    return isCommon || pathContainsCommon;
  }

  private async handleCommonBufferUpdate(_path: string, _buffers: Record<string, string>, code: string): Promise<CompilationResult> {
    // For common buffer updates when shader is locked, we need to refresh the locked shader
    // to pick up the new common buffer content, not update the common buffer directly
    const lockedPath = this.shaderLocker.getLockedShaderPath();
    if (lockedPath) {
      // Request a refresh of the locked shader to pick up the new common buffer content
      this.refresh(lockedPath);
      return { success: true };
    }

    // If no locked shader, delegate to shader processor
    const result = await this.shaderProcessor.processCommonBufferUpdate(code);
    this.handleCompilationResult(result);
    return result;
  }

  private async processMainShaderCompilation(
    message: ShaderSourceMessage,
    event: MessageEvent
  ): Promise<CompilationResult> {
    this.lastEvent = event;

    // Delegate to shader processor
    const result = await this.shaderProcessor.processMainShaderCompilation(message, message.forceCleanup || false);
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

  public clearErrors(): void {
    // Send a success message to clear any previous errors
    const logMessage: LogMessage = {
      type: "log",
      payload: ["Shader compiled and linked"],
    };
    this.transport.postMessage(logMessage);
  }

  public sendSuccessMessage(): void {
    this.sendSuccessMessages();
  }

  public reset(onReset?: () => void): void {
    this.cleanup();

    if (this.lastEvent && onReset) {
      onReset();
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

    // If shader is locked, only debug lines from the locked shader
    if (this.shaderLocker.isLocked()) {
      const lockedPath = this.shaderLocker.getLockedShaderPath();
      if (lockedPath && filePath !== lockedPath) {
        // Cursor is in a different file than the locked shader - ignore
        return;
      }
    }

    this.shaderDebugManager.updateDebugLine(line, lineContent, filePath);

    // If debug mode is active, recompile shader
    if (this.shaderDebugManager.getState().isActive && this.shaderProcessor.getOriginalShaderCode() && this.lastEvent) {
      this.debugCompile();
    }
  }

  public triggerDebugRecompile(): void {
    this.debugCompile();
  }

  private async debugCompile(): Promise<CompilationResult | undefined> {
    if (!this.shaderProcessor.getOriginalShaderCode() || !this.lastEvent) {
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
