/// <reference types="@webgpu/types" />
import type {
  CreateTextureDesc,
  ImageTextureOptions,
  TextureBackend,
  TextureFilter,
  TextureFormat,
  TextureWrap,
} from "../resources/TextureBackend";

export interface WebGPUTextureHandle {
  texture: GPUTexture;
  view: GPUTextureView;
  sampler: GPUSampler;
  width: number;
  height: number;
  /** Format the texture was created with; drives r8 expansion on updateTexture. */
  format: TextureFormat;
  /** Whether sampling should be vertically flipped (image textures; Task 9). */
  vflip: boolean;
}

/**
 * The backend contract says "r8" reads with the value replicated across rgb
 * (GL LUMINANCE). WebGPU's r8unorm samples as (r,0,0,1), so r8 content is
 * stored as rgba8unorm with r=g=b instead.
 */
export function expandR8ToRgba8(data: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const v = data[i];
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return out;
}

function mipLevelCountFor(width: number, height: number): number {
  return Math.floor(Math.log2(Math.max(width, height))) + 1;
}

export class WebGPUTextureBackend implements TextureBackend<WebGPUTextureHandle> {
  private mipPipeline: GPURenderPipeline | null = null;
  private mipSampler: GPUSampler | null = null;

  constructor(private readonly device: GPUDevice) {}

  createTexture(desc: CreateTextureDesc): WebGPUTextureHandle | null {
    if (desc.type === "cubemap") {
      throw new Error("Cubemap textures are not supported by the WebGPU engine yet");
    }
    const mip = desc.filter === "mipmap";
    const texture = this.device.createTexture({
      size: { width: desc.width, height: desc.height },
      format: "rgba8unorm",
      mipLevelCount: mip ? mipLevelCountFor(desc.width, desc.height) : 1,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST |
        (mip ? GPUTextureUsage.RENDER_ATTACHMENT : 0),
    });
    if (desc.data) {
      this.writeLevel0(texture, 0, 0, desc.width, desc.height, desc.format, desc.data);
    }
    const handle: WebGPUTextureHandle = {
      texture,
      view: texture.createView(),
      sampler: this.createSampler(desc.filter, desc.wrap),
      width: desc.width,
      height: desc.height,
      format: desc.format,
      vflip: false,
    };
    if (mip && desc.data) {
      this.createMipmaps(handle);
    }
    return handle;
  }

  updateTexture(tex: WebGPUTextureHandle, x: number, y: number, width: number, height: number, data: Uint8Array): void {
    // The handle remembers the format it was created with; r8 handles always
    // expand on write, regardless of the byte length of this particular update.
    this.writeLevel0(tex.texture, x, y, width, height, tex.format, data);
  }

  destroyTexture(tex: WebGPUTextureHandle | null): void {
    tex?.texture.destroy?.();
  }

  private writeLevel0(
    texture: GPUTexture,
    x: number,
    y: number,
    width: number,
    height: number,
    format: "rgba8" | "r8",
    data: Uint8Array,
  ): void {
    const rgba = format === "r8" ? expandR8ToRgba8(data, width, height) : data;
    // Full-texture writes pass { texture } bare; subregion writes carry origin.
    const destination = x === 0 && y === 0 ? { texture } : { texture, origin: { x, y } };
    this.device.queue.writeTexture(destination, rgba, { bytesPerRow: width * 4 }, { width, height });
  }

  private createSampler(filter: TextureFilter, wrap: TextureWrap): GPUSampler {
    const mode: GPUAddressMode = wrap === "clamp" ? "clamp-to-edge" : "repeat";
    const filterMode: GPUFilterMode = filter === "nearest" ? "nearest" : "linear";
    const desc: GPUSamplerDescriptor = {
      magFilter: filterMode,
      minFilter: filterMode,
      addressModeU: mode,
      addressModeV: mode,
    };
    if (filter === "mipmap") {
      desc.mipmapFilter = "linear";
    }
    return this.device.createSampler(desc);
  }

  // Task 9 fills these in:
  createTextureFromImage(
    _image: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement[],
    _opts: ImageTextureOptions,
  ): WebGPUTextureHandle | null {
    throw new Error("Not implemented yet (Task 9)");
  }

  createMipmaps(_tex: WebGPUTextureHandle): void {
    // filled in Task 9 (blit downsample chain); harmless no-op until then
  }

  updateTextureFromImage(_tex: WebGPUTextureHandle, _image: HTMLImageElement | HTMLVideoElement): void {
    throw new Error("Not implemented yet (Task 9)");
  }
}
