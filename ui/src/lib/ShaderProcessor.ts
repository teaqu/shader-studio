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
      const codeToCompile = this.getDebugCodeToCompile(code);
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
          const fallbackResult = await this.compile(code, config, path, buffers);
          if (fallbackResult.success) {
            this.renderEngine.startRenderLoop();
          }
          return fallbackResult;
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

  private getDebugCodeToCompile(originalCode: string): string {
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

  private async compile(
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

  public async debugCompile(message: ShaderSourceMessage): Promise<CompilationResult> {
    if (!this.originalShaderCode) {
      return { success: true };
    }

    const { config, path, buffers } = message;
    const debugState = this.shaderDebugManager.getState();

    this.renderEngine.stopRenderLoop();

    // Get debug-modified code (debug mode is guaranteed to be active)
    const modifiedCode = this.shaderDebugManager.modifyShaderForDebugging(
      this.originalShaderCode,
      debugState.currentLine!,
    );

    // Try compilation with debug-modified code, or original if modification failed
    let result = await this.compile(modifiedCode || this.originalShaderCode, config, path, buffers);

    // If failed and modified code was used, try original
    if (!result.success && modifiedCode) {
      result = await this.compile(this.originalShaderCode, config, path, buffers);
    }

    // Start render loop if compilation succeeded
    if (result.success) {
      this.renderEngine.startRenderLoop();
    }

    return result;
  }
}
