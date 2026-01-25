import type { RenderingEngine } from "../../../../rendering/src/types/RenderingEngine";
import type { Transport } from "../transport/MessageTransport";
import type {
  ErrorMessage,
  LogMessage,
} from "@shader-studio/types";

/**
 * Handles updating a buffer and recompiling the shader pipeline.
 */
export class BufferUpdater {
  private renderEngine: RenderingEngine;
  private transport: Transport;

  constructor(
    renderEngine: RenderingEngine,
    transport: Transport
  ) {
    this.renderEngine = renderEngine;
    this.transport = transport;
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
    if (!this.bufferFileExistsInCurrentShader(path)) {
      return;
    }

    // Find the actual buffer name that corresponds to this file path
    const actualBufferName = this.getBufferNameForFilePath(path);
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
              payload: [result?.error || "Unknown compilation error"],
            };
            this.transport.postMessage(errorMessage);
            return;
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
}
