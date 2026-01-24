import type { RenderingEngine } from "../../../../rendering/src/types/RenderingEngine";
import type { ShaderLocker } from "../ShaderLocker";
import type { Transport } from "./MessageTransport";
import type {
  ErrorMessage,
  LogMessage,
  RefreshMessage,
  ShaderSourceMessage,
} from "@shader-studio/types";

export class MessageHandler {
  private renderEngine: RenderingEngine;
  private shaderLocker: ShaderLocker;
  private transport: Transport;
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

      if (type !== "shaderSource" || this.isHandlingMessage) {
        return { running: false };
      }

      // If shader is locked, skip processing unless it's the locked shader
      // This prevents changing shaders while locked
      // But still allows reloading the locked shader
      if (this.shaderLocker.isLocked() && this.shaderLocker.getLockedShaderPath() !== path) {
        // Check if this is a buffer file update for the locked shader
        const lockedShaderPath = this.shaderLocker.getLockedShaderPath();
        if (lockedShaderPath && (Object.keys(buffers).length > 0 || code)) {
          // Extract buffer name from the filename (last part of path without extension)
          const bufferName = this.extractBufferNameFromPath(path);
          
          if (bufferName && this.bufferFileExistsInCurrentShader(path)) {
            const result = await this.handleBufferUpdate(path, bufferName, buffers, code);
            return result;
          }
        }
        return { running: true };
      }

      this.isHandlingMessage = true;
      try {
        this.renderEngine.stopRenderLoop();
        const result = await this.renderEngine.compileShaderPipeline(
          code,
          config,
          path,
          buffers,
        );
        this.lastEvent = event;

        if (!result || !result.success) {
          const errorMessage: ErrorMessage = {
            type: "error",
            payload: [result?.error || "Unknown compilation error"],
          };
          this.transport.postMessage(errorMessage);
          return { running: true };
        }

        this.renderEngine.startRenderLoop();

        // Clear any previous compilation errors
        const clearErrorMessage: ErrorMessage = {
          type: "error",
          payload: [],
        };
        this.transport.postMessage(clearErrorMessage);

        // Send log message in the format the WebSocket server expects
        const logMessage: LogMessage = {
          type: "log",
          payload: ["Shader compiled and linked"], // Array format expected by server
        };
        this.transport.postMessage(logMessage);
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

  private async handleBufferUpdate(
    path: string,
    bufferName: string,
    buffers: Record<string, string>,
    code: string
  ): Promise<{ running: boolean }> {
    // Find the actual buffer name that corresponds to this file path
    const actualBufferName = this.getBufferNameForFilePath(path);
    if (!actualBufferName) {
      return { running: true };
    }

    this.isHandlingMessage = true;
    try {
      this.renderEngine.stopRenderLoop();
      
      // Get the buffer content - either from buffers object or from code if it's a single buffer file
      const bufferContent = buffers[bufferName] || code || '';
      
      const result = await this.renderEngine.updateBufferAndRecompile(actualBufferName, bufferContent);
      
      if (!result || !result.success) {
        const errorMessage: ErrorMessage = {
          type: "error",
          payload: [result?.error || "Unknown compilation error"],
        };
        this.transport.postMessage(errorMessage);
        return { running: true };
      }
      
      this.renderEngine.startRenderLoop();
      
      // Clear any previous compilation errors
      const clearErrorMessage: ErrorMessage = {
        type: "error",
        payload: [],
      };
      this.transport.postMessage(clearErrorMessage);
      
      const logMessage: LogMessage = {
        type: "log",
        payload: [`Buffer '${bufferName}' updated and pipeline recompiled`],
      };
      this.transport.postMessage(logMessage);
      return { running: true };
    } finally {
      this.isHandlingMessage = false;
    }
  }

  private extractBufferNameFromPath(path: string): string | null {
    // Extract filename without extension from path
    const filename = path.split(/[\\/]/).pop(); // Get last part of path
    if (!filename) {
      return null;
    }
    
    // Remove extension
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");
    return nameWithoutExt || null; // Return null if empty string after removing extension
  }

  private bufferFileExistsInCurrentShader(filePath: string): boolean {
    // Get current passes from the rendering engine
    const passes = this.renderEngine.getPasses();
    
    // Check if any buffer pass has a matching file path
    return passes.some((pass: any) => {
      if (pass.name === "Image") {
        return false;
      }
      
      // Get the buffer file path from the shader config
      const bufferConfig = this.getBufferConfigForPass(pass.name);
      if (!bufferConfig || !bufferConfig.path) {
        return false;
      }
      
      // Normalize both paths for comparison (handle different path separators)
      const normalizedIncomingPath = filePath.replace(/\\/g, '/');
      const normalizedConfigPath = bufferConfig.path.replace(/\\/g, '/');
      
      // Check if the file paths match (either exact or just filename)
      return normalizedIncomingPath === normalizedConfigPath ||
             normalizedIncomingPath.endsWith('/' + normalizedConfigPath.split('/').pop()) ||
             normalizedConfigPath.endsWith('/' + normalizedIncomingPath.split('/').pop());
    });
  }

  private getBufferNameForFilePath(filePath: string): string | null {
    // Get current passes from the rendering engine
    const passes = this.renderEngine.getPasses();
    
    // Find the buffer pass that has a matching file path
    for (const pass of passes) {
      if (pass.name === "Image") {
        continue;
      }
      
      // Get the buffer file path from the shader config
      const bufferConfig = this.getBufferConfigForPass(pass.name);
      if (!bufferConfig || !bufferConfig.path) {
        continue;
      }
      
      // Normalize both paths for comparison
      const normalizedIncomingPath = filePath.replace(/\\/g, '/');
      const normalizedConfigPath = bufferConfig.path.replace(/\\/g, '/');
      
      // Check if the file paths match
      if (normalizedIncomingPath === normalizedConfigPath ||
          normalizedIncomingPath.endsWith('/' + normalizedConfigPath.split('/').pop()) ||
          normalizedConfigPath.endsWith('/' + normalizedIncomingPath.split('/').pop())) {
        return pass.name; // Return the actual buffer name (e.g., "BufferA")
      }
    }
    
    return null;
  }

  private getBufferConfigForPass(bufferName: string): { path?: string } | null {
    // Get the current shader config from the rendering engine
    const config = this.renderEngine.getCurrentConfig();
    if (!config || !config.passes) {
      return null;
    }
    
    // Get the buffer pass config for the specified buffer name
    const bufferPass = config.passes[bufferName as keyof typeof config.passes];
    if (!bufferPass || typeof bufferPass !== 'object' || !('path' in bufferPass)) {
      return null;
    }
    
    return bufferPass as { path?: string };
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
