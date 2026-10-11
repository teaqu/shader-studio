/// <reference types="@webgpu/types" />
import type { CaptureCompileContext } from "../capture/VariableCapturer";
import { NativeRasterCaptureTarget } from "./NativeRasterCaptureTarget";

export class CaptureTargetLifecycle {
  private readonly pending = new Map<GPUTexture, NativeRasterCaptureTarget | undefined>();

  constructor(
    private readonly device: GPUDevice,
    private readonly onCreated: (count: number) => void,
    private readonly onDestroyed: (count: number) => void,
  ) {}

  create(raster: CaptureCompileContext["nativeRender"], gridWidth: number, gridHeight: number, output: number) {
    const native = raster
      ? new NativeRasterCaptureTarget(this.device, raster.width, raster.height, raster.geometry !== "fullscreen",
        raster.outputCount ?? 1, output, raster.writesDepth)
      : undefined;
    const texture = native?.texture ?? this.device.createTexture({
      label: "variable-capture target", size: { width: gridWidth, height: gridHeight }, format: "rgba32float",
      usage: (globalThis.GPUTextureUsage?.RENDER_ATTACHMENT ?? 0x10) | (globalThis.GPUTextureUsage?.COPY_SRC ?? 0x01),
    });
    this.onCreated(native ? native.textures.length + (native.depth ? 1 : 0) : 1);
    return { native, texture, view: native?.view ?? texture.createView() };
  }

  release(texture: GPUTexture, native: NativeRasterCaptureTarget | undefined, submitted: boolean): void {
    if (submitted) {
      this.destroyAfterSubmittedWork(texture, native);
      return;
    }
    this.destroy(texture, native);
  }

  dispose(): void {
    for (const texture of [...this.pending.keys()]) {
      this.destroyPending(texture);
    }
  }

  private destroyAfterSubmittedWork(texture: GPUTexture, native?: NativeRasterCaptureTarget): void {
    this.pending.set(texture, native);
    try {
      const submittedWork = this.device.queue.onSubmittedWorkDone?.();
      if (!submittedWork) {
        this.destroyPending(texture);
        return;
      }
      void submittedWork.then(() => this.destroyPending(texture), () => this.destroyPending(texture));
    } catch {
      this.destroyPending(texture);
    }
  }

  private destroy(texture: GPUTexture, native: NativeRasterCaptureTarget | undefined): void {
    if (native) {
      native.destroy();
      this.onDestroyed(native.textures.length + (native.depth ? 1 : 0));
      return;
    }
    texture.destroy?.();
    this.onDestroyed(1);
  }

  private destroyPending(texture: GPUTexture): void {
    if (!this.pending.has(texture)) {
      return;
    }
    const native = this.pending.get(texture);
    this.pending.delete(texture);
    this.destroy(texture, native);
  }
}
