import type { TextureBackend } from "./TextureBackend";
import type { TextureConfigInput } from "../models/ShaderConfig";

export class TextureCache<T> {
  private static readonly DEFAULT_TEXTURE_COLOR = new Uint8Array([0, 0, 0, 255]);

  private readonly imageTextureCache: Record<string, T> = {};
  private defaultTexture: T | null = null;

  constructor(private readonly backend: TextureBackend<T>) {
    this.initializeDefaultTexture();
  }

  public getImageTextureCache(): Record<string, T> {
    return this.imageTextureCache;
  }

  public getDefaultTexture(): T | null {
    return this.defaultTexture;
  }

  public async loadTextureFromUrl(
    url: string,
    options: Partial<Pick<TextureConfigInput, 'filter' | 'wrap' | 'vflip' | 'grayscale'>> = {}
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const image = new Image();
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

  public cacheTexture(path: string, texture: T): void {
    this.imageTextureCache[path] = texture;
  }

  public removeCachedTexture(path: string): T | undefined {
    const texture = this.imageTextureCache[path];
    if (texture) {
      delete this.imageTextureCache[path];
    }
    return texture;
  }

  public cleanup(): void {
    this.cleanupImageTextures();
    // Don't destroy the default texture during cleanup - it's a 1x1 black pixel
    // that should persist across recompilations. Only destroy on full dispose.
  }

  public dispose(): void {
    this.cleanupImageTextures();
    if (this.defaultTexture) {
      this.backend.destroyTexture(this.defaultTexture);
      this.defaultTexture = null;
    }
  }

  private initializeDefaultTexture(): void {
    this.defaultTexture = this.backend.createTexture({
      type: "2d",
      width: 1,
      height: 1,
      format: "rgba8",
      filter: "nearest",
      wrap: "clamp",
      data: TextureCache.DEFAULT_TEXTURE_COLOR,
    });
  }

  private createTextureFromImage(
    image: HTMLImageElement,
    options: Partial<Pick<TextureConfigInput, 'filter' | 'wrap' | 'vflip' | 'grayscale'>>,
  ): T {
    const texture = this.backend.createTextureFromImage(image, {
      type: "2d",
      format: options.grayscale ? "r8" : "rgba8",
      filter: options.filter ?? "mipmap",
      wrap: options.wrap ?? "repeat",
      vflip: options.vflip ?? true,
    });

    if (!texture) {
      throw new Error("Failed to create texture from image");
    }

    return texture;
  }

  private cleanupImageTextures(): void {
    for (const key in this.imageTextureCache) {
      const texture = this.imageTextureCache[key];
      if (texture !== this.defaultTexture) {
        this.backend.destroyTexture(texture);
      }
    }
    Object.keys(this.imageTextureCache).forEach(key => delete this.imageTextureCache[key]);
  }
}
