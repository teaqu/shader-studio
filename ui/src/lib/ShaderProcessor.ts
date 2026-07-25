import type { RenderingEngine } from "../../../rendering/src/types/RenderingEngine";
import { isUnsupportedDebugTarget, type ShaderDebugManager } from "./ShaderDebugManager";
import type { ShaderSourceMessage, ShaderConfig } from "@shader-studio/types";
import type { SlangDiagnostic, SlangWorkspaceSnapshot } from '@shader-studio/types';
import { cloneSlangWorkspace } from './slangSourceIdentity';

export interface CompilationResult {
  success: boolean;
  errors?: string[];
  warnings?: string[];
  diagnostics?: SlangDiagnostic[];
  superseded?: true;
}

export class ShaderProcessor {
  private renderEngine: RenderingEngine;
  private shaderDebugManager: ShaderDebugManager;
  private imageShaderCode: string | null = null;
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

  public getImageShaderCode(): string | null {
    return this.imageShaderCode;
  }

  public async processMainShaderCompilation(
    message: ShaderSourceMessage,
    reload: boolean = false,
  ): Promise<CompilationResult> {
    const { code, config, path, buffers } = message;
    const workspace = message.workspace ? cloneSlangWorkspace(message.workspace) : undefined;
    const scriptBundleError = message.scriptBundleError;

    this.isProcessing = true;
    this.imageShaderCode = code;
    this.shaderDebugManager.setImageShaderCode(code);

    if (reload) {
      this.renderEngine.flagReloadOnNextApply();
    }

    try {
      const debugState = this.shaderDebugManager.getState();
      const { code: codeToCompile, config: configToCompile } = this.getDebugCompileArgs(code, config ?? null);
      const buffersToCompile = this.getCompileBuffers(buffers, debugState.activeBufferName, codeToCompile, code);
      const result = await this.compilePipeline(
        codeToCompile,
        configToCompile,
        path,
        buffersToCompile,
        message.customUniformDeclarations,
        message.customUniformInfo,
        workspace,
      );

      // Handle compilation failure
      if (result?.superseded) {
        return this.supersededResult(result.errors);
      }

      if (!result?.success) {
        // If debug mode compilation failed, try original code
        if (codeToCompile !== code) {
          this.shaderDebugManager.setDebugError(
            `Debug shader compilation failed: ${result?.errors?.[0] || 'unknown error'}`
          );
          const fallbackResult = await this.compile(code, config, path, buffers, message.customUniformDeclarations, message.customUniformInfo, workspace);
          if (fallbackResult.success) {
            this.renderEngine.startRenderLoop();
          }
          return fallbackResult;
        }

        return {
          success: false,
          errors: result?.errors || ["Unknown compilation error"],
          diagnostics: result?.diagnostics,
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
        diagnostics: result.diagnostics,
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

  private getDebugCompileArgs(
    imageShaderCode: string,
    config: ShaderConfig | null,
  ): { code: string; config: ShaderConfig | null } {
    const debugState = this.shaderDebugManager.getState();
    const debugTarget = this.shaderDebugManager.getDebugTarget(imageShaderCode, config);
    if (isUnsupportedDebugTarget(debugTarget)) {
      return { code: imageShaderCode, config };
    }
    const sourceCode = debugTarget.code;
    const debugConfig = debugTarget.config;

    if (debugState.isActive && debugState.currentLine !== null) {
      const modifiedCode = this.shaderDebugManager.modifyShaderForDebugging(
        sourceCode,
        debugState.currentLine,
      );
      if (modifiedCode) {
        return { code: modifiedCode, config: debugConfig };
      }
    }

    // Fallback: apply full-shader post-processing (normalize/step without a specific line)
    if (debugState.isEnabled) {
      const postProcessed = this.shaderDebugManager.applyFullShaderPostProcessing(sourceCode);
      if (postProcessed) {
        return { code: postProcessed, config: debugConfig };
      }
    }

    return { code: imageShaderCode, config };
  }

  private async compile(
    code: string,
    config: any,
    path: string,
    buffers: Record<string, string>,
    customUniformDeclarations?: string,
    customUniformInfo?: { name: string; type: string }[],
    workspace?: SlangWorkspaceSnapshot,
  ): Promise<CompilationResult> {
    const result = await this.compilePipeline(
      code,
      config,
      path,
      buffers,
      customUniformDeclarations,
      customUniformInfo,
      workspace,
    );

    if (result?.superseded) {
      return this.supersededResult(result.errors);
    }

    if (!result?.success) {
      return {
        success: false,
        errors: result?.errors || ["Unknown compilation error"],
        diagnostics: result?.diagnostics,
      };
    }

    return {
      success: true,
      warnings: result.warnings,
      diagnostics: result.diagnostics,
    };
  }

  private compilePipeline(
    code: string, config: ShaderConfig | null, path: string, buffers: Record<string, string>,
    customUniformDeclarations?: string, customUniformInfo?: { name: string; type: string }[],
    workspace?: SlangWorkspaceSnapshot,
  ) {
    return workspace
      ? this.renderEngine.compileShaderPipeline(code, config, path, buffers, customUniformDeclarations, customUniformInfo, cloneSlangWorkspace(workspace))
      : this.renderEngine.compileShaderPipeline(code, config, path, buffers, customUniformDeclarations, customUniformInfo);
  }

  private getCompileBuffers(
    buffers: Record<string, string>,
    activeBufferName: string,
    codeToCompile: string,
    imageShaderCode: string,
  ): Record<string, string> {
    if (activeBufferName !== 'common' || codeToCompile === imageShaderCode || !('common' in buffers)) {
      return buffers;
    }

    const { common: _common, ...rest } = buffers;
    return rest;
  }

  public async processCommonBufferUpdate(code: string): Promise<CompilationResult> {
    try {
      const result = await this.renderEngine.updateBufferAndRecompile('common', code);

      if (result?.superseded) {
        return this.supersededResult(result.errors);
      }

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
    if (!this.imageShaderCode) {
      return { success: true };
    }

    const { config, path, buffers } = message;
    const workspace = message.workspace ? cloneSlangWorkspace(message.workspace) : undefined;

    // Pass custom uniform declarations through debug recompilations
    const cuDecl = message.customUniformDeclarations;
    const cuInfo = message.customUniformInfo;

    const debugState = this.shaderDebugManager.getState();
    const { code: codeToCompile, config: configToCompile } = this.getDebugCompileArgs(
      this.imageShaderCode,
      config ?? null,
    );
    const buffersToCompile = this.getCompileBuffers(
      buffers,
      debugState.activeBufferName,
      codeToCompile,
      this.imageShaderCode,
    );

    // Try compilation with debug-modified code, or original if modification failed
    let result = await this.compile(codeToCompile, configToCompile, path, buffersToCompile, cuDecl, cuInfo, workspace);

    // If failed and modified code was used, try original
    if (!result.superseded && !result.success && codeToCompile !== this.imageShaderCode) {
      this.shaderDebugManager.setDebugError(
        `Debug shader compilation failed: ${result.errors?.[0] || 'unknown error'}`
      );
      result = await this.compile(this.imageShaderCode, config, path, buffers, cuDecl, cuInfo, workspace);
    }

    // Start render loop if compilation succeeded
    if (result.success) {
      this.renderEngine.startRenderLoop();
    }

    return result;
  }

  private supersededResult(errors?: string[]): CompilationResult {
    return {
      success: false,
      errors: errors || ["Superseded by a newer compile"],
      superseded: true,
    };
  }
}
