import type { ShaderCompiler, ChannelSamplerType } from "./ShaderCompiler";
import type { ResourceManager } from "../resources/ResourceManager";
import { ShaderErrorFormatter } from "../util/ShaderErrorFormatter";
import type { Pass, CompilationResult, ShaderConfig, BufferPass, ImagePass } from "../models";
import type { PiRenderer, PiShader, PiTexture } from "../types/piRenderer";
import type { BufferManager } from "./BufferManager";
import type { TimeManager } from "../util/TimeManager";
import type { CustomUniformManager } from "./CustomUniformManager";
import { assignInputSlots } from "../util/InputSlotAssigner";
import { resolveBufferPassSize } from "./BufferPassResolution";
import type { WebGLRenderLimits } from "./WebGLRenderLimits";
import { resolvePassGeometry } from "../types/Geometry";

const VERTEX_SOURCE_PREFIX = "__shader_studio_vertex__:";

export class ShaderPipeline {
  private canvas: HTMLCanvasElement;
  private shaderCompiler: ShaderCompiler;
  private resourceManager: ResourceManager<PiTexture>;
  private renderer: PiRenderer;
  private bufferManager: BufferManager;
  private timeManager: TimeManager;
  private currentShaderRenderID = 0;
  private shaderPath = "";
  private passes: Pass[] = [];
  private passShaders: Record<string, PiShader> = {};
  private customUniformManager: CustomUniformManager | null = null;
  private disposed = false;
  // Which resources to reload when the next compiled pipeline is applied.
  // Deferred to the apply so cleanup never runs mid-recompile (black flash).
  // - "none":           reuse everything — the hot path for plain code recompiles.
  // - "all":            destroy and reload every resource (textures, cubemaps,
  //                     keyboard, videos, audio) and buffers. Set by
  //                     flagReloadOnNextApply() for structural config changes.
  // - "allExceptMedia": like "all" but video/audio elements survive so playback
  //                     continues. Set by resetTime() — the Reset button wipes
  //                     buffers and the clock without stopping media.
  // Neither reload scope touches the clock here; only resetTime() resets it.
  private resourceReloadScope: "none" | "all" | "allExceptMedia" = "none";

  constructor(
    canvas: HTMLCanvasElement,
    shaderCompiler: ShaderCompiler,
    resourceManager: ResourceManager<PiTexture>,
    renderer: PiRenderer,
    bufferManager: BufferManager,
    timeManager: TimeManager,
    private readonly renderLimits: WebGLRenderLimits | null = null,
  ) {
    this.canvas = canvas;
    this.shaderCompiler = shaderCompiler;
    this.resourceManager = resourceManager;
    this.renderer = renderer;
    this.bufferManager = bufferManager;
    this.timeManager = timeManager;
  }

  private isBufferPass(pass: BufferPass | ImagePass | undefined): pass is BufferPass {
    return !!pass && typeof pass === 'object' && 'path' in pass && typeof pass.path === 'string';
  }

  public getPasses(): Pass[] {
    return this.passes;
  }

  public getPass(passName: string): Pass | undefined {
    return this.passes.find(pass => pass.name === passName);
  }

  public getPassShaders(): Record<string, PiShader> {
    return this.passShaders;
  }

  public getPassShader(passName: string): PiShader | undefined {
    return this.passShaders[passName];
  }

  public setCustomUniformManager(manager: CustomUniformManager | null): void {
    this.customUniformManager = manager;
  }

  public getShaderPath(): string {
    return this.shaderPath;
  }

