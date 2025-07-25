import type { ShaderCompiler } from "./ShaderCompiler";
import type { ResourceManager } from "./ResourceManager";
import { ShaderErrorFormatter } from "../util/ShaderErrorFormatter";
import type { Pass, Buffers, CompilationResult, ShaderConfig } from "../models";
import type { PiRenderer, PiShader } from "../types/piRenderer";
import type { BufferManager } from "./BufferManager";

export class ShaderPipeline {
  private canvas: HTMLCanvasElement;
  private shaderCompiler: ShaderCompiler;
  private resourceManager: ResourceManager;
  private renderer: PiRenderer;
  private bufferManager: BufferManager;
  private currentShaderRenderID = 0;
  private shaderName = "";
  private passes: Pass[] = [];
  private passShaders: Record<string, PiShader> = {};

  constructor(
    canvas: HTMLCanvasElement,
    shaderCompiler: ShaderCompiler,
    resourceManager: ResourceManager,
    renderer: PiRenderer,
    bufferManager: BufferManager,
  ) {
    this.canvas = canvas;
    this.shaderCompiler = shaderCompiler;
    this.resourceManager = resourceManager;
    this.renderer = renderer;
    this.bufferManager = bufferManager;
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

  public getShaderName(): string {
    return this.shaderName;
  }

  public async compileShaderPipeline(
    code: string,
    config: ShaderConfig | null,
    name: string,
    buffers: Record<string, string> = {},
  ): Promise<CompilationResult> {
    this.prepareNewCompilation(name);

    this.buildPasses(code, config, buffers);
    const compilation = await this.compileShaders();

    if (!compilation.success) {
      return compilation;
    }

    await this.updateResources();
    return { success: true };
  }

  private prepareNewCompilation(name: string): void {
    this.currentShaderRenderID++;

    if (this.shaderName !== name) {
      this.shaderName = name;
      this.cleanup();
    }
  }

  private buildPasses(
    code: string,
    config: ShaderConfig | null,
    buffers: Record<string, string>
  ): void {
    const usedConfig = config ?? {};
    const passNames = usedConfig
      ? Object.keys(usedConfig).filter((k) => k !== "version")
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

    this.passes = passNames.map(passName => {
      const pass = (usedConfig as any)[passName];
      const shaderSrc = buffers[passName] || (passName === "Image" ? code : "");

      return {
        name: passName,
        shaderSrc,
        inputs: pass.inputs ?? {},
        path: pass.path,
      };
    });
  }

  private async compileShaders(): Promise<CompilationResult> {
    // Keep track of old resources to clean up later
    const oldPassShaders = { ...this.passShaders };
    const oldPassBuffers = { ...this.bufferManager.getPassBuffers() };

    const newPassShaders: Record<string, PiShader> = {};
    const newPassBuffers: Record<string, any> = {};

    // Compile shaders
    for (const pass of this.passes) {
      const { headerLineCount: svelteHeaderLines } = this.shaderCompiler
        .wrapShaderToyCode(pass.shaderSrc);
      const shader = this.shaderCompiler.compileShader(pass.shaderSrc);

      if (!shader || !shader.mResult) {
        const err = shader ? ShaderErrorFormatter.formatShaderError(
          shader.mInfo,
          this.renderer,
          svelteHeaderLines,
        ) : "Failed to compile shader";

        // Clean up partially compiled shaders
        this.cleanupPartialShaders(newPassShaders);

        return {
          success: false,
          error: `${pass.name}: ${err}`,
        };
      }

      newPassShaders[pass.name] = shader;
      this.passShaders[pass.name] = shader;

      // Create buffers for non-Image passes
      if (pass.name !== "Image") {
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

    return { success: true };
  }

  private async updateResources(): Promise<void> {
    for (const pass of this.passes) {
      for (let i = 0; i < 4; i++) { // 4 channels (iChannel0-3)
        const input = pass.inputs[`iChannel${i}`];
        if (input?.type === "texture" && input.path) {
          const textureOptions = {
            filter: input.filter,
            wrap: input.wrap,
            vflip: input.vflip
          };
          await this.resourceManager.loadImageTexture(input.path, textureOptions);
        }
      }
    }
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
    this.currentShaderRenderID++;
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
