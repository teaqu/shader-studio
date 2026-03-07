import type { ShaderCompiler } from "./ShaderCompiler";
import type { ChannelSamplerType } from "./ShaderCompiler";
import type { ResourceManager } from "./ResourceManager";
import { ShaderErrorFormatter } from "./util/ShaderErrorFormatter";
import type { Pass, Buffers, CompilationResult, ShaderConfig, BufferPass, ImagePass } from "./models";
import type { PiRenderer, PiShader } from "./types/piRenderer";
import type { BufferManager } from "./BufferManager";
import type { CubemapBufferManager } from "./CubemapBufferManager";
import type { TimeManager } from "./util/TimeManager";
import { assignInputSlots, type SlotAssignment } from "./util/InputSlotAssigner";

export class ShaderPipeline {
  private canvas: HTMLCanvasElement;
  private shaderCompiler: ShaderCompiler;
  private resourceManager: ResourceManager;
  private renderer: PiRenderer;
  private bufferManager: BufferManager;
  private cubemapBufferManager: CubemapBufferManager;
  private timeManager: TimeManager;
  private currentShaderRenderID = 0;
  private shaderPath = "";
  private passes: Pass[] = [];
  private passShaders: Record<string, PiShader> = {};
  private passSlotAssignments: Record<string, SlotAssignment[]> = {};

  constructor(
    canvas: HTMLCanvasElement,
    shaderCompiler: ShaderCompiler,
    resourceManager: ResourceManager,
    renderer: PiRenderer,
    bufferManager: BufferManager,
    timeManager: TimeManager,
    cubemapBufferManager: CubemapBufferManager,
  ) {
    this.canvas = canvas;
    this.shaderCompiler = shaderCompiler;
    this.resourceManager = resourceManager;
    this.renderer = renderer;
    this.bufferManager = bufferManager;
    this.cubemapBufferManager = cubemapBufferManager;
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

  public getPassSlotAssignments(passName: string): SlotAssignment[] {
    return this.passSlotAssignments[passName] ?? [];
  }

  public getPassBuffers(): Buffers {
    return this.bufferManager.getPassBuffers();
  }

  public setPassBuffers(
    buffers: Buffers,
  ): void {
    this.bufferManager.setPassBuffers(buffers);
  }

  public getCurrentShaderRenderID(): number {
    return this.currentShaderRenderID;
  }

  public getShaderPath(): string {
    return this.shaderPath;
  }

  public async compileShaderPipeline(
    code: string,
    config: ShaderConfig | null,
    path: string,
    buffers: Record<string, string> = {},
    audioOptions?: { muted?: boolean; volume?: number },
  ): Promise<CompilationResult> {
    this.prepareNewCompilation(path);
    this.buildPasses(code, config, buffers);

    const compilation = await this.compileShaders();

    if (!compilation.success) {
      return compilation;
    }

    const compileWarnings = compilation.warnings || [];
    const resourceWarnings = await this.updateResources(audioOptions);
    const warnings = [...compileWarnings, ...resourceWarnings];
    return { success: true, warnings: warnings.length > 0 ? warnings : undefined };
  }

  private prepareNewCompilation(path: string): void {
    this.currentShaderRenderID++;

    if (this.shaderPath !== "" && this.shaderPath !== path) {
      this.cleanup();
    }

    this.shaderPath = path;
  }

  private buildPasses(
    code: string,
    config: ShaderConfig | null,
    buffers: Record<string, string>
  ): void {
    const passNames = config?.passes
      ? Object.keys(config.passes)
      : [];

    if (passNames.length === 0) {
      this.passes = [{
        name: "Image",
        shaderSrc: code,
        inputs: {},
        path: undefined,
      }];
      return;
    }

    this.passes = passNames
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

  private getChannelTypes(pass: Pass): ChannelSamplerType[] {
    const types: ChannelSamplerType[] = ['2D', '2D', '2D', '2D'];
    for (let i = 0; i < 4; i++) {
      const input = pass.inputs[`iChannel${i}`];
      if (input?.type === 'cubemap') {
        types[i] = 'Cube';
      } else if (input?.type === 'volume') {
        types[i] = '3D';
      }
    }
    return types;
  }

  private async compileShaders(): Promise<CompilationResult> {
    const oldPassShaders = { ...this.passShaders };
    const oldPassBuffers = { ...this.bufferManager.getPassBuffers() };

    const newPassShaders: Record<string, PiShader> = {};
    const newPassBuffers: Record<string, any> = {};
    const warnings: string[] = [];

    // Extract common code if it exists
    const commonBufferPass = this.passes.find(pass => pass.name === "common");
    const commonCode = commonBufferPass?.shaderSrc || "";

    for (const pass of this.passes) {
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
      this.passSlotAssignments[pass.name] = slotAssignments;

      const channelTypes = this.getChannelTypes(pass);
      const isCubemapPass = pass.name === "CubeA";

      let svelteHeaderLines: number;
      let commonCodeLineCount: number = 0;
      let shader: PiShader | null;

      if (isCubemapPass) {
        svelteHeaderLines = this.shaderCompiler
          .wrapCubemapCode(pass.shaderSrc, commonCode, channelTypes).headerLineCount;
        shader = this.shaderCompiler.compileCubemapShader(pass.shaderSrc, commonCode, channelTypes);
      } else {
        const wrapped = this.shaderCompiler
          .wrapShaderToyCode(pass.shaderSrc, commonCode, slotAssignments, channelTypes);
        svelteHeaderLines = wrapped.headerLineCount;
        commonCodeLineCount = wrapped.commonCodeLineCount;
        shader = this.shaderCompiler.compileShader(pass.shaderSrc, commonCode, slotAssignments, channelTypes);
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
      this.passShaders[pass.name] = shader;

      if (isCubemapPass) {
        // Create cubemap buffer instead of ping-pong 2D buffers
        try {
          this.cubemapBufferManager.createCubemapBuffer();
        } catch {
          // Continue rendering without CubeA RT when unsupported; cubemap inputs will use fallback texture.
          warnings.push("CubeA: Failed to create cubemap render targets. Continuing without dynamic cubemap rendering.");
        }
      } else if (pass.name !== "Image" && pass.name !== "common") {
        if (oldPassBuffers[pass.name]) {
          newPassBuffers[pass.name] = oldPassBuffers[pass.name];
          delete oldPassBuffers[pass.name];
        } else {
          newPassBuffers[pass.name] = this.bufferManager
            .createPingPongBuffers(
              this.canvas.width || 800,
              this.canvas.height || 600,
            );
        }
      }
    }

    this.bufferManager.setPassBuffers(newPassBuffers);

    // Clean up old resources
    for (const key in oldPassShaders) {
      const shader = oldPassShaders[key];
      if (shader) {
        this.renderer.DestroyShader(shader);
      }
    }
    this.bufferManager.cleanupBuffers(oldPassBuffers);

    return { success: true, warnings: warnings.length > 0 ? warnings : undefined };
  }

  private async updateResources(audioOptions?: { muted?: boolean; volume?: number }): Promise<string[]> {
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
        } else if (input?.type === "audio" && input.path) {
          try {
            const audioLoadOptions = {
              ...audioOptions,
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
        } else if (input?.type === "volume" && input.path) {
          const volumeOptions = {
            filter: input.filter,
            wrap: input.wrap,
          };
          try {
            await this.resourceManager.loadVolumeTexture(input.resolved_path || input.path, volumeOptions);
          } catch (error) {
            warnings.push(`Volume texture loading failed: ${input.path}`);
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
