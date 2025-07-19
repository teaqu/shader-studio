import type { ShaderCompiler } from "./ShaderCompiler";
import type { ResourceManager } from "./ResourceManager";
import { ShaderErrorFormatter } from "../util/ShaderErrorFormatter";
import type { PassConfig, PassBuffers } from "../models";
import type { PiRenderer } from "../types/piRenderer";

/**
 * Manages the shader pipeline: pass compilation, resource allocation, and state management.
 * This class knows about the structure of multi-pass shaders but doesn't handle rendering.
 */
export class ShaderPipeline {
  private passes: PassConfig[] = [];
  private passShaders: Record<string, any> = {};
  private passBuffers: PassBuffers = {};
  private canvas: HTMLCanvasElement;
  private shaderCompiler: ShaderCompiler;
  private resourceManager: ResourceManager;
  private renderer: PiRenderer;
  private currentShaderRenderID = 0;
  private shaderName = "";

  constructor(
    canvas: HTMLCanvasElement,
    shaderCompiler: ShaderCompiler,
    resourceManager: ResourceManager,
    renderer: PiRenderer,
  ) {
    this.canvas = canvas;
    this.shaderCompiler = shaderCompiler;
    this.resourceManager = resourceManager;
    this.renderer = renderer;
  }

  public getPasses(): PassConfig[] {
    return this.passes;
  }

  public getPassShaders(): Record<string, any> {
    return this.passShaders;
  }

  public getPassBuffers(): PassBuffers {
    return this.passBuffers;
  }

  public setPassBuffers(
    buffers: PassBuffers,
  ): void {
    this.passBuffers = buffers;
  }

  public getCurrentShaderRenderID(): number {
    return this.currentShaderRenderID;
  }

  public getShaderName(): string {
    return this.shaderName;
  }

  /**
   * Compile and setup a new shader pipeline from source code and configuration.
   */
  public async compileShaderPipeline(
    code: string,
    config: any,
    name: string,
    buffers: Record<string, string> = {},
  ): Promise<{
    success: boolean;
    error?: string;
  }> {
    this.currentShaderRenderID++;

    if (this.shaderName !== name) {
      this.shaderName = name;
      this.cleanup();
    }

    // Keep track of old resources to clean up later
    const oldPassShaders = { ...this.passShaders };
    const oldPassBuffers = { ...this.passBuffers };

    // Prepare for the new state
    let newPasses: PassConfig[] = [];
    let newPassShaders: Record<string, any> = {};
    let newPassBuffers: Record<string, any> = {};

    const usedConfig = config ?? {};
    const passNames = usedConfig
      ? Object.keys(usedConfig).filter((k) => k !== "version")
      : [];

    // Build pass configurations
    if (passNames.length === 0) {
      newPasses.push({
        name: "Image",
        shaderSrc: code,
        inputs: {},
        path: undefined,
      });
    } else {
      for (const passName of passNames) {
        const pass = usedConfig[passName];
        const shaderSrc = buffers[passName] ||
          (passName === "Image" ? code : "");

        newPasses.push({
          name: passName,
          shaderSrc,
          inputs: pass.inputs ?? {},
          path: pass.path,
        });
      }
    }

    // Compile shaders
    for (const pass of newPasses) {
      const { headerLineCount: svelteHeaderLines } = this.shaderCompiler
        .wrapShaderToyCode(pass.shaderSrc);
      const shader = this.shaderCompiler.compileShader(
        pass.shaderSrc,
      );
      
      if (!shader || !shader.mResult) {
        const err = shader ? ShaderErrorFormatter.formatShaderError(
          shader.mInfo,
          this.renderer,
          svelteHeaderLines,
        ) : "Failed to compile shader";
        
        // Clean up partially compiled shaders
        for (const key in newPassShaders) {
          this.renderer.DestroyShader(newPassShaders[key]);
        }
        
        return {
          success: false,
          error: `${pass.name}: ${err}`,
        };
      }
      
      newPassShaders[pass.name] = shader;

      // Create buffers for non-Image passes
      if (pass.name !== "Image") {
        if (oldPassBuffers[pass.name]) {
          newPassBuffers[pass.name] = oldPassBuffers[pass.name];
          delete oldPassBuffers[pass.name];
        } else {
          newPassBuffers[pass.name] = this.resourceManager
            .createPingPongBuffers(
              this.canvas.width || 800,
              this.canvas.height || 600,
            );
        }
      }
    }

    // Update state
    this.passes = newPasses;
    this.passShaders = newPassShaders;
    this.passBuffers = newPassBuffers;

    // Cleanup old resources
    this.resourceManager.cleanupShadersAndBuffers(oldPassShaders, oldPassBuffers);

    // Load image textures
    await this.resourceManager.loadImageTextures(this.passes);

    return { success: true };
  }

  public cleanup(): void {
    this.resourceManager.cleanup();
    this.currentShaderRenderID++;

    this.passes = [];
    this.passShaders = {};
    this.passBuffers = {};
  }
}
