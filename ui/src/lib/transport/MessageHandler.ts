import type { RenderingEngine } from "../../../../rendering/src/types/RenderingEngine";
import type { Transport } from "./MessageTransport";
import type {
  ErrorMessage,
  LogMessage,
  RefreshMessage,
  ShaderSourceMessage,
} from "@shader-studio/types";

export class MessageHandler {
  private renderEngine: RenderingEngine;
  private transport: Transport;
  private isHandlingMessage = false;
  private lastEvent: MessageEvent | null = null;

  constructor(
    renderEngine: RenderingEngine,
    transport: Transport,
  ) {
    this.renderEngine = renderEngine;
    this.transport = transport;
  }

  public getLastEvent(): MessageEvent | null {
    return this.lastEvent;
  }

  public async handleShaderMessage(
    event: MessageEvent,
  ): Promise<{ running: boolean }> {
    try {
      let { type, code, config, path, buffers = {} } = event
        .data as ShaderSourceMessage;

      console.log("MessageHandler: Processing shader message:", {
        type,
        path,
        codeLength: code?.length,
      });

      if (type !== "shaderSource" || this.isHandlingMessage) {
        console.log(
          "MessageHandler: Ignoring message - wrong type or already handling",
        );
        return { running: false };
      }

      this.isHandlingMessage = true;
      try {
        console.log("MessageHandler: Compiling shader pipeline...");
        const result = await this.renderEngine.compileShaderPipeline(
          code,
          config,
          path,
          buffers,
        );

        if (!result || !result.success) {
          console.log("MessageHandler: Compilation failed:", result?.error);
          const errorMessage: ErrorMessage = {
            type: "error",
            payload: [result?.error || "Unknown compilation error"],
          };
          this.transport.postMessage(errorMessage);
          return { running: true };
        }

        console.log("MessageHandler: Compilation successful");

        // Send log message in the format the WebSocket server expects
        const logMessage: LogMessage = {
          type: "log",
          payload: ["Shader compiled and linked"], // Array format expected by server
        };
        this.transport.postMessage(logMessage);

        this.lastEvent = event;

        return { running: true };
      } finally {
        this.isHandlingMessage = false;
      }
    } catch (err) {
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

      return { running: false };
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
