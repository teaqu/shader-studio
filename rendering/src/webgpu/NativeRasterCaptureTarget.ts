/** Full-resolution raster attachments; readback samples retain authored pixel centers. */
function validateOutput(outputCount: number, readbackOutput: number): void {
  if (!Number.isInteger(outputCount) || outputCount < 1) {
    throw new Error("Native raster capture output count must be a positive integer.");
  }
  if (!Number.isInteger(readbackOutput) || readbackOutput < 0 || readbackOutput >= outputCount) {
    throw new Error("Native raster capture output must select an allocated attachment.");
  }
}

export class NativeRasterCaptureTarget {
  readonly textures: GPUTexture[];
  readonly views: GPUTextureView[];
  /** Selected debug output attachment used for capture readback. */
  readonly texture: GPUTexture;
  readonly view: GPUTextureView;
  readonly depth?: GPUTexture;
  private readonly outputCount: number;
  private readonly readbackOutput: number;

  constructor(
    device: GPUDevice, readonly width: number, readonly height: number, mesh: boolean,
    outputCount = 1, readbackOutput = 0, writesDepth = false,
  ) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new Error("Native raster capture dimensions must be positive integers.");
    }
    validateOutput(outputCount, readbackOutput);
    this.outputCount = outputCount;
    this.readbackOutput = readbackOutput;
    let color: GPUTexture | undefined;
    let depth: GPUTexture | undefined;
    try {
      color = device.createTexture({
        size: { width, height }, format: "rgba32float",
        usage: (globalThis.GPUTextureUsage?.RENDER_ATTACHMENT ?? 0x10) | (globalThis.GPUTextureUsage?.COPY_SRC ?? 1),
      });
      const view = color.createView();
      if (mesh || writesDepth) {
        depth = device.createTexture({
          size: { width, height },
          format: "depth24plus",
          usage: globalThis.GPUTextureUsage?.RENDER_ATTACHMENT ?? 0x10,
        });
      }
      this.textures = [color];
      this.views = [view];
      this.texture = color;
      this.view = view;
      this.depth = depth;
    } catch (error) {
      depth?.destroy();
      color?.destroy();
      throw error;
    }
  }

  attachments(): GPURenderPassDescriptor {
    return {
      colorAttachments: Array.from({ length: this.outputCount }, (_, output) => output === this.readbackOutput ? {
        view: this.view,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: "clear", storeOp: "store",
      } : null),
      ...(this.depth ? { depthStencilAttachment: {
        view: this.depth.createView(),
        depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store",
      } } : {}),
    };
  }

  copy(encoder: GPUCommandEncoder, buffer: GPUBuffer, gridW: number, gridH: number,
    bytesPerRow: number, x: number, y: number, pixel: boolean): void {
    for (let row = 0; row < gridH; row++) {
      for (let col = 0; col < gridW; col++) {
        const sx = Math.min(this.width - 1, Math.max(0, pixel ? x : Math.floor((col + .5) * this.width / gridW)));
        const sy = Math.min(this.height - 1, Math.max(0, pixel ? y : Math.floor((row + .5) * this.height / gridH)));
        encoder.copyTextureToBuffer(
          { texture: this.texture, origin: { x: sx, y: sy } },
          { buffer, offset: row * bytesPerRow + col * 16, bytesPerRow, rowsPerImage: 1 },
          { width: 1, height: 1 },
        );
      }
    }
  }

  destroy(): void {
    for (const texture of this.textures) {
      texture.destroy();
    }
    this.depth?.destroy();
  }
}
