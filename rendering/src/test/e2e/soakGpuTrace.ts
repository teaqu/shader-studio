// Soak-branch diagnostics only (never merged): live GPU object counts and
// per-readback GPU latency, to tell a GPU-wide stall from leaked resources.

interface Live {
  textures: Map<GPUTexture, number>;
  buffers: Map<GPUBuffer, number>;
  createdTextures: number;
  createdBuffers: number;
}

const live: Live = { textures: new Map(), buffers: new Map(), createdTextures: 0, createdBuffers: 0 };
let installed = false;

function textureBytes(descriptor: GPUTextureDescriptor): number {
  const size = descriptor.size as GPUExtent3DDict | number[];
  const [w, h, d] = Array.isArray(size)
    ? [size[0] ?? 1, size[1] ?? 1, size[2] ?? 1]
    : [size.width, size.height ?? 1, size.depthOrArrayLayers ?? 1];
  const bpp = /32float|rgba32/.test(descriptor.format) ? 16 : /16float|rgba16/.test(descriptor.format) ? 8 : 4;
  return w * h * d * bpp * (descriptor.mipLevelCount ?? 1);
}

export function installGpuTrace(): void {
  if (installed || typeof GPUDevice === "undefined") return;
  installed = true;
  const createTexture = GPUDevice.prototype.createTexture;
  GPUDevice.prototype.createTexture = function (descriptor: GPUTextureDescriptor): GPUTexture {
    const texture = createTexture.call(this, descriptor);
    live.textures.set(texture, textureBytes(descriptor));
    live.createdTextures += 1;
    return texture;
  };
  const destroyTexture = GPUTexture.prototype.destroy;
  GPUTexture.prototype.destroy = function (): undefined {
    live.textures.delete(this);
    return destroyTexture.call(this);
  };
  const createBuffer = GPUDevice.prototype.createBuffer;
  GPUDevice.prototype.createBuffer = function (descriptor: GPUBufferDescriptor): GPUBuffer {
    const buffer = createBuffer.call(this, descriptor);
    live.buffers.set(buffer, descriptor.size);
    live.createdBuffers += 1;
    return buffer;
  };
  const destroyBuffer = GPUBuffer.prototype.destroy;
  GPUBuffer.prototype.destroy = function (): undefined {
    live.buffers.delete(this);
    return destroyBuffer.call(this);
  };
}

export function gpuLiveSummary(): string {
  const mb = (m: Map<unknown, number>): string => ([...m.values()].reduce((a, b) => a + b, 0) / 1048576).toFixed(1);
  return `liveTex=${live.textures.size}(${mb(live.textures)}MB) liveBuf=${live.buffers.size}(${mb(live.buffers)}MB) `
    + `createdTex=${live.createdTextures} createdBuf=${live.createdBuffers}`;
}

/** Resolves with ms until the queue drains, or -1 if it does not within `capMs`. */
export function timeQueueDrain(device: GPUDevice | null | undefined, capMs = 30_000): Promise<number> {
  if (!device) return Promise.resolve(-2);
  const start = performance.now();
  return Promise.race([
    device.queue.onSubmittedWorkDone().then(() => performance.now() - start),
    new Promise<number>((resolve) => setTimeout(() => resolve(-1), capMs)),
  ]);
}
