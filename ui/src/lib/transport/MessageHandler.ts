import type { RenderingEngine } from "../../../../rendering/src/types/RenderingEngine";
import type { ShaderLocker } from "../ShaderLocker";
import type { Transport } from "./MessageTransport";
import type {
  ErrorMessage,
  LogMessage,
  RefreshMessage,
  ShaderSourceMessage,
} from "@shader-studio/types";
import { BufferUpdater } from '../util/BufferUpdater';

export class MessageHandler {
  private renderEngine: RenderingEngine;
  private shaderLocker: ShaderLocker;
  private transport: Transport;
  private bufferUpdater: BufferUpdater;
  private isHandlingMessage = false;
  private lastEvent: MessageEvent | null = null;

  constructor(
    transport: Transport,
    renderEngine: RenderingEngine,
    shaderLocker: ShaderLocker
  ) {
    this.transport = transport;
    this.renderEngine = renderEngine;
    this.shaderLocker = shaderLocker;
    this.bufferUpdater = new BufferUpdater(renderEngine, transport);
  }

  public getLastEvent(): MessageEvent | null {
    return this.lastEvent;
  }

  public handleShaderMessage(
    event: MessageEvent,
  ): void {
    try {
      const message = event.data as ShaderSourceMessage;
      const { type, code, config, path, buffers = {} } = message;

      if (!this.isValidShaderMessage(type)) {
        return;
      }

      if (this.shaderLocker.isLocked()) {
        const lockedPath = this.shaderLocker.getLockedShaderPath();
        if (lockedPath === undefined || lockedPath !== path) {
          if (!this.hasBufferContent(buffers, code)) {
            // Skip processing entirely - shader is locked to a different path or path is undefined
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

  private processMainShaderCompilation(
    message: ShaderSourceMessage, 
    event: MessageEvent
  ): void {
    const { code, config, path, buffers } = message;

    this.isHandlingMessage = true;
    this.renderEngine.stopRenderLoop();
    
    this.renderEngine.compileShaderPipeline(
      code,
      config,
      path,
      buffers,
    ).then(result => {
      this.lastEvent = event;

      if (!result?.success) {
        this.sendErrorMessage(result?.error || "Unknown compilation error");
        return;
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

  private sendSuccessMessages(): void {
    // Clear any previous compilation errors
    const clearErrorMessage: ErrorMessage = {
      type: "error",
      payload: [],
    };
    this.transport.postMessage(clearErrorMessage);

    // Send success log message
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
