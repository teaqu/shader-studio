export type PassConfig = {
  name: string;
  shaderSrc: string;
  inputs: Record<string, any>;
  path?: string;
};

export class ResourceManager {
  private imageTextureCache: Record<string, any> = {};
  private passBuffers: Record<string, { front: any; back: any }> = {};
  private passShaders: Record<string, any> = {};
  private renderer: any = null;

  public getImageTextureCache(): Record<string, any> {
    return this.imageTextureCache;
  }

  public setImageTextureCache(cache: Record<string, any>): void {
    this.imageTextureCache = cache;
  }

  public getPassBuffers(): Record<string, { front: any; back: any }> {
    return this.passBuffers;
  }

  public setPassBuffers(
    buffers: Record<string, { front: any; back: any }>,
  ): void {
    this.passBuffers = buffers;
  }

  public getPassShaders(): Record<string, any> {
    return this.passShaders;
  }

  public setPassShaders(shaders: Record<string, any>): void {
    this.passShaders = shaders;
  }

  public setRenderer(renderer: any): void {
    this.renderer = renderer;
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
          } else if (this.renderer) {
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
      if (this.renderer) {
        this.renderer.DestroyTexture(this.imageTextureCache[key]);
      }
    }

    this.imageTextureCache = newImageTextureCache;
    return this.imageTextureCache;
  }

  public cleanup(renderManager: any): void {
    // Clean up shaders
    for (const key in this.passShaders) {
      renderManager.destroyShader(this.passShaders[key]);
    }

    // Clean up buffers
    for (const key in this.passBuffers) {
      renderManager.destroyRenderTarget(this.passBuffers[key].front);
      renderManager.destroyRenderTarget(this.passBuffers[key].back);
      renderManager.destroyTexture(this.passBuffers[key].front.mTex0);
      renderManager.destroyTexture(this.passBuffers[key].back.mTex0);
    }

    // Clean up image textures
    for (const key in this.imageTextureCache) {
      renderManager.destroyTexture(this.imageTextureCache[key]);
    }

    // Reset all collections
    this.passShaders = {};
    this.passBuffers = {};
    this.imageTextureCache = {};
  }
}
