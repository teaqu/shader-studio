import { volumeRgba, type VolumeTextureData } from "@shader-studio/types";
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
  constructor(private readonly renderer: PiRenderer, private readonly gl?: WebGL2RenderingContext) {}

  createVolumeTexture(volume: VolumeTextureData, filter: "linear" | "nearest", wrap: TextureWrap): PiTexture | null {
    const gl = this.gl;
    if (!gl) {
      throw new Error("Volume textures require a WebGL 2 context");
    }
    const limit = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE) as number;
    if ([volume.width, volume.height, volume.depth].some(size => size > limit)) {
      throw new Error(`Volume exceeds MAX_3D_TEXTURE_SIZE (${limit})`);
    }
    const texture = gl.createTexture();
    if (!texture) {
      return null;
    }
    const previous = gl.getParameter(gl.TEXTURE_BINDING_3D) as WebGLTexture | null;
    const alignment = gl.getParameter(gl.UNPACK_ALIGNMENT) as number;
    const flip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL) as boolean;
    try {
      gl.bindTexture(gl.TEXTURE_3D, texture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, volume.width, volume.height, volume.depth, 0, gl.RGBA, gl.UNSIGNED_BYTE, volumeRgba(volume));
      const address = wrap === "clamp" ? gl.CLAMP_TO_EDGE : gl.REPEAT;
      for (const axis of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) {
        gl.texParameteri(gl.TEXTURE_3D, axis, address);
      }
      const mode = filter === "nearest" ? gl.NEAREST : gl.LINEAR;
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, mode);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, mode);
      const error = gl.getError();
      if (error !== gl.NO_ERROR) {
        throw new Error(`3D texture upload failed (WebGL error ${error})`);
      }
      return { mObjectID: texture, mXres: volume.width, mYres: volume.height, mZres: volume.depth,
        mType: this.renderer.TEXTYPE.T3D, mFormat: this.renderer.TEXFMT.C4I8,
        mFilter: this.mapFilter(filter), mWrap: this.mapWrap(wrap), mVFlip: false };
    } catch (error) {
      gl.deleteTexture(texture);
      throw error;
    } finally {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, alignment);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, Number(flip));
      gl.bindTexture(gl.TEXTURE_3D, previous);
    }
  }

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
    const texture = this.renderer.CreateTextureFromImage(
      this.mapType(opts.type),
      image,
      this.mapFormat(opts.format),
      this.mapFilter(opts.filter),
      this.mapWrap(opts.wrap),
      opts.vflip,
    );
    // piRenderer uploads face arrays correctly but reads array.width/height.
    // Normalize its metadata at the backend boundary to the uploaded face size.
    if (texture && opts.type === "cubemap" && Array.isArray(image) && image[0]) {
      texture.mXres = image[0].width;
      texture.mYres = image[0].height;
    }
    if (texture && "videoWidth" in image) {
      this.updateVideoDimensions(texture, image);
    }
    return texture;
  }

  createMipmaps(tex: PiTexture): void {
    this.renderer.CreateMipmaps(tex);
  }

  updateTexture(tex: PiTexture, x: number, y: number, width: number, height: number, data: Uint8Array): void {
    this.renderer.UpdateTexture(tex, x, y, width, height, data);
  }

  updateTextureFromImage(tex: PiTexture, image: HTMLImageElement | HTMLVideoElement): void {
    this.renderer.UpdateTextureFromImage(tex, image);
    if ("videoWidth" in image) {
      this.updateVideoDimensions(tex, image);
    }
  }

  destroyTexture(tex: PiTexture | null): void {
    this.renderer.DestroyTexture(tex);
  }

  private updateVideoDimensions(tex: PiTexture, video: HTMLVideoElement): void {
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      tex.mXres = video.videoWidth;
      tex.mYres = video.videoHeight;
    }
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
