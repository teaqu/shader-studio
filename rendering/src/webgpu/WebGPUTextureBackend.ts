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

/** Returns a copy of `rgba` with its pixel rows in reverse order. */
export function reverseRows(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(rgba.length);
  const rowBytes = width * 4;
  for (let y = 0; y < height; y++) {
    out.set(rgba.subarray(y * rowBytes, (y + 1) * rowBytes), (height - 1 - y) * rowBytes);
  }
  return out;
}

/**
 * GOVERNING INVARIANT: the Slang prelude's sampleIChannelN helper flips v
 * (it samples at float2(uv.x, 1.0 - uv.y)) so GPU-rendered buffer textures
 * (row 0 = top) sample like GL framebuffers (row 0 = bottom). Because every
 * channel is read through that helper, WebGPU texture storage must be the
 * VERTICAL MIRROR of what GL stores — for ALL channel content: image
 * uploads (uploadImage inverts vflip) and CPU data writes (writeLevel0
 * reverses row order and mirrors the subregion origin).
 */
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
    try {
      if (desc.data) {
        this.writeLevel0(texture, desc.height, 0, 0, desc.width, desc.height, desc.format, desc.data);
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
    } catch (error) {
      texture.destroy?.();
      throw error;
    }
  }

  updateTexture(tex: WebGPUTextureHandle, x: number, y: number, width: number, height: number, data: Uint8Array): void {
    // The handle remembers the format it was created with; r8 handles always
    // expand on write, regardless of the byte length of this particular update.
    this.writeLevel0(tex.texture, tex.height, x, y, width, height, tex.format, data);
  }

  destroyTexture(tex: WebGPUTextureHandle | null): void {
    tex?.texture.destroy?.();
  }

  private writeLevel0(
    texture: GPUTexture,
    textureHeight: number,
    x: number,
    y: number,
    width: number,
    height: number,
    format: "rgba8" | "r8",
    data: Uint8Array,
  ): void {
    const rgba = reverseRows(format === "r8" ? expandR8ToRgba8(data, width, height) : data, width, height);
    const mirroredY = textureHeight - y - height;
    // Full-texture writes pass { texture } bare; subregion writes carry origin.
    const destination = x === 0 && mirroredY === 0 ? { texture } : { texture, origin: { x, y: mirroredY } };
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

  createTextureFromImage(
    image: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement[],
    opts: ImageTextureOptions,
  ): WebGPUTextureHandle | null {
    if (opts.type === "cubemap" || Array.isArray(image)) {
      return this.createCubemapTextureFromFaces(image, opts);
    }
    const width = "naturalWidth" in image ? image.naturalWidth || image.width : image.videoWidth;
    const height = "naturalHeight" in image ? image.naturalHeight || image.height : image.videoHeight;
    const mip = opts.filter === "mipmap";
    const texture = this.device.createTexture({
      size: { width, height },
      format: "rgba8unorm",
      mipLevelCount: mip ? mipLevelCountFor(width, height) : 1,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const handle: WebGPUTextureHandle = {
      texture,
      view: texture.createView(),
      sampler: this.createSampler(opts.filter, opts.wrap),
      width,
      height,
      format: opts.format,
      vflip: opts.vflip,
    };
    this.uploadImage(handle, image, opts.format);
    if (mip) {
      this.createMipmaps(handle);
    }
    return handle;
  }

  private createCubemapTextureFromFaces(
    image: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement[],
    opts: ImageTextureOptions,
  ): WebGPUTextureHandle | null {
    if (!Array.isArray(image) || image.length !== 6) {
      throw new Error("Cubemap textures require exactly 6 faces");
    }
    const width = image[0].width;
    const height = image[0].height;
    if (!width || !height || image.some((face) => face.width !== width || face.height !== height)) {
      throw new Error("Cubemap faces must have matching non-zero dimensions");
    }

    const texture = this.device.createTexture({
      size: { width, height, depthOrArrayLayers: 6 },
      dimension: "2d",
      format: "rgba8unorm",
      mipLevelCount: 1,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const handle: WebGPUTextureHandle = {
      texture,
      view: texture.createView({ dimension: "cube" }),
      sampler: this.createSampler(opts.filter, opts.wrap),
      width,
      height,
      format: opts.format,
      vflip: opts.vflip,
    };

    for (let face = 0; face < image.length; face++) {
      this.device.queue.copyExternalImageToTexture(
        { source: image[face], flipY: opts.vflip },
        { texture, origin: { x: 0, y: 0, z: face } },
        { width, height, depthOrArrayLayers: 1 },
      );
    }

    return handle;
  }

  updateTextureFromImage(tex: WebGPUTextureHandle, image: HTMLImageElement | HTMLVideoElement): void {
    this.uploadImage(tex, image, "rgba8");
  }

  private uploadImage(handle: WebGPUTextureHandle, image: HTMLImageElement | HTMLVideoElement, format: "rgba8" | "r8"): void {
    // copyExternalImageToTexture rejects HTMLImageElement; route through a 2d canvas.
    const canvas = document.createElement("canvas");
    canvas.width = handle.width;
    canvas.height = handle.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to create 2d canvas for texture upload");
    }
    ctx.drawImage(image as CanvasImageSource, 0, 0, handle.width, handle.height);
    if (format === "r8") {
      const pixels = ctx.getImageData(0, 0, handle.width, handle.height).data;
      this.device.queue.writeTexture(
        { texture: handle.texture },
        imageToGrayscaleRgba8(pixels, handle.width, handle.height, !handle.vflip),
        { bytesPerRow: handle.width * 4 },
        { width: handle.width, height: handle.height },
      );
      return;
    }
    this.device.queue.copyExternalImageToTexture(
      { source: canvas, flipY: !handle.vflip },
      { texture: handle.texture },
      { width: handle.width, height: handle.height },
    );
  }

  private static readonly MIP_BLIT_WGSL = /* wgsl */ `
struct VSOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
  var verts = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: VSOut;
  out.pos = vec4f(verts[i], 0.0, 1.0);
  out.uv = verts[i] * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
  return out;
}
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;
@fragment fn fs(in: VSOut) -> @location(0) vec4f {
  return textureSample(src, srcSampler, in.uv);
}
`;

  createMipmaps(tex: WebGPUTextureHandle): void {
    const levels = mipLevelCountFor(tex.width, tex.height);
    if (levels <= 1) {
      return;
    }
    if (!this.mipPipeline) {
      const module = this.device.createShaderModule({ code: WebGPUTextureBackend.MIP_BLIT_WGSL });
      this.mipPipeline = this.device.createRenderPipeline({
        layout: "auto",
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint: "fs", targets: [{ format: "rgba8unorm" }] },
        primitive: { topology: "triangle-list" },
      });
      this.mipSampler = this.device.createSampler({ magFilter: "linear", minFilter: "linear" });
    }
    const encoder = this.device.createCommandEncoder();
    for (let level = 1; level < levels; level++) {
      const srcView = tex.texture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 });
      const dstView = tex.texture.createView({ baseMipLevel: level, mipLevelCount: 1 });
      const bindGroup = this.device.createBindGroup({
        layout: this.mipPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: srcView },
          { binding: 1, resource: this.mipSampler! },
        ],
      });
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: dstView, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      });
      pass.setPipeline(this.mipPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
    }
    this.device.queue.submit([encoder.finish()]);
  }
}

export function imageToGrayscaleRgba8(pixels: Uint8ClampedArray, width: number, height: number, flipY: boolean): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcRow = flipY ? height - 1 - y : y;
    for (let x = 0; x < width; x++) {
      const v = pixels[(srcRow * width + x) * 4]; // GL's RGBA->LUMINANCE conversion takes red
      const o = (y * width + x) * 4;
      out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = 255;
    }
  }
  return out;
}
