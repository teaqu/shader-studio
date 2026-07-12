import type { PiRenderer, PiTexture } from "../types/piRenderer";
import type {
  CreateTextureDesc,
  ImageTextureOptions,
  TextureBackend,
  TextureFilter,
  TextureFormat,
  TextureType,
  TextureWrap,
} from "../resources/TextureBackend";

export class WebGLTextureBackend implements TextureBackend<PiTexture> {
  constructor(private readonly renderer: PiRenderer) {}

  createTexture(desc: CreateTextureDesc): PiTexture | null {
    return this.renderer.CreateTexture(
      this.mapType(desc.type),
      desc.width,
      desc.height,
      this.mapFormat(desc.format),
      this.mapFilter(desc.filter),
      this.mapWrap(desc.wrap),
      desc.data ?? null,
    );
  }

  createTextureFromImage(
    image: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement[],
    opts: ImageTextureOptions,
  ): PiTexture | null {
    return this.renderer.CreateTextureFromImage(
      this.mapType(opts.type),
      image,
      this.mapFormat(opts.format),
      this.mapFilter(opts.filter),
      this.mapWrap(opts.wrap),
      opts.vflip,
    );
  }

  createMipmaps(tex: PiTexture): void {
    this.renderer.CreateMipmaps(tex);
  }

  updateTexture(tex: PiTexture, x: number, y: number, width: number, height: number, data: Uint8Array): void {
    this.renderer.UpdateTexture(tex, x, y, width, height, data);
  }

  updateTextureFromImage(tex: PiTexture, image: HTMLImageElement | HTMLVideoElement): void {
    this.renderer.UpdateTextureFromImage(tex, image);
  }

  destroyTexture(tex: PiTexture | null): void {
    this.renderer.DestroyTexture(tex);
  }

  private mapType(type: TextureType): number {
    return type === "cubemap" ? this.renderer.TEXTYPE.CUBEMAP : this.renderer.TEXTYPE.T2D;
  }

  private mapFormat(format: TextureFormat): number {
    return format === "r8" ? this.renderer.TEXFMT.C1I8 : this.renderer.TEXFMT.C4I8;
  }

  private mapFilter(filter: TextureFilter): number {
    switch (filter) {
      case "linear": return this.renderer.FILTER.LINEAR;
      case "nearest": return this.renderer.FILTER.NONE;
      case "mipmap": return this.renderer.FILTER.MIPMAP;
    }
  }

  private mapWrap(wrap: TextureWrap): number {
    return wrap === "clamp" ? this.renderer.TEXWRP.CLAMP : this.renderer.TEXWRP.REPEAT;
  }
}
