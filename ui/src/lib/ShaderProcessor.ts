import type { RenderingEngine } from "../../../rendering/src/types/RenderingEngine";
import type { ShaderDebugManager } from "./ShaderDebugManager";
import type { ShaderSourceMessage, ShaderConfig } from "@shader-studio/types";
import type { DebugInstrumentationPlan } from "@shader-studio/types";

export interface CompilationResult {
  success: boolean;
  errors?: string[];
  warnings?: string[];
  superseded?: true;
}

interface BaselineInputs {
  code: string;
  config: ShaderConfig | null;
  path: string;
  buffers: Record<string, string>;
  customUniformDeclarations?: string;
}

export class ShaderProcessor {
  private renderEngine: RenderingEngine;
  private shaderDebugManager: ShaderDebugManager;
  private imageShaderCode: string | null = null;
  private isProcessing = false;
  private verifiedBaseline: BaselineInputs | null = null;

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

  /**
   * The custom uniforms a message speaks for. A bare-file preview - a common
   * pass, a helper with no mainImage - carries no config and so declares none,
   * but it is not saying the shader has none: compiling it with none clears the
   * engine's uniform state, and because the host sends only values that changed
   * after its first batch, every uniform the script holds constant would stay
   * at zero for the life of the shader. The engine's own declarations stand in.
   */
  private resolveCustomUniforms(message: ShaderSourceMessage): {
    declarations?: string;
    info?: { name: string; type: string }[];
  } {
    if (message.customUniformDeclarations || !message.scriptContextOmitted) {
      return {
        declarations: message.customUniformDeclarations,
        info: message.customUniformInfo,
      };
    }
    const declarations = this.renderEngine.getCustomUniformDeclarations?.() || undefined;
    const info = this.renderEngine.getCustomUniformInfo?.() ?? [];
    return declarations && info.length > 0 ? { declarations, info } : {};
  }

