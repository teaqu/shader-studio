import type { ShaderCompiler, ChannelSamplerType } from "./ShaderCompiler";
import type { ResourceManager } from "./ResourceManager";
import { ShaderErrorFormatter } from "./util/ShaderErrorFormatter";
import type { Pass, Buffers, CompilationResult, ShaderConfig, BufferPass, ImagePass } from "./models";
import type { PiRenderer, PiShader } from "./types/piRenderer";
import type { BufferManager } from "./BufferManager";
import type { TimeManager } from "./util/TimeManager";
import { assignInputSlots, type SlotAssignment } from "./util/InputSlotAssigner";

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
  private passSlotAssignments: Record<string, SlotAssignment[]> = {};
  private passChannelTypes: Record<string, ChannelSamplerType[]> = {};
  private currentConfig: ShaderConfig | null = null;

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
  ): Promise<CompilationResult> {
    this.prepareNewCompilation(path);
    this.currentConfig = config;

    this.buildPasses(code, config, buffers);
    const compilation = await this.compileShaders();

    if (!compilation.success) {
      return compilation;
    }

    const warnings = await this.updateResources();
    return { success: true, warnings: warnings.length > 0 ? warnings : undefined };
  }

  private prepareNewCompilation(path: string): void {
    this.currentShaderRenderID++;

    if (this.shaderPath !== "" && this.shaderPath !== path) {
      this.cleanup();
      this.resetTime();
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

  private async compileShaders(): Promise<CompilationResult> {
    const oldPassShaders = { ...this.passShaders };
    const oldPassBuffers = { ...this.bufferManager.getPassBuffers() };

    const newPassShaders: Record<string, PiShader> = {};
    const newPassBuffers: Record<string, any> = {};

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

      const channelTypes = this.deriveChannelTypes(pass.inputs, slotAssignments);
      this.passChannelTypes[pass.name] = channelTypes;

      const { headerLineCount: svelteHeaderLines, commonCodeLineCount } = this.shaderCompiler
        .wrapShaderToyCode(pass.shaderSrc, commonCode, slotAssignments, channelTypes);
      const shader = this.shaderCompiler.compileShader(pass.shaderSrc, commonCode, slotAssignments, channelTypes);

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

      if (pass.name !== "Image" && pass.name !== "common") {
        if (oldPassBuffers[pass.name]) {
          newPassBuffers[pass.name] = oldPassBuffers[pass.name];
          delete oldPassBuffers[pass.name];
        } else {
          const bufferRes = (this.currentConfig?.passes?.[pass.name] as BufferPass)?.resolution;
          const bufW = bufferRes?.width ?? (this.canvas.width || 800);
          const bufH = bufferRes?.height ?? (this.canvas.height || 600);
          newPassBuffers[pass.name] = this.bufferManager
            .createPingPongBuffers(bufW, bufH);
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

    return { success: true };
  }

  private deriveChannelTypes(
    inputs: Record<string, any>,
    slotAssignments: SlotAssignment[],
  ): ChannelSamplerType[] {
    const channelCount = Math.max(4, slotAssignments.length);
    const types: ChannelSamplerType[] = new Array(channelCount).fill('2D');
    for (const { slot, key } of slotAssignments) {
      const input = inputs[key];
      if (input?.type === 'cubemap') {
        types[slot] = 'Cube';
      }
    }
    return types;
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
          await this.resourceManager.loadCubemapTexture(input.resolved_path || input.path, {
            filter: input.filter,
            wrap: input.wrap,
            vflip: input.vflip,
          });
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
  }

  public resetTime(): void {
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