  public async compileShaderPipeline(
    code: string,
    config: ShaderConfig | null,
    path: string,
    buffers: Record<string, string> = {},
  ): Promise<CompilationResult> {
    if (this.disposed) {
      return { success: false, errors: ["Shader pipeline disposed"], superseded: true };
    }
    const pathChanged = this.shaderPath !== "" && this.shaderPath !== path;
    const nextPasses = this.buildPasses(code, config, buffers);
    const compilation = await this.compileShaders(nextPasses);

    if (this.disposed) {
      if (compilation.passShaders) {
        this.cleanupPartialShaders(compilation.passShaders);
      }
      return { success: false, errors: ["Shader pipeline disposed"], superseded: true };
    }

    if (!compilation.success) {
      if (pathChanged) {
        this.applyFailedCompilation(path, nextPasses);
      }
      return compilation;
    }

    if (!compilation.passShaders) {
      return {
        success: false,
        errors: ["Compiled pipeline result was incomplete"],
      };
    }

    this.applyCompiledPipeline(
      path,
      nextPasses,
      compilation.passShaders,
      pathChanged,
    );

    const compileWarnings = compilation.warnings || [];
    const resourceWarnings = await this.updateResources();
    if (!resourceWarnings) {
      return { success: false, errors: ["Shader pipeline disposed"], superseded: true };
    }
    const warnings = [...compileWarnings, ...resourceWarnings];
    return { success: true, warnings: warnings.length > 0 ? warnings : undefined };
  }

  private buildPasses(
    code: string,
    config: ShaderConfig | null,
    buffers: Record<string, string>
  ): Pass[] {
    const passNames = config?.passes
      ? Object.keys(config.passes)
      : [];

    if (passNames.length === 0) {
      return [{
        name: "Image",
        shaderSrc: code,
        inputs: {},
        geometry: resolvePassGeometry(undefined),
        path: undefined,
      }];
    }

    return passNames
      .map(passName => {
        const pass = config?.passes?.[passName];
        const shaderSrc = buffers[passName] || (passName === "Image" ? code : "");

        // Skip buffer passes with no path (not yet configured)
        if (passName !== "Image") {
          const bufferPath = (pass as BufferPass)?.path;
          if (!bufferPath && !shaderSrc) {
            return null;
          }
        }

        // Skip common buffer if there's no meaningful content
        if (passName === "common") {
          // Check if common buffer has actual GLSL functions/code, not just comments/whitespace
          const meaningfulContent = shaderSrc.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').trim();
          if (!meaningfulContent) {
            return null;
          }
        }

        return {
          name: passName,
          shaderSrc,
          vertexSrc: buffers[`${VERTEX_SOURCE_PREFIX}${passName}`],
          inputs: pass?.inputs ?? {},
          geometry: resolvePassGeometry(pass && "geometry" in pass ? pass : undefined),
          ...(pass?.geometry?.type === "model" ? {
            modelPath: pass.geometry.resolved_path ?? pass.geometry.path,
            modelMesh: pass.geometry.mesh,
          } : {}),
          path: this.isBufferPass(pass) ? (pass as BufferPass).path : undefined,
          resolution: this.isBufferPass(pass) ? (pass as BufferPass).resolution : undefined,
        };
      })
      .filter((pass): pass is NonNullable<typeof pass> => pass !== null);
  }

  private getChannelTypes(pass: Pass, slotAssignments = assignInputSlots(pass.inputs)): ChannelSamplerType[] {
    const channelCount = Math.max(4, slotAssignments.length);
    const types: ChannelSamplerType[] = new Array(channelCount).fill('2D');

    for (const { slot, key } of slotAssignments) {
      const input = pass.inputs[key];
      if (input?.type === 'cubemap') {
        types[slot] = 'Cube';
      }
    }

    return types;
  }

