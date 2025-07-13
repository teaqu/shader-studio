import type { PassConfig } from "./ResourceManager";
import type { WebGLRenderer } from "./WebGLRenderer";
import type { ShaderCompiler } from "./ShaderCompiler";
import type { ResourceManager } from "./ResourceManager";
import { ShaderErrorFormatter } from "../util/ShaderErrorFormatter";

/**
 * Manages the shader pipeline: pass compilation, resource allocation, and state management.
 * This class knows about the structure of multi-pass shaders but doesn't handle rendering.
 */
export class ShaderPipeline {
  private passes: PassConfig[] = [];
  private passShaders: Record<string, any> = {};
  private passBuffers: Record<string, { front: any; back: any }> = {};
  private webglRenderer: WebGLRenderer;
  private shaderCompiler: ShaderCompiler;
  private resourceManager: ResourceManager;
  private currentShaderRenderID = 0;
  private shaderName = "";

  constructor(
    webglRenderer: WebGLRenderer,
    shaderCompiler: ShaderCompiler,
    resourceManager: ResourceManager,
  ) {
    this.webglRenderer = webglRenderer;
    this.shaderCompiler = shaderCompiler;
    this.resourceManager = resourceManager;
  }

  public getPasses(): PassConfig[] {
    return this.passes;
  }

  public getPassShaders(): Record<string, any> {
    return this.passShaders;
  }

  public getPassBuffers(): Record<string, { front: any; back: any }> {
    return this.passBuffers;
  }

  public setPassBuffers(
    buffers: Record<string, { front: any; back: any }>,
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
        this.webglRenderer.getRenderer(),
        pass.shaderSrc,
      );
      
      if (!shader.mResult) {
        const err = ShaderErrorFormatter.formatShaderError(
          shader.mInfo,
          this.webglRenderer.getRenderer(),
          svelteHeaderLines,
        );
        
        // Clean up partially compiled shaders
        for (const key in newPassShaders) {
          this.webglRenderer.destroyShader(newPassShaders[key]);
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
              this.webglRenderer.getCanvas()?.width || 800,
              this.webglRenderer.getCanvas()?.height || 600,
            );
        }
      }
    }

    // Update state
    this.passes = newPasses;
    this.passShaders = newPassShaders;
    this.passBuffers = newPassBuffers;

    // Cleanup old resources
    for (const key in oldPassShaders) {
      this.webglRenderer.destroyShader(oldPassShaders[key]);
    }
    for (const key in oldPassBuffers) {
      this.webglRenderer.destroyRenderTarget(oldPassBuffers[key].front);
      this.webglRenderer.destroyRenderTarget(oldPassBuffers[key].back);
      this.webglRenderer.destroyTexture(oldPassBuffers[key].front.mTex0);
      this.webglRenderer.destroyTexture(oldPassBuffers[key].back.mTex0);
    }

    // Load image textures
    await this.resourceManager.loadImageTextures(this.passes);

    return { success: true };
  }

  public cleanup(): void {
    this.resourceManager.cleanup(this.webglRenderer);
    this.currentShaderRenderID++;

    this.passes = [];
    this.passShaders = {};
    this.passBuffers = {};
  }
}
