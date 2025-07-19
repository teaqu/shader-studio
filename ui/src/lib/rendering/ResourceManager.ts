import type { PassConfig, PassBuffers } from "../models";
import type { PiRenderer, PiTexture, PiRenderTarget, PiShader } from "../types/piRenderer";
import type { ShaderCompiler } from "./ShaderCompiler";

export class ResourceManager {
  private imageTextureCache: Record<string, PiTexture> = {};
  private passBuffers: PassBuffers = {};
  private passShaders: Record<string, PiShader> = {};
  private keyboardTexture: PiTexture | null = null;
  private keyboardBuffer = new Uint8Array(256 * 3);
  private defaultTexture: PiTexture | null = null;

  constructor(
    private renderer: PiRenderer,
    private shaderCompiler: ShaderCompiler
  ) {
    // Create default texture when renderer is provided
    this.defaultTexture = this.renderer.CreateTexture(
      this.renderer.TEXTYPE.T2D,
      1,
      1,
      this.renderer.TEXFMT.C4I8,
      this.renderer.FILTER.NONE,
      this.renderer.TEXWRP.CLAMP,
      new Uint8Array([0, 0, 0, 255]),
    );
  }

  public getImageTextureCache(): Record<string, any> {
    return this.imageTextureCache;
  }

  public getPassBuffers(): PassBuffers {
    return this.passBuffers;
  }

  public getPassShaders(): Record<string, PiShader> {
    return this.passShaders;
  }

  public setPassBuffers(
    buffers: PassBuffers,
  ): void {
    this.passBuffers = buffers;
  }

  public setPassShaders(shaders: Record<string, PiShader>): void {
    this.passShaders = shaders;
  }

  public createPingPongBuffers(width: number, height: number) {
    // In WebGL2, linear filtering on float textures is a standard feature.
    const filter = this.renderer.FILTER.LINEAR;

    const frontTex = this.renderer.CreateTexture(
      this.renderer.TEXTYPE.T2D,
      width,
      height,
      this.renderer.TEXFMT.C4F32,
      filter,
      this.renderer.TEXWRP.CLAMP,
      null,
    );
    const backTex = this.renderer.CreateTexture(
      this.renderer.TEXTYPE.T2D,
      width,
      height,
      this.renderer.TEXFMT.C4F32,
      filter,
      this.renderer.TEXWRP.CLAMP,
      null,
    );

    const frontRT = this.renderer.CreateRenderTarget(
      frontTex,
      null,
      null,
      null,
      null,
      false,
    );
    const backRT = this.renderer.CreateRenderTarget(
      backTex,
      null,
      null,
      null,
      null,
      false,
    );

    return { front: frontRT, back: backRT };
  }

  public resizePassBuffers(
    passes: PassConfig[],
    newWidth: number,
    newHeight: number,
  ): PassBuffers {
    if (!this.shaderCompiler) {
      throw new Error("ShaderCompiler not set");
    }

    const oldPassBuffers = this.passBuffers;
    const newPassBuffers: PassBuffers = {};

    const copyShader = this.shaderCompiler.createCopyShader();

    for (const pass of passes) {
      if (pass.name !== "Image") {
        // === 1. Create new buffers ===
        const newBuffers = this.createPingPongBuffers(newWidth, newHeight);

        if (oldPassBuffers[pass.name] && newBuffers.front?.mTex0 && newBuffers.back?.mTex0) {
          // --- 2. Copy from old to new ---
          const oldFront = oldPassBuffers[pass.name]?.front?.mTex0;
          const oldBack = oldPassBuffers[pass.name]?.back?.mTex0;

          if (oldFront && oldBack) {
            const minWidth = Math.min(
              oldFront.mXres,
              newBuffers.front.mTex0.mXres,
            );
            const minHeight = Math.min(
              oldFront.mYres,
              newBuffers.front.mTex0.mYres,
            );

            // Copy FRONT buffer
            this.copyTexture(
              oldFront,
              newBuffers.front,
              copyShader,
              minWidth,
              minHeight
            );

            // Copy BACK buffer
            this.copyTexture(
              oldBack,
              newBuffers.back,
              copyShader,
              minWidth,
              minHeight
            );
          }
        } else {
          // Clear new buffers for passes without existing data
          this.clearRenderTarget(
            newBuffers.front,
            copyShader,
            newWidth,
            newHeight
          );
          this.clearRenderTarget(
            newBuffers.back,
            copyShader,
            newWidth,
            newHeight
          );
        }
        newPassBuffers[pass.name] = newBuffers;
      }
    }

    if (copyShader) this.renderer.DestroyShader(copyShader);

    // === 4. Destroy old buffers/textures *after* copying is complete ===
    this.cleanupShadersAndBuffers({}, oldPassBuffers);

    this.passBuffers = newPassBuffers;
    return newPassBuffers;
  }

