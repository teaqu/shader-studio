import type { RenderingEngine } from "../../../rendering/src/types/RenderingEngine";
import type { ShaderDebugManager } from "./ShaderDebugManager";
import type { ShaderSourceMessage } from "@shader-studio/types";

export interface CompilationResult {
  success: boolean;
  error?: string;
  warnings?: string[];
}

export class ShaderProcessor {
  private renderEngine: RenderingEngine;
  private shaderDebugManager: ShaderDebugManager;
  private originalShaderCode: string | null = null;
  private isProcessing = false;

  constructor(
    renderEngine: RenderingEngine,
    shaderDebugManager: ShaderDebugManager
  ) {
    this.renderEngine = renderEngine;
    this.shaderDebugManager = shaderDebugManager;
  }

  public isCurrentlyProcessing(): boolean {
    return this.isProcessing;
  }

  public getOriginalShaderCode(): string | null {
    return this.originalShaderCode;
  }

  public async processMainShaderCompilation(
    message: ShaderSourceMessage,
    forceCleanup: boolean = false
  ): Promise<CompilationResult> {
    const { code, config, path, buffers } = message;

    this.isProcessing = true;
    this.originalShaderCode = code;

    this.renderEngine.stopRenderLoop();

    if (forceCleanup) {
      this.renderEngine.cleanup();
    }

    try {
      const codeToCompile = this.getCodeToCompile(code);
      const result = await this.renderEngine.compileShaderPipeline(
        codeToCompile,
        config,
        path,
        buffers,
      );

      // Handle compilation failure
      if (!result?.success) {
        // If debug mode compilation failed, try original code
        if (codeToCompile !== code) {
          return await this.compileAndStartRenderLoop(code, config, path, buffers);
        }

        return {
          success: false,
          error: result?.error || "Unknown compilation error"
        };
      }

      // Success
      this.renderEngine.startRenderLoop();
      return {
        success: true,
        warnings: result.warnings
      };
    } catch (err) {
      console.error("ShaderProcessor: Error in processMainShaderCompilation:", err);
      return {
        success: false,
        error: `Shader compilation error: ${err}`
      };
    } finally {
      this.isProcessing = false;
    }
  }

  private getCodeToCompile(originalCode: string): string {
    const debugState = this.shaderDebugManager.getState();

    if (debugState.isActive && debugState.currentLine !== null) {
      const modifiedCode = this.shaderDebugManager.modifyShaderForDebugging(
        originalCode,
        debugState.currentLine,
      );

      if (modifiedCode) {
        return modifiedCode;
      }
    }

    return originalCode;
  }

  private async compileAndStartRenderLoop(
    code: string,
    config: any,
    path: string,
    buffers: Record<string, string>
  ): Promise<CompilationResult> {
    const result = await this.renderEngine.compileShaderPipeline(
      code,
      config,
      path,
      buffers
    );

    if (!result?.success) {
      return {
        success: false,
        error: result?.error || "Unknown compilation error"
      };
    }

    this.renderEngine.startRenderLoop();
    return {
      success: true,
      warnings: result.warnings
    };
  }

  public async processCommonBufferUpdate(code: string): Promise<CompilationResult> {
    try {
      this.renderEngine.stopRenderLoop();

      const result = await this.renderEngine.updateBufferAndRecompile('common', code);

      if (!result?.success) {
        return {
          success: false,
          error: result?.error || "Unknown compilation error"
        };
      }

      this.renderEngine.startRenderLoop();
      return { success: true };
    } catch (err) {
      console.error("ShaderProcessor: Error in processCommonBufferUpdate:", err);
      return {
        success: false,
        error: `Common buffer update error: ${err}`
      };
    }
  }

  public async recompileWithDebugMode(message: ShaderSourceMessage): Promise<CompilationResult> {
    if (!this.originalShaderCode) {
      return { success: true }; // Nothing to recompile
    }

    const debugState = this.shaderDebugManager.getState();

    if (!debugState.isActive) {
      // Debug mode disabled, use original code
      return await this.compileWithDebugFallback(this.originalShaderCode, message, false);
    }

    // Modify shader for debugging
    const modifiedCode = this.shaderDebugManager.modifyShaderForDebugging(
      this.originalShaderCode,
      debugState.currentLine!,
    );

    if (modifiedCode) {
      // Try to compile modified shader
      return await this.compileWithDebugFallback(modifiedCode, message, true);
    } else {
      // Modification failed, fall back to original
      return await this.compileWithDebugFallback(this.originalShaderCode, message, false);
    }
  }

  private async compileWithDebugFallback(
    code: string,
    message: ShaderSourceMessage,
    isDebugMode: boolean
  ): Promise<CompilationResult> {
    // Store original code
    if (!isDebugMode) {
      this.originalShaderCode = code;
    }

    const { config, path, buffers } = message;

    this.renderEngine.stopRenderLoop();

    try {
      const result = await this.compileAndStartRenderLoop(code, config, path, buffers);

      if (!result?.success && isDebugMode && this.originalShaderCode) {
        // Compilation failed in debug mode - fall back to original shader
        return await this.compileWithDebugFallback(this.originalShaderCode, message, false);
      }

      return result;
    } catch (err) {
      console.error("ShaderProcessor: Error in compileWithDebugFallback:", err);
      if (isDebugMode && this.originalShaderCode) {
        // Fall back to original shader
        return await this.compileWithDebugFallback(this.originalShaderCode, message, false);
      } else {
        return {
          success: false,
          error: `Shader compilation error: ${err}`
        };
      }
    }
  }
}
