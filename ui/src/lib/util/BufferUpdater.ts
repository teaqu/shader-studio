import type { RenderingEngine } from "../../../../rendering/src/types/RenderingEngine";
import type { Transport } from "../transport/MessageTransport";
import type {
  ErrorMessage,
  LogMessage,
} from "@shader-studio/types";
import { BufferPathResolver } from "./BufferPathResolver";

/**
 * Handles updating a buffer and recompiling the shader pipeline.
 */
export class BufferUpdater {
  private renderEngine: RenderingEngine;
  private transport: Transport;
  private resolver: BufferPathResolver;

  constructor(
    renderEngine: RenderingEngine,
    transport: Transport
  ) {
    this.renderEngine = renderEngine;
    this.transport = transport;
    this.resolver = new BufferPathResolver(renderEngine);
  }

  public updateBuffer(
    path: string, 
    buffers: Record<string, string>, 
    code: string
  ): void {
    // Extract buffer name from path
    const bufferName = this.extractBufferNameFromPath(path);
    if (!bufferName) {
      return;
    }

    // Check if this buffer exists in current shader
    if (!this.resolver.bufferFileExistsInCurrentShader(path)) {
      return;
    }

    // Find the actual buffer name that corresponds to this file path
    const actualBufferName = this.resolver.getBufferNameForFilePath(path);
    if (!actualBufferName) {
      return;
    }

    try {
      this.renderEngine.stopRenderLoop();
      
      // Get the buffer content - either from buffers object or from code if it's a single buffer file
      const bufferContent = buffers[bufferName] || code || '';
      
      this.renderEngine.updateBufferAndRecompile(actualBufferName, bufferContent)
        .then(result => {
          if (!result?.success) {
            const errorMessage: ErrorMessage = {
              type: "error",
              payload: result?.errors || ["Unknown compilation error"],
            };
            this.transport.postMessage(errorMessage);
            return;
          }
          
          this.renderEngine.startRenderLoop();
          
          // Send success message - this will clear previous errors
          const logMessage: LogMessage = {
            type: "log",
            payload: [`Buffer '${bufferName}' updated and pipeline recompiled`],
          };
          this.transport.postMessage(logMessage);
        })
        .catch(err => {
          console.error("BufferUpdater: Error in updateBuffer:", err);
          
          // Try to send error message, but don't throw if this fails too
          try {
            const errorMessage: ErrorMessage = {
              type: "error",
              payload: [`Buffer update error: ${err}`],
            };
            this.transport.postMessage(errorMessage);
          } catch (transportErr) {
            console.error(
              "BufferUpdater: Failed to send error message:",
              transportErr,
            );
          }
        });
    } catch (err) {
      console.error("BufferUpdater: Fatal error in updateBuffer:", err);
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
}
