import type { RenderingEngine } from "../../../rendering/src/types/RenderingEngine";
import type { ShaderDebugManager } from "./ShaderDebugManager";
import type { ShaderSourceMessage } from "@shader-studio/types";

export interface CompilationResult {
  success: boolean;
  errors?: string[];
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
    forceCleanup: boolean = false,
    audioOptions?: { muted?: boolean; volume?: number },
  ): Promise<CompilationResult> {
    const { code, config, path, buffers } = message;
    const scriptBundleError = message.scriptBundleError;

    this.isProcessing = true;
    this.originalShaderCode = code;
    this.shaderDebugManager.setOriginalCode(code);

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
        audioOptions,
        message.customUniformDeclarations,
        message.customUniformInfo,
      );

      // Handle compilation failure
      if (!result?.success) {
        // If debug mode compilation failed, try original code
        if (codeToCompile !== code) {
          this.shaderDebugManager.setDebugError(
            `Debug shader compilation failed: ${result?.errors?.[0] || 'unknown error'}`
          );
          const fallbackResult = await this.compile(code, config, path, buffers, message.customUniformDeclarations, message.customUniformInfo);
          if (fallbackResult.success) {
            this.renderEngine.startRenderLoop();
          }
          return fallbackResult;
        }

        return {
          success: false,
          errors: result?.errors || ["Unknown compilation error"]
        };
      }

      // Success
      this.renderEngine.startRenderLoop();
      const warnings = [...(result.warnings || [])];
      if (scriptBundleError) {
        warnings.push(`Script: ${scriptBundleError}`);
      }
      return {
        success: true,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (err) {
      console.error("ShaderProcessor: Error in processMainShaderCompilation:", err);
      return {
        success: false,
        errors: [`Shader compilation error: ${err}`]
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

    // Fallback: apply full-shader post-processing (normalize/step without a specific line)
    if (debugState.isEnabled) {
      const postProcessed = this.shaderDebugManager.applyFullShaderPostProcessing(originalCode);
      if (postProcessed) {
        return postProcessed;
      }
    }

    return originalCode;
  }

  private async compile(
    code: string,
    config: any,
    path: string,
    buffers: Record<string, string>,
    customUniformDeclarations?: string,
    customUniformInfo?: { name: string; type: string }[],
  ): Promise<CompilationResult> {
    const result = await this.renderEngine.compileShaderPipeline(
      code,
      config,
      path,
      buffers,
      undefined,
      customUniformDeclarations,
      customUniformInfo,
    );

    if (!result?.success) {
      return {
        success: false,
        errors: result?.errors || ["Unknown compilation error"]
      };
    }

    return {
      success: true,
      warnings: result.warnings
    };
  }

  public async processCommonBufferUpdate(code: string): Promise<CompilationResult> {
    try {
      const result = await this.renderEngine.updateBufferAndRecompile('common', code);

      if (!result?.success) {
        return {
          success: false,
          errors: result?.errors || ["Unknown compilation error"]
        };
      }

      this.renderEngine.startRenderLoop();
      return { success: true };
    } catch (err) {
      console.error("ShaderProcessor: Error in processCommonBufferUpdate:", err);
      return {
        success: false,
        errors: [`Common buffer update error: ${err}`]
      };
    }
  }

  public async debugCompile(message: ShaderSourceMessage): Promise<CompilationResult> {
    if (!this.originalShaderCode) {
      return { success: true };
    }

    const { config, path, buffers } = message;
    const debugState = this.shaderDebugManager.getState();

    // Get debug-modified code (debug mode is guaranteed to be active)
    const modifiedCode = this.shaderDebugManager.modifyShaderForDebugging(
      this.originalShaderCode,
      debugState.currentLine!,
    );

    // Pass custom uniform declarations through debug recompilations
    const cuDecl = message.customUniformDeclarations;
    const cuInfo = message.customUniformInfo;

    // Try compilation with debug-modified code, or original if modification failed
    let result = await this.compile(modifiedCode || this.originalShaderCode, config, path, buffers, cuDecl, cuInfo);

    // If failed and modified code was used, try original
    if (!result.success && modifiedCode) {
      this.shaderDebugManager.setDebugError(
        `Debug shader compilation failed: ${result.errors?.[0] || 'unknown error'}`
      );
      result = await this.compile(this.originalShaderCode, config, path, buffers, cuDecl, cuInfo);
    }

    // Start render loop if compilation succeeded
    if (result.success) {
      this.renderEngine.startRenderLoop();
    }

    return result;
  }
}
