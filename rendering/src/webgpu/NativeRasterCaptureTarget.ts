/** Full-resolution raster attachments; readback samples retain authored pixel centers. */
export class NativeRasterCaptureTarget {
  readonly texture: GPUTexture;
  readonly view: GPUTextureView;
  readonly depth?: GPUTexture;

  constructor(device: GPUDevice, readonly width: number, readonly height: number, mesh: boolean) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new Error("Native raster capture dimensions must be positive integers.");
    }
    this.texture = device.createTexture({
      size: { width, height },
      format: "rgba32float",
      usage: (globalThis.GPUTextureUsage?.RENDER_ATTACHMENT ?? 0x10) | (globalThis.GPUTextureUsage?.COPY_SRC ?? 1),
    });
    this.view = this.texture.createView();
    if (mesh) {
      this.depth = device.createTexture({
        size: { width, height },
        format: "depth24plus",
        usage: globalThis.GPUTextureUsage?.RENDER_ATTACHMENT ?? 0x10,
      });
    }
  }

  attachments(): GPURenderPassDescriptor {
    return {
      colorAttachments: [{
        view: this.view,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: "clear", storeOp: "store",
      }],
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
    this.texture.destroy();
    this.depth?.destroy();
  }
}
