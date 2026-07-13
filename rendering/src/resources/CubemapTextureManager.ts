import type { TextureBackend, TextureFilter, TextureWrap } from "./TextureBackend";
import type { CubemapConfigInput } from "../models/ShaderConfig";

/**
 * T-cross layout for cubemap faces:
 *        [+Y]
 * [-X]   [+Z]   [+X]   [-Z]
 *        [-Y]
 *
 * Face positions (col, row) in a 4x3 grid:
 * +X = (2,1), -X = (0,1), +Y = (1,0), -Y = (1,2), +Z = (1,1), -Z = (3,1)
 */
const FACE_POSITIONS: [number, number][] = [
  [2, 1], // +X (GL_TEXTURE_CUBE_MAP_POSITIVE_X)
  [0, 1], // -X (GL_TEXTURE_CUBE_MAP_NEGATIVE_X)
  [1, 0], // +Y (GL_TEXTURE_CUBE_MAP_POSITIVE_Y)
  [1, 2], // -Y (GL_TEXTURE_CUBE_MAP_NEGATIVE_Y)
  [1, 1], // +Z (GL_TEXTURE_CUBE_MAP_POSITIVE_Z)
  [3, 1], // -Z (GL_TEXTURE_CUBE_MAP_NEGATIVE_Z)
];

export class CubemapTextureManager<T> {
  private readonly cubemapCache: Record<string, T> = {};

  constructor(private readonly backend: TextureBackend<T>) {}

  public getCubemapTexture(path: string): T | null {
    return this.cubemapCache[path] ?? null;
  }

  public async loadCubemapFromCrossImage(
    url: string,
    options: Partial<Pick<CubemapConfigInput, 'filter' | 'wrap' | 'vflip'>> = {}
  ): Promise<T> {
    // Return cached if already loaded
    if (this.cubemapCache[url]) {
      return this.cubemapCache[url];
    }

    const image = await this.loadImage(url);
    const faces = this.extractCrossLayoutFaces(image);

    const filter = this.getFilterFromOptions(options.filter);
    const wrap = this.getWrapFromOptions(options.wrap);
    const vflip = options.vflip ?? false;

    const texture = this.backend.createTextureFromImage(faces, {
      type: "cubemap",
      format: "rgba8",
      filter,
      wrap,
      vflip,
    });

    if (!texture) {
      throw new Error(`Failed to create cubemap texture from ${url}`);
    }

    this.cubemapCache[url] = texture;
    return texture;
  }

  public extractCrossLayoutFaces(image: HTMLImageElement | HTMLCanvasElement): HTMLCanvasElement[] {
    const imageWidth = "naturalWidth" in image && image.naturalWidth ? image.naturalWidth : image.width;
    const faceSize = Math.floor(imageWidth / 4);
    const faces: HTMLCanvasElement[] = [];

    for (const [col, row] of FACE_POSITIONS) {
      const canvas = document.createElement("canvas");
      canvas.width = faceSize;
      canvas.height = faceSize;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(
        image,
        col * faceSize, row * faceSize,
        faceSize, faceSize,
        0, 0,
        faceSize, faceSize,
      );
      faces.push(canvas);
    }

    return faces;
  }

  public cleanup(): void {
    for (const key in this.cubemapCache) {
      this.backend.destroyTexture(this.cubemapCache[key]);
      delete this.cubemapCache[key];
    }
  }

  private loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Failed to load cubemap image: ${url}`));
      image.src = url;
    });
  }

  private getFilterFromOptions(filter?: string): TextureFilter {
    switch (filter) {
      case "linear": return "linear";
      case "nearest": return "nearest";
      case "mipmap":
      default: return "mipmap";
    }
  }

  private getWrapFromOptions(wrap?: string): TextureWrap {
    switch (wrap) {
      case "repeat": return "repeat";
      case "clamp":
      default: return "clamp";
    }
  }
}
