import type { PiRenderer, PiTexture } from "../../types/piRenderer";

interface TextureLoadOptions {
  filter?: "linear" | "nearest" | "mipmap";
  wrap?: "repeat" | "clamp";
  vflip?: boolean;
}

export class TextureCache {
  private static readonly DEFAULT_TEXTURE_COLOR = new Uint8Array([0, 0, 0, 255]);
  
  private readonly imageTextureCache: Record<string, PiTexture> = {};
  private defaultTexture: PiTexture | null = null;

  constructor(private readonly renderer: PiRenderer) {
    this.initializeDefaultTexture();
  }

  public getImageTextureCache(): Record<string, PiTexture> {
    return this.imageTextureCache;
  }

  public getDefaultTexture(): PiTexture | null {
    return this.defaultTexture;
  }

  public async loadTextureFromUrl(
    url: string,
    options: TextureLoadOptions = {}
  ): Promise<PiTexture> {
    return new Promise((resolve, reject) => {
      const image = new window.Image();
      image.crossOrigin = "";
      
      image.onload = () => {
        try {
          const texture = this.createTextureFromImage(image, options);
          resolve(texture);
        } catch (error) {
          reject(error);
        }
      };
      
      image.onerror = () => {
        reject(new Error(`Failed to load image from URL: ${url}`));
      };
      
      image.src = url;
    });
  }

  public cacheTexture(path: string, texture: PiTexture): void {
    this.imageTextureCache[path] = texture;
  }

  public getCachedTexture(path: string): PiTexture | undefined {
    return this.imageTextureCache[path];
  }

  public removeCachedTexture(path: string): PiTexture | undefined {
    const texture = this.imageTextureCache[path];
    if (texture) {
      delete this.imageTextureCache[path];
    }
    return texture;
  }

  public cleanup(): void {
    this.cleanupImageTextures();
    this.cleanupDefaultTexture();
  }

  private initializeDefaultTexture(): void {
    this.defaultTexture = this.renderer.CreateTexture(
      this.renderer.TEXTYPE.T2D,
      1,
      1,
      this.renderer.TEXFMT.C4I8,
      this.renderer.FILTER.NONE,
      this.renderer.TEXWRP.CLAMP,
      TextureCache.DEFAULT_TEXTURE_COLOR,
    );
  }

  private createTextureFromImage(image: HTMLImageElement, options: TextureLoadOptions): PiTexture {
    const filter = this.getFilterFromOptions(options.filter);
    const wrap = this.getWrapFromOptions(options.wrap);
    const vflip = options.vflip ?? true;

    const texture = this.renderer.CreateTextureFromImage(
      this.renderer.TEXTYPE.T2D,
      image,
      this.renderer.TEXFMT.C4I8,
      filter,
      wrap,
      vflip,
    );

    if (!texture) {
      throw new Error("Failed to create texture from image");
    }

    return texture;
  }

  private getFilterFromOptions(filter?: string): any {
    switch (filter) {
      case "linear": return this.renderer.FILTER.LINEAR;
      case "nearest": return this.renderer.FILTER.NONE;
      case "mipmap": 
      default: return this.renderer.FILTER.MIPMAP;
    }
  }

  private getWrapFromOptions(wrap?: string): any {
    switch (wrap) {
      case "clamp": return this.renderer.TEXWRP.CLAMP;
      case "repeat":
      default: return this.renderer.TEXWRP.REPEAT;
    }
  }

  private cleanupImageTextures(): void {
    for (const key in this.imageTextureCache) {
      this.renderer.DestroyTexture(this.imageTextureCache[key]);
    }
    Object.keys(this.imageTextureCache).forEach(key => delete this.imageTextureCache[key]);
  }

  private cleanupDefaultTexture(): void {
    if (this.defaultTexture) {
      this.renderer.DestroyTexture(this.defaultTexture);
      this.defaultTexture = null;
    }
  }
}
