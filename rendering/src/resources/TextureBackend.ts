export type TextureType = "2d" | "cubemap";
export type TextureFormat = "rgba8" | "r8";
export type TextureFilter = "linear" | "nearest" | "mipmap";
export type TextureWrap = "repeat" | "clamp";

export interface CreateTextureDesc {
  type: TextureType;
  width: number;
  height: number;
  /** "r8" = single channel; shaders see the value replicated across rgb (GL LUMINANCE semantics). */
  format: TextureFormat;
  /** "mipmap" implies the backend allocates and fills the full mip chain. */
  filter: TextureFilter;
  wrap: TextureWrap;
  data?: Uint8Array | null;
}

export interface ImageTextureOptions {
  type: TextureType;
  format: TextureFormat;
  filter: TextureFilter;
  wrap: TextureWrap;
  /** Semantics: produces the same visual output as the WebGL engine for the same config. */
  vflip: boolean;
}

export interface TextureBackend<T> {
  createTexture(desc: CreateTextureDesc): T | null;
  createTextureFromImage(
    image: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement[],
    opts: ImageTextureOptions,
  ): T | null;
  createMipmaps(tex: T): void;
  updateTexture(tex: T, x: number, y: number, width: number, height: number, data: Uint8Array): void;
  updateTextureFromImage(tex: T, image: HTMLImageElement | HTMLVideoElement): void;
  destroyTexture(tex: T | null): void;
}
