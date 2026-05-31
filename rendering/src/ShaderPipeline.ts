import type { ShaderCompiler, ChannelSamplerType } from "./ShaderCompiler";
import type { ResourceManager } from "./ResourceManager";
import { ShaderErrorFormatter } from "./util/ShaderErrorFormatter";
import type { Pass, Buffers, CompilationResult, ShaderConfig, BufferPass, ImagePass } from "./models";
import type { PiRenderer, PiShader } from "./types/piRenderer";
import type { BufferManager } from "./BufferManager";
import type { TimeManager } from "./util/TimeManager";
import type { CustomUniformManager } from "./CustomUniformManager";
import { assignInputSlots } from "./util/InputSlotAssigner";

export class ShaderPipeline {
  private canvas: HTMLCanvasElement;
  private shaderCompiler: ShaderCompiler;
  private resourceManager: ResourceManager;
  private renderer: PiRenderer;
  private bufferManager: BufferManager;
  private timeManager: TimeManager;
  private currentShaderRenderID = 0;
  private shaderPath = "";
  private passes: Pass[] = [];
  private passShaders: Record<string, PiShader> = {};
  private customUniformManager: CustomUniformManager | null = null;
  private clearBuffersOnNextApply = false;

  constructor(
    canvas: HTMLCanvasElement,
    shaderCompiler: ShaderCompiler,
    resourceManager: ResourceManager,
    renderer: PiRenderer,
    bufferManager: BufferManager,
    timeManager: TimeManager
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
    const pathChanged = this.shaderPath !== "" && this.shaderPath !== path;
    const nextPasses = this.buildPasses(code, config, buffers);
    const compilation = await this.compileShaders(nextPasses);

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
          inputs: pass?.inputs ?? {},
          path: this.isBufferPass(pass) ? (pass as BufferPass).path : undefined,
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
      const { headerLineCount: svelteHeaderLines, commonCodeLineCount } = this.shaderCompiler
        .wrapShaderToyCode(pass.shaderSrc, commonCode, slotAssignments, channelTypes, customDecl);
      const shader = await this.shaderCompiler.compileShaderAsync(pass.shaderSrc, commonCode, slotAssignments, channelTypes, customDecl);

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
    } else if (this.clearBuffersOnNextApply) {
      this.clearBuffersOnNextApply = false;
      // Free resources and buffers without resetting the clock — resetTime()
      // already reset it for explicit resets; config-triggered forceCleanup
      // should never touch the clock.
      this.resourceManager.cleanup();
      this.cleanupShaders();
      this.bufferManager.dispose();
    } else {
      this.cleanupShaders(this.passShaders);
    }

    // Allocate buffers synchronously from current state — no async window means no stale references.
    const currentPassBuffers = this.bufferManager.getPassBuffers();
    const nextPassBuffers: Record<string, any> = {};

    for (const pass of nextPasses) {
      if (pass.name === "Image" || pass.name === "common") continue;
      nextPassBuffers[pass.name] = currentPassBuffers[pass.name]
        ?? this.bufferManager.createPingPongBuffers(
          this.canvas.width || 800,
          this.canvas.height || 600,
        );
    }

    // Clean up buffers for passes that no longer exist
    const oldPassBuffers = { ...currentPassBuffers };
    for (const name of Object.keys(nextPassBuffers)) {
      delete oldPassBuffers[name];
    }
    this.bufferManager.cleanupBuffers(oldPassBuffers);

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

  private async updateResources(): Promise<string[]> {
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
        } else if (input?.type === "video" && input.path) {
          const videoOptions = {
            filter: input.filter,
            wrap: input.wrap,
            vflip: input.vflip
          };
          const result = await this.resourceManager.loadVideoTexture(input.resolved_path || input.path, videoOptions);
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
        } else if (input?.type === "audio" && input.path) {
          try {
            const audioLoadOptions = {
              startTime: input.startTime,
              endTime: input.endTime,
            };
            const audioPath = input.resolved_path || input.path;
            await this.resourceManager.loadAudioSource(audioPath, audioLoadOptions);
            // Always update loop region (audio may already be loaded from previous compile)
            this.resourceManager.updateAudioLoopRegion(audioPath, input.startTime, input.endTime);
          } catch (error) {
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

  public resetTime(): void {
    this.timeManager.cleanup();
    this.clearBuffersOnNextApply = true;
  }

  public flagForceCleanupOnNextApply(): void {
    this.clearBuffersOnNextApply = true;
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