  public async loadTextureFromUrl(
    url: string,
    renderer: any,
    opts: { filter?: string; wrap?: string; vflip?: boolean } = {},
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const image = new window.Image();
      image.crossOrigin = "";
      image.onload = () => {
        let piFilter = renderer.FILTER.MIPMAP;
        if (opts.filter === "linear") piFilter = renderer.FILTER.LINEAR;
        if (opts.filter === "nearest") piFilter = renderer.FILTER.NONE;

        let piWrap = renderer.TEXWRP.REPEAT;
        if (opts.wrap === "clamp") piWrap = renderer.TEXWRP.CLAMP;

        const vflip = opts.vflip !== undefined ? opts.vflip : true;
        const texture = renderer.CreateTextureFromImage(
          renderer.TEXTYPE.T2D,
          image,
          renderer.TEXFMT.C4I8,
          piFilter,
          piWrap,
          vflip,
        );
        resolve(texture);
      };
      image.onerror = reject;
      image.src = url;
    });
  }

  public async loadImageTextures(
    passes: PassConfig[],
  ): Promise<Record<string, any>> {
    const newImageTextureCache: Record<string, any> = {};

    for (const pass of passes) {
      for (let i = 0; i < 4; i++) {
        const input = pass.inputs[`iChannel${i}`];
        if (input && input.type === "image" && input.path) {
          if (this.imageTextureCache[input.path]) {
            newImageTextureCache[input.path] =
              this.imageTextureCache[input.path];
            delete this.imageTextureCache[input.path];
          } else {
            newImageTextureCache[input.path] = await this.loadTextureFromUrl(
              input.path,
              this.renderer,
              input.opts,
            );
          }
        }
      }
    }

    // Clean up old unused textures
    for (const key in this.imageTextureCache) {
      this.renderer.DestroyTexture(this.imageTextureCache[key]);
    }

    this.imageTextureCache = newImageTextureCache;
    return this.imageTextureCache;
  }
  public updateKeyboardTexture(
    keyHeld: Uint8Array,
    keyPressed: Uint8Array,
    keyToggled: Uint8Array,
  ): void {
    this.keyboardBuffer.set(keyHeld, 0);
    this.keyboardBuffer.set(keyPressed, 256);
    this.keyboardBuffer.set(keyToggled, 512);
    
    if (!this.keyboardTexture) {
      this.keyboardTexture = this.renderer.CreateTexture(
        this.renderer.TEXTYPE.T2D,
        256,
        3,
        this.renderer.TEXFMT.C1I8,
        this.renderer.FILTER.NONE,
        this.renderer.TEXWRP.CLAMP,
        this.keyboardBuffer,
      );
    } else {
      // Update the entire texture
      this.renderer.UpdateTexture(
        this.keyboardTexture,
        0,
        0,
        256,
        3,
        this.keyboardBuffer,
      );
    }
  }

  public getKeyboardTexture(): PiTexture | null {
    return this.keyboardTexture;
  }

  public getDefaultTexture(): PiTexture | null {
    return this.defaultTexture;
  }

  public cleanup(): void {
    if (!this.renderer) return;

    // Clean up using the consolidated cleanup method
    this.cleanupShadersAndBuffers(this.passShaders, this.passBuffers);

    // Clean up image textures
    for (const key in this.imageTextureCache) {
      this.destroyTexture(this.imageTextureCache[key]);
    }

    // Clean up keyboard texture
    if (this.keyboardTexture) {
      this.destroyTexture(this.keyboardTexture);
      this.keyboardTexture = null;
    }

    // Clean up default texture
    if (this.defaultTexture) {
      this.destroyTexture(this.defaultTexture);
      this.defaultTexture = null;
    }

    // Reset all collections
    this.passShaders = {};
    this.passBuffers = {};
    this.imageTextureCache = {};
  }

  public destroyTexture(texture: PiTexture | null): void {
    if (texture) {
      this.renderer.DestroyTexture(texture);
    }
  }

  public destroyShader(shader: PiShader | null): void {
    if (shader) {
      this.renderer.DestroyShader(shader);
    }
  }

  public destroyRenderTarget(renderTarget: PiRenderTarget | null): void {
    if (renderTarget) {
      this.renderer.DestroyRenderTarget(renderTarget);
    }
  }

  public cleanupShadersAndBuffers(
    oldShaders: Record<string, PiShader | null>,
    oldBuffers: PassBuffers
  ): void {
    // Cleanup old shaders
    for (const key in oldShaders) {
      this.destroyShader(oldShaders[key]);
    }
    
    // Cleanup old buffers
    for (const key in oldBuffers) {
      const buffer = oldBuffers[key];
      if (buffer?.front) {
        this.destroyRenderTarget(buffer.front);
        if (buffer.front.mTex0) {
          this.destroyTexture(buffer.front.mTex0);
        }
      }
      if (buffer?.back) {
        this.destroyRenderTarget(buffer.back);
        if (buffer.back.mTex0) {
          this.destroyTexture(buffer.back.mTex0);
        }
      }
    }
  }

  /**
   * Copies a texture to a render target with specific viewport dimensions.
   */
  private copyTexture(
    sourceTexture: any,
    targetRenderTarget: any,
    copyShader: any,
    width: number,
    height: number
  ): void {
    if (!sourceTexture || !copyShader) return;

    this.renderer.SetRenderTarget(targetRenderTarget);
    this.renderer.SetViewport([0, 0, width, height]);
    this.renderer.AttachShader(copyShader);
    this.renderer.SetShaderTextureUnit("srcTex", 0);
    this.renderer.AttachTextures(1, sourceTexture, null, null, null);
    
    const posLoc = this.renderer.GetAttribLocation(copyShader, "position");
    this.renderer.DrawUnitQuad_XY(posLoc);
  }

  /**
   * Clears a render target by drawing a fullscreen quad with a copy shader (effectively clearing).
   */
  private clearRenderTarget(
    renderTarget: any,
    copyShader: any,
    width: number,
    height: number
  ): void {
    if (!copyShader) return;

    this.renderer.SetRenderTarget(renderTarget);
    this.renderer.SetViewport([0, 0, width, height]);
    this.renderer.AttachShader(copyShader);
    
    const posLoc = this.renderer.GetAttribLocation(copyShader, "position");
    this.renderer.DrawUnitQuad_XY(posLoc);
  }
}