  private async compileShaders(
    candidatePasses: Pass[],
  ): Promise<CompilationResult & {
    passShaders?: Record<string, PiShader>;
  }> {
    const newPassShaders: Record<string, PiShader> = {};

    // Extract common code if it exists
    const commonBufferPass = candidatePasses.find(pass => pass.name === "common");
    const commonCode = commonBufferPass?.shaderSrc || "";

    for (const pass of candidatePasses) {
      // Skip common as it's not a render target and doesn't need mainImage
      if (pass.name === "common") {
        continue;
      }

      // Check if buffer pass has empty shader source (likely missing or invalid file)
      if (!pass.shaderSrc || pass.shaderSrc.trim() === "") {
        this.cleanupPartialShaders(newPassShaders);
        const pathInfo = pass.path ? ` (path: "${pass.path}")` : "";
        return {
          success: false,
          errors: [`${pass.name}: Buffer file not found or is empty${pathInfo}. Please check that the file exists and contains valid shader code.`],
        };
      }

      const slotAssignments = assignInputSlots(pass.inputs);
      const channelTypes = this.getChannelTypes(pass, slotAssignments);

      const customDecl = this.customUniformManager?.getDeclarations() || undefined;
      let svelteHeaderLines: number;
      let commonCodeLineCount: number;
      let shader: PiShader | null;
      try {
        ({ headerLineCount: svelteHeaderLines, commonCodeLineCount } = this.shaderCompiler
          .wrapShaderToyCode(pass.shaderSrc, {
            geometry: pass.geometry,
            commonCode,
            slotAssignments,
            channelTypes,
            customUniformDeclarations: customDecl,
            vertexCode: pass.vertexSrc,
          }));
        shader = await this.shaderCompiler.compileShaderAsync(pass.shaderSrc, {
          geometry: pass.geometry,
          commonCode,
          slotAssignments,
          channelTypes,
          customUniformDeclarations: customDecl,
          vertexCode: pass.vertexSrc,
        });
      } catch (error) {
        this.cleanupPartialShaders(newPassShaders);
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          errors: [`${pass.name}: ${message}`],
        };
      }

      if (!shader || !shader.mResult) {
        this.cleanupPartialShaders(newPassShaders);

        if (!shader) {
          return {
            success: false,
            errors: [`${pass.name}: Failed to compile shader`],
          };
        }

        const formattedErrors = ShaderErrorFormatter.formatShaderError(
          shader.mInfo,
          this.renderer,
          svelteHeaderLines,
          commonCodeLineCount,
        );

        const errors: string[] = formattedErrors.map(err => {
          const errorPassName = err.isCommonBufferError ? "common" : pass.name;
          return `${errorPassName}: ${err.message}`;
        });

        return {
          success: false,
          errors: errors.length > 0 ? errors : [`${pass.name}: Failed to compile shader`],
        };
      }

      newPassShaders[pass.name] = shader;
    }