  public async processMainShaderCompilation(
    message: ShaderSourceMessage,
    reload: boolean = false,
  ): Promise<CompilationResult> {
    const { code, config, path, buffers } = message;
    const scriptBundleError = message.scriptBundleError;
    const customUniforms = this.resolveCustomUniforms(message);

    // A config that cannot be read would compile as a shader with no inputs,
    // which renders as an unexplained black frame. Report it instead.
    if (message.configError) {
      return { success: false, errors: [message.configError] };
    }

    if (message.slangDependencyDiagnostics?.length) {
      return {
        success: false,
        errors: message.slangDependencyDiagnostics.map((diagnostic) => diagnostic.message),
      };
    }

    this.isProcessing = true;
    this.imageShaderCode = code;
    this.shaderDebugManager.setImageShaderCode(code);

    if (reload) {
      this.renderEngine.flagReloadOnNextApply();
    }

    try {
      const {
        code: codeToCompile,
        config: configToCompile,
        passName: debugPassName,
        slangModules: debugSlangModules,
        sourcePath: debugSourcePath,
        debugPlan,
      } = this.getDebugCompileArgs(code, config ?? null, message.originalCode ?? code);
      const buffersToCompile = this.getCompileBuffers(buffers, debugPassName, codeToCompile, code);

      if (codeToCompile !== code) {
        const baselineFailure = await this.compileUninstrumentedBaseline(message, code, config ?? null, path, buffers);
        if (baselineFailure) {
          return this.withScriptCause(baselineFailure, scriptBundleError);
        }
      }

      const result = debugPlan && this.renderEngine.compileSlangDebugPlan
        ? await this.renderEngine.compileSlangDebugPlan(debugPlan, config ?? null)
        : await this.compileWithSlangContext(
          codeToCompile,
          configToCompile,
          path,
          buffersToCompile,
          customUniforms.declarations,
          customUniforms.info,
          debugSlangModules ?? message.slangModules,
          debugSourcePath,
          message.bufferPathMap,
        );

      // Handle compilation failure
      if (result?.superseded) {
        return this.supersededResult(result.errors);
      }

      // An uninstrumented compile is a baseline in its own right, so the first
      // line the cursor lands on afterwards has nothing left to verify.
      if (
        !debugPlan
        && codeToCompile === code
        && configToCompile === (config ?? null)
        && buffersToCompile === buffers
      ) {
        if (result?.success) {
          this.markBaselineVerified(code, config ?? null, path, buffers, customUniforms.declarations);
        } else {
          this.verifiedBaseline = null;
        }
      }

      if (!result?.success) {
        // If debug mode compilation failed, fall back to the original code
        if (debugPlan || codeToCompile !== code) {
          this.shaderDebugManager.setDebugError(
            `Debug shader compilation failed: ${result?.errors?.[0] || 'unknown error'}`
          );
          // An instrumented compile runs after the untouched source has already
          // compiled and installed, so there is nothing left to fall back to.
          // Only a Slang debug plan, which compiles the real source itself,
          // still needs the original built here.
          const fallbackResult = codeToCompile !== code
            ? { success: true }
            : await this.compile(
              code,
              config,
              path,
              buffers,
              customUniforms.declarations,
              customUniforms.info,
              message.slangModules,
              undefined,
              message.bufferPathMap,
            );
          if (fallbackResult.success) {
            this.renderEngine.startRenderLoop();
          }
          return this.withScriptCause(fallbackResult, scriptBundleError);
        }

        return this.withScriptCause({
          success: false,
          errors: result?.errors || ["Unknown compilation error"],
        }, scriptBundleError);
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


  /**
   * A script that failed to load declares none of its uniforms, so the shader
   * fails on identifiers that are spelled correctly. On its own the compile
   * error sends the user hunting a typo in the shader, so the script failure -
   * the actual cause - leads the report. A superseded compile is replaced by a
   * newer one that carries its own copy of the error, so it is left alone.
   */
  private withScriptCause(
    result: CompilationResult,
    scriptBundleError?: string,
  ): CompilationResult {
    if (!scriptBundleError || result.success || result.superseded) {
      return result;
    }
    return {
      ...result,
      errors: [`Script: ${scriptBundleError}`, ...(result.errors ?? [])],
    };
  }

  /**
   * Debug instrumentation rewrites the shader - truncating the body at the
   * inspected line, or post-processing it for inline rendering - so a broken
   * statement below that line simply is not in what gets compiled. Reporting
   * the instrumented compile's success then tells the user their shader is
   * fine while it is not, and clears the real errors from the panel.
   *
   * Compiling the untouched source first settles what the user is told. It also
   * leaves the working program installed when the instrumented compile that
   * follows fails, which is what the old fallback path did by hand.
   */
  private async compileUninstrumentedBaseline(
    message: ShaderSourceMessage,
    code: string,
    config: ShaderConfig | null,
    path: string,
    buffers: Record<string, string>,
  ): Promise<CompilationResult | null> {
    const customUniforms = this.resolveCustomUniforms(message);
    const result = await this.compileWithSlangContext(
      code,
      config,
      path,
      buffers,
      customUniforms.declarations,
      customUniforms.info,
      message.slangModules,
      undefined,
      message.bufferPathMap,
    );
    if (result?.superseded) {
      return this.supersededResult(result.errors);
    }
    if (!result?.success) {
      this.verifiedBaseline = null;
      return { success: false, errors: result?.errors || ["Unknown compilation error"] };
    }
    this.markBaselineVerified(code, config, path, buffers, customUniforms.declarations);
    return null;
  }

  /**
   * The untouched source compiles the same way wherever the cursor sits, so its
   * verdict holds until the shader, its config, its buffers or its uniform
   * declarations change. Recompiling it on every line move installs it, and the
   * render loop shows the whole shader until the instrumented compile that
   * follows lands - a flash of the full image between two debugged lines.
   *
   * Only successes are remembered: a source that fails to compile must keep
   * reporting that failure rather than letting a truncated instrumented compile
   * claim the shader is fine.
   */
  private markBaselineVerified(
    code: string,
    config: ShaderConfig | null,
    path: string,
    buffers: Record<string, string>,
    customUniformDeclarations?: string,
  ): void {
    this.verifiedBaseline = { code, config, path, buffers, customUniformDeclarations };
  }

  private isBaselineVerified(
    code: string,
    config: ShaderConfig | null,
    path: string,
    buffers: Record<string, string>,
    customUniformDeclarations?: string,
  ): boolean {
    const verified = this.verifiedBaseline;
    return verified !== null
      && verified.code === code
      && verified.config === config
      && verified.path === path
      && verified.buffers === buffers
      && verified.customUniformDeclarations === customUniformDeclarations;
  }

  private getDebugCompileArgs(
    imageShaderCode: string,
    config: ShaderConfig | null,
    originalImageShaderCode = imageShaderCode,
  ): {
    code: string;
    config: ShaderConfig | null;
    passName: string;
    slangModules?: import("@shader-studio/types").SlangSourceModule[];
    sourcePath?: string;
    debugPlan?: DebugInstrumentationPlan;
  } {
    const debugState = this.shaderDebugManager.getState();
    const debugTarget = this.shaderDebugManager.getDebugTarget(imageShaderCode, config);
    const sourceCode = debugTarget.code;
    const debugConfig = debugTarget.config;

    const slangPlan = this.shaderDebugManager.getSlangPreviewPlan?.(
      imageShaderCode,
      config,
      originalImageShaderCode,
    );
    if (slangPlan) {
      return { code: imageShaderCode, config, passName: 'Image', debugPlan: slangPlan };
    }
    if (this.shaderDebugManager.getLanguage?.() === 'slang') {
      const postProcessed = debugState.isEnabled
        ? this.shaderDebugManager.applyFullShaderPostProcessing(sourceCode)
        : null;
      return postProcessed
        ? {
          code: postProcessed,
          config: debugConfig,
          passName: debugTarget.passName,
          slangModules: debugTarget.slangModules,
          sourcePath: debugTarget.sourcePath,
        }
        : { code: imageShaderCode, config, passName: 'Image' };
    }

    if (debugState.isActive && debugState.currentLine !== null) {
      const modifiedCode = this.shaderDebugManager.modifyShaderForDebugging(
        sourceCode,
        debugState.currentLine,
      );
      if (modifiedCode) {
        return {
          code: modifiedCode,
          config: debugConfig,
          passName: debugTarget.passName,
          slangModules: debugTarget.slangModules,
          sourcePath: debugTarget.sourcePath,
        };
      }
    }

    // Fallback: apply full-shader post-processing (normalize/step without a specific line)
    if (debugState.isEnabled) {
      const postProcessed = this.shaderDebugManager.applyFullShaderPostProcessing(sourceCode);
      if (postProcessed) {
        return {
          code: postProcessed,
          config: debugConfig,
          passName: debugTarget.passName,
          slangModules: debugTarget.slangModules,
          sourcePath: debugTarget.sourcePath,
        };
      }
    }

    return { code: imageShaderCode, config, passName: 'Image' };
  }

  private async compile(
    code: string,
    config: any,
    path: string,
    buffers: Record<string, string>,
    customUniformDeclarations?: string,
    customUniformInfo?: { name: string; type: string }[],
    slangModules?: import("@shader-studio/types").SlangSourceModule[],
    slangSourcePath?: string,
    slangSourcePaths?: Record<string, string>,
  ): Promise<CompilationResult> {
    const result = await this.compileWithSlangContext(
      code,
      config,
      path,
      buffers,
      customUniformDeclarations,
      customUniformInfo,
      slangModules,
      slangSourcePath,
      slangSourcePaths,
    );

    if (result?.superseded) {
      return this.supersededResult(result.errors);
    }

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

  private compileWithSlangContext(
    code: string,
    config: ShaderConfig | null,
    path: string,
    buffers: Record<string, string>,
    customUniformDeclarations?: string,
    customUniformInfo?: { name: string; type: string }[],
    slangModules?: import("@shader-studio/types").SlangSourceModule[],
    slangSourcePath?: string,
    slangSourcePaths?: Record<string, string>,
  ): ReturnType<RenderingEngine['compileShaderPipeline']> {
    const args: Parameters<RenderingEngine['compileShaderPipeline']> = [
      code,
      config,
      path,
      buffers,
      customUniformDeclarations,
      customUniformInfo,
    ];
    if (slangModules !== undefined || slangSourcePath !== undefined || slangSourcePaths !== undefined) {
      args.push(slangModules);
    }
    if (slangSourcePath !== undefined || slangSourcePaths !== undefined) {
      args.push(slangSourcePath);
    }
    if (slangSourcePaths !== undefined) {
      args.push(slangSourcePaths);
    }
    return this.renderEngine.compileShaderPipeline(...args);
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
          errors: result?.errors || ["Unknown compilation error"],
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

    // Pass custom uniform declarations through debug recompilations
    const { declarations: cuDecl, info: cuInfo } = this.resolveCustomUniforms(message);

    const {
      code: codeToCompile,
      config: configToCompile,
      passName: debugPassName,
      slangModules: debugSlangModules,
      sourcePath: debugSourcePath,
      debugPlan,
    } = this.getDebugCompileArgs(
      this.imageShaderCode,
      config ?? null,
      message.originalCode ?? this.imageShaderCode,
    );
    const buffersToCompile = this.getCompileBuffers(
      buffers,
      debugPassName,
      codeToCompile,
      this.imageShaderCode,
    );

    // Cursor movement re-enters here with the shader it already verified, so
    // the untouched compile is skipped rather than flashing the whole shader
    // between lines. A failed instrumented compile still restores the original
    // below, which is what the baseline install would otherwise have covered.
    if (
      codeToCompile !== this.imageShaderCode
      && !this.isBaselineVerified(this.imageShaderCode, config ?? null, path, buffers, cuDecl)
    ) {
      const baselineFailure = await this.compileUninstrumentedBaseline(
        message,
        this.imageShaderCode,
        config ?? null,
        path,
        buffers,
      );
      if (baselineFailure) {
        return baselineFailure;
      }
    }

    // Cursor movement uses this path, so native Slang preview plans must be
    // routed here as well as through the initial shader-source compilation.
    const structuredResult = debugPlan && this.renderEngine.compileSlangDebugPlan
      ? await this.renderEngine.compileSlangDebugPlan(debugPlan, config ?? null)
      : undefined;
    let result: CompilationResult = structuredResult ?? (debugPlan
      ? { success: false, errors: ["Native Slang debug compilation is unavailable"] }
      : await this.compile(
        codeToCompile,
        configToCompile,
        path,
        buffersToCompile,
        cuDecl,
        cuInfo,
        debugSlangModules ?? message.slangModules,
        debugSourcePath,
        message.bufferPathMap,
      ));

    // If failed and modified code was used, try original
    if (!result?.superseded && !result?.success && (debugPlan || codeToCompile !== this.imageShaderCode)) {
      this.shaderDebugManager.setDebugError(
        `Debug shader compilation failed: ${result.errors?.[0] || 'unknown error'}`
      );
      result = await this.compile(
        this.imageShaderCode,
        config,
        path,
        buffers,
        cuDecl,
        cuInfo,
        message.slangModules,
        undefined,
        message.bufferPathMap,
      );
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
