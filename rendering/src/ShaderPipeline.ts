import type { ShaderCompiler, ChannelSamplerType } from "./ShaderCompiler";
import type { ResourceManager } from "./ResourceManager";
import { ShaderErrorFormatter } from "./util/ShaderErrorFormatter";
import type { Pass, Buffers, CompilationResult, ShaderConfig, BufferPass, ImagePass } from "./models";
import type { PiRenderer, PiShader } from "./types/piRenderer";
import type { BufferManager } from "./BufferManager";
import type { TimeManager } from "./util/TimeManager";
import type { CustomUniformManager } from "./CustomUniformManager";
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
  private customUniformManager: CustomUniformManager | null = null;

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
    const compilation = await this.compileShaders(nextPasses, pathChanged);

    if (!compilation.success) {
      if (pathChanged) {
        this.applyFailedCompilation(path, nextPasses);
      }
      return compilation;
    }

    if (!compilation.passShaders || !compilation.passBuffers || !compilation.passSlotAssignments) {
      return {
        success: false,
        errors: ["Compiled pipeline result was incomplete"],
      };
    }

    this.applyCompiledPipeline(
      path,
      nextPasses,
      compilation.passShaders,
      compilation.passBuffers,
      compilation.passSlotAssignments,
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

  private getChannelTypes(pass: Pass): ChannelSamplerType[] {
    const types: ChannelSamplerType[] = ['2D', '2D', '2D', '2D'];
    return types;
  }

  private async compileShaders(
    candidatePasses: Pass[],
    pathChanged: boolean,
  ): Promise<CompilationResult & {
    passShaders?: Record<string, PiShader>;
    passBuffers?: Record<string, any>;
    passSlotAssignments?: Record<string, SlotAssignment[]>;
  }> {
    const oldPassBuffers = { ...this.bufferManager.getPassBuffers() };

    const newPassShaders: Record<string, PiShader> = {};
    const newPassBuffers: Record<string, any> = {};
    const createdPassBuffers: Record<string, any> = {};
    const newPassSlotAssignments: Record<string, SlotAssignment[]> = {};

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
        this.bufferManager.cleanupBuffers(createdPassBuffers);
        const pathInfo = pass.path ? ` (path: "${pass.path}")` : "";
        return {
          success: false,
          errors: [`${pass.name}: Buffer file not found or is empty${pathInfo}. Please check that the file exists and contains valid shader code.`],
        };
      }

      const slotAssignments = assignInputSlots(pass.inputs);
      newPassSlotAssignments[pass.name] = slotAssignments;
      const channelTypes = this.getChannelTypes(pass);

      const customDecl = this.customUniformManager?.getDeclarations() || undefined;
      const { headerLineCount: svelteHeaderLines, commonCodeLineCount } = this.shaderCompiler
        .wrapShaderToyCode(pass.shaderSrc, commonCode, slotAssignments, channelTypes, customDecl);
      const shader = await this.shaderCompiler.compileShaderAsync(pass.shaderSrc, commonCode, slotAssignments, channelTypes, customDecl);

      if (!shader || !shader.mResult) {
        this.cleanupPartialShaders(newPassShaders);
        this.bufferManager.cleanupBuffers(createdPassBuffers);

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

      if (pass.name !== "Image" && pass.name !== "common") {
        if (!pathChanged && oldPassBuffers[pass.name]) {
          newPassBuffers[pass.name] = oldPassBuffers[pass.name];
          delete oldPassBuffers[pass.name];
        } else {
          const createdBuffer = this.bufferManager
            .createPingPongBuffers(
              this.canvas.width || 800,
              this.canvas.height || 600,
            );
          newPassBuffers[pass.name] = createdBuffer;
          createdPassBuffers[pass.name] = createdBuffer;
        }
      }
    }

    return {
      success: true,
      passShaders: newPassShaders,
      passBuffers: newPassBuffers,
      passSlotAssignments: newPassSlotAssignments,
    };
  }

  private applyCompiledPipeline(
    path: string,
    nextPasses: Pass[],
    nextPassShaders: Record<string, PiShader>,
    nextPassBuffers: Record<string, any>,
    nextPassSlotAssignments: Record<string, SlotAssignment[]>,
    pathChanged: boolean,
  ): void {
    this.currentShaderRenderID++;

    if (pathChanged) {
      this.cleanup();
    } else {
      const oldPassShaders = this.passShaders;
      const oldPassBuffers = { ...this.bufferManager.getPassBuffers() };

      this.cleanupShaders(oldPassShaders);

      for (const name of Object.keys(nextPassBuffers)) {
        delete oldPassBuffers[name];
      }
      this.bufferManager.cleanupBuffers(oldPassBuffers);
    }

    this.shaderPath = path;
    this.passes = nextPasses;
    this.passShaders = nextPassShaders;
    this.passSlotAssignments = nextPassSlotAssignments;
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
    this.passSlotAssignments = {};
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