    return {
      success: true,
      passShaders: newPassShaders,
    };
  }

  private applyCompiledPipeline(
    path: string,
    nextPasses: Pass[],
    nextPassShaders: Record<string, PiShader>,
    pathChanged: boolean,
  ): void {
    this.currentShaderRenderID++;

    if (pathChanged) {
      this.cleanup();
    } else if (this.resourceReloadScope !== "none") {
      const reloadScope = this.resourceReloadScope;
      this.resourceReloadScope = "none";
      if (reloadScope === "allExceptMedia") {
        this.resourceManager.cleanupAllExceptMedia();
      } else {
        this.resourceManager.cleanup();
      }
      this.cleanupShaders();
      this.bufferManager.dispose();
    } else {
      this.cleanupShaders(this.passShaders);
    }

    // Allocate buffers synchronously from current state — no async window means no stale references.
    const currentPassBuffers = this.bufferManager.getPassBuffers();
    const nextPassBuffers: Record<string, any> = {};
    const replacedBuffers: Record<string, any> = {};

    for (const pass of nextPasses) {
      if (pass.name === "Image" || pass.name === "common") {
        continue;
      }
      const size = resolveBufferPassSize(pass, this.canvas.width || 800, this.canvas.height || 600, this.renderLimits);
      const requiresDepth = pass.geometry !== "fullscreen";
      const current = currentPassBuffers[pass.name];
      const matches = current
        && current.front?.mTex0?.mXres === size.width
        && current.front?.mTex0?.mYres === size.height
        && (current.requiresDepth ?? false) === requiresDepth;
      if (matches) {
        nextPassBuffers[pass.name] = current;
      } else {
        nextPassBuffers[pass.name] = this.bufferManager.createPingPongBuffers(size.width, size.height, requiresDepth);
        if (current) {
          replacedBuffers[pass.name] = current;
        }
      }
    }

    // Clean up buffers for passes that no longer exist
    const oldPassBuffers = { ...currentPassBuffers };
    for (const name of Object.keys(nextPassBuffers)) {
      delete oldPassBuffers[name];
    }
    this.bufferManager.cleanupBuffers(oldPassBuffers);
    this.bufferManager.cleanupBuffers(replacedBuffers);

    this.shaderPath = path;
    this.passes = nextPasses;
    this.passShaders = nextPassShaders;
    this.bufferManager.setPassBuffers(nextPassBuffers);
  }

  private applyFailedCompilation(
    path: string,
    nextPasses: Pass[],
  ): void {
    this.cleanup();
    this.currentShaderRenderID++;
    this.shaderPath = path;
    this.passes = nextPasses;
  }

  private async updateResources(): Promise<string[] | null> {
    const warnings: string[] = [];
    for (const pass of this.passes) {
      for (const key of Object.keys(pass.inputs)) {
        const input = pass.inputs[key];
        if (input?.type === "texture" && input.path) {
          const textureOptions = {
            filter: input.filter,
            wrap: input.wrap,
            vflip: input.vflip,
            grayscale: input.grayscale
          };
          await this.resourceManager.loadImageTexture(input.resolved_path || input.path, textureOptions);
          if (this.cleanupLateResources()) {
            return null;
          }
        } else if (input?.type === "video" && input.path) {
          const videoOptions = {
            filter: input.filter,
            wrap: input.wrap,
            vflip: input.vflip,
            muted: input.muted,
          };
          const result = await this.resourceManager.loadVideoTexture(input.resolved_path || input.path, videoOptions);
          if (this.cleanupLateResources()) {
            return null;
          }
          if (result.warning) {
            warnings.push(result.warning);
          }
        } else if (input?.type === "cubemap" && input.path) {
          const cubemapOptions = {
            filter: input.filter,
            wrap: input.wrap,
            vflip: input.vflip
          };
          await this.resourceManager.loadCubemapTexture(input.resolved_path || input.path, cubemapOptions);
          if (this.cleanupLateResources()) {
            return null;
          }
        } else if (input?.type === "audio" && input.path) {
          try {
            const audioLoadOptions = {
              muted: input.muted,
              startTime: input.startTime,
              endTime: input.endTime,
            };
            const audioPath = input.resolved_path || input.path;
            await this.resourceManager.loadAudioSource(audioPath, audioLoadOptions);
            if (this.cleanupLateResources()) {
              return null;
            }
            // Always update loop region (audio may already be loaded from previous compile)
            this.resourceManager.updateAudioLoopRegion(audioPath, input.startTime, input.endTime);
          } catch (error) {
            if (this.cleanupLateResources()) {
              return null;
            }
            warnings.push(`Audio loading failed: ${input.path}`);
          }
        }
      }
    }
    return warnings;
  }

  private cleanupPartialShaders(shaders: Record<string, PiShader>): void {
    for (const key in shaders) {
      this.renderer.DestroyShader(shaders[key]);
    }
  }

  public cleanup(): void {
    this.resourceManager.cleanup();
    this.cleanupShaders();
    this.bufferManager.dispose();
    this.timeManager.cleanup();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    let firstError: unknown;
    let hasError = false;
    const attempt = (cleanup: () => void): void => {
      try {
        cleanup();
      } catch (error) {
        if (!hasError) {
          firstError = error;
          hasError = true;
        }
      }
    };
    const shaders = this.passShaders;
    this.passes = [];
    this.passShaders = {};
    attempt(() => this.resourceManager.cleanup());
    attempt(() => this.cleanupShaders(shaders));
    attempt(() => this.bufferManager.dispose());
    attempt(() => this.timeManager.cleanup());
    if (hasError) {
      throw firstError;
    }
  }

  private cleanupLateResources(): boolean {
    if (!this.disposed) {
      return false;
    }
    try {
      this.resourceManager.cleanup();
    } catch {
      // The original dispose call owns teardown error reporting.
    }
    return true;
  }

  public resetTime(): void {
    this.timeManager.cleanup();
    this.resourceReloadScope = "allExceptMedia";
  }

  public flagReloadOnNextApply(): void {
    this.resourceReloadScope = "all";
  }

  private cleanupShaders(shaders?: Record<string, PiShader | null>): void {
    const shadersToCleanup = shaders || this.passShaders;

    for (const key in shadersToCleanup) {
      const shader = shadersToCleanup[key];
      if (shader) {
        this.renderer.DestroyShader(shader);
      }
    }

    if (!shaders) {
      this.passShaders = {};
    }
  }
}
