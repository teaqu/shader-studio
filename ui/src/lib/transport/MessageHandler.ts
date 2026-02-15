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

export class MessageHandler {
  private renderEngine: RenderingEngine;
  private shaderLocker: ShaderLocker;
  private transport: Transport;
  private bufferUpdater: BufferUpdater;
  private isHandlingMessage = false;
  private lastEvent: MessageEvent | null = null;
  private shaderDebugManager: ShaderDebugManager;
  private originalShaderCode: string | null = null;

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
  }

  public getLastEvent(): MessageEvent | null {
    return this.lastEvent;
  }

  public handleShaderMessage(
    event: MessageEvent,
  ): void {
    try {
      const message = event.data as ShaderSourceMessage;
      const { type, code, config, path, buffers = {}, cursorPosition } = message;

      if (!this.isValidShaderMessage(type)) {
        return;
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
            return;
          }

          // Check if this is a common buffer file update
          if (this.isCommonBufferFile(path)) {
            // For common buffer files, we need special handling since they don't have mainImage
            this.handleCommonBufferUpdate(path, buffers, code);
            return;
          }

          const bufferUpdateResult = this.bufferUpdater.updateBuffer(path, buffers, code);
          // BufferUpdater returns void (fire-and-forget), so we're done here
          return;
        }
      }

      this.processMainShaderCompilation(message, event);

    } catch (err) {
    this.handleFatalError(err, event);
    }
  }

  private isValidShaderMessage(type: string): boolean {
    return type === "shaderSource" && !this.isHandlingMessage;
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

  private handleCommonBufferUpdate(path: string, buffers: Record<string, string>, code: string): void {
    // For common buffer updates when shader is locked, we need to refresh the locked shader
    // to pick up the new common buffer content, not update the common buffer directly
    try {
      const lockedPath = this.shaderLocker.getLockedShaderPath();
      if (lockedPath) {
        // Request a refresh of the locked shader to pick up the new common buffer content
        this.refresh(lockedPath);
        return;
      }
      
      // If no locked shader, fall back to direct common buffer update
      this.renderEngine.stopRenderLoop();
      
      this.renderEngine.updateBufferAndRecompile('common', code)
        .then(result => {
          if (!result?.success) {
            const errorMessage: ErrorMessage = {
              type: "error",
              payload: [result?.error || "Unknown compilation error"],
            };
            this.transport.postMessage(errorMessage);
            return;
          }
          
          this.renderEngine.startRenderLoop();
          
          // Send success message to clear previous errors
          const logMessage: LogMessage = {
            type: "log",
            payload: [`Common buffer updated and pipeline recompiled`],
          };
          this.transport.postMessage(logMessage);
        })
        .catch(err => {
          console.error("MessageHandler: Error in handleCommonBufferUpdate:", err);
          
          // Try to send error message, but don't throw if this fails too
          try {
            const errorMessage: ErrorMessage = {
              type: "error",
              payload: [`Common buffer update error: ${err}`],
            };
            this.transport.postMessage(errorMessage);
          } catch (transportErr) {
            console.error(
              "MessageHandler: Failed to send error message:",
              transportErr,
            );
          }
        });
    } catch (err) {
      console.error("MessageHandler: Fatal error in handleCommonBufferUpdate:", err);
    }
  }

  private processMainShaderCompilation(
    message: ShaderSourceMessage,
    event: MessageEvent
  ): void {
    const { code, config, path, buffers, forceCleanup } = message;

    this.isHandlingMessage = true;
    this.lastEvent = event;

    // Store original shader code
    this.originalShaderCode = code;

    this.renderEngine.stopRenderLoop();

    // If forceCleanup is requested (e.g., from refresh/config change), cleanup first
    if (forceCleanup) {
      this.cleanup();
    }

    // Determine which code to compile (original or debug-modified)
    let codeToCompile = code;
    const debugState = this.shaderDebugManager.getState();

    if (debugState.isActive && debugState.currentLine !== null) {
      const modifiedCode = this.shaderDebugManager.modifyShaderForDebugging(
        code,
        debugState.currentLine,
      );

      if (modifiedCode) {
        codeToCompile = modifiedCode;
      }
    }

    this.renderEngine.compileShaderPipeline(
      codeToCompile,
      config,
      path,
      buffers,
    ).then(result => {
      if (!result?.success) {
        // If debug mode compilation failed, fall back to original
        if (codeToCompile !== code) {
          return this.renderEngine.compileShaderPipeline(code, config, path, buffers)
            .then(fallbackResult => {
              if (!fallbackResult?.success) {
                this.sendErrorMessage(fallbackResult?.error || "Unknown compilation error");
                return;
              }

              if (fallbackResult.warnings && fallbackResult.warnings.length > 0) {
                for (const warning of fallbackResult.warnings) {
                  this.sendWarningMessage(warning);
                }
              }

              this.renderEngine.startRenderLoop();
              this.sendSuccessMessages();
            });
        }

        this.sendErrorMessage(result?.error || "Unknown compilation error");
        return;
      }

      // Send any warnings (e.g., video loading failures)
      if (result.warnings && result.warnings.length > 0) {
        for (const warning of result.warnings) {
          this.sendWarningMessage(warning);
        }
      }

      this.renderEngine.startRenderLoop();
      this.sendSuccessMessages();
    }).catch(err => {
      console.error("MessageHandler: Error in processMainShaderCompilation:", err);
      this.sendErrorMessage(`Shader compilation error: ${err}`);
    }).finally(() => {
      this.isHandlingMessage = false;
    });
  }

  private sendErrorMessage(error: string): void {
    const errorMessage: ErrorMessage = {
      type: "error",
      payload: [error],
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

    this.isHandlingMessage = false;

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
    if (this.shaderDebugManager.getState().isActive && this.originalShaderCode && this.lastEvent) {
      this.recompileWithDebugMode();
    }
  }

  public triggerDebugRecompile(): void {
    this.recompileWithDebugMode();
  }

  private recompileWithDebugMode(): void {
    if (!this.originalShaderCode || !this.lastEvent) {
      return;
    }

    const message = this.lastEvent.data as ShaderSourceMessage;
    const debugState = this.shaderDebugManager.getState();

    if (!debugState.isActive) {
      // Debug mode disabled, use original code
      this.compileShaderCode(this.originalShaderCode, message, false);
      return;
    }

    // Modify shader for debugging
    const modifiedCode = this.shaderDebugManager.modifyShaderForDebugging(
      this.originalShaderCode,
      debugState.currentLine!,
    );

    if (modifiedCode) {
      // Try to compile modified shader
      this.compileShaderCode(modifiedCode, message, true);
    } else {
      // Modification failed, fall back to original
      this.compileShaderCode(this.originalShaderCode, message, false);
    }
  }

  private compileShaderCode(code: string, message: ShaderSourceMessage, isDebugMode: boolean): void {
    // Store original code
    if (!isDebugMode) {
      this.originalShaderCode = code;
    }

    const { config, path, buffers } = message;

    this.renderEngine.stopRenderLoop();

    this.renderEngine.compileShaderPipeline(
      code,
      config,
      path,
      buffers,
    ).then(result => {
      if (!result?.success) {
        // Compilation failed
        if (isDebugMode && this.originalShaderCode) {
          // Fall back to original shader
          this.compileShaderCode(this.originalShaderCode, message, false);
        } else {
          this.sendErrorMessage(result?.error || "Unknown compilation error");
        }
        return;
      }

      // Send any warnings (e.g., video loading failures)
      if (result.warnings && result.warnings.length > 0) {
        for (const warning of result.warnings) {
          this.sendWarningMessage(warning);
        }
      }

      this.renderEngine.startRenderLoop();
      this.sendSuccessMessages();
    }).catch(err => {
      console.error("MessageHandler: Error in compileShaderCode:", err);
      if (isDebugMode && this.originalShaderCode) {
        // Fall back to original shader
        this.compileShaderCode(this.originalShaderCode, message, false);
      } else {
        this.sendErrorMessage(`Shader compilation error: ${err}`);
      }
    });
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
