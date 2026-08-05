/// <reference types="@webgpu/types" />
import { getPixelRegionGeometry } from "../capture/PixelRegionGeometry";
import {
  PIXEL_INSPECTOR_REGION_SIZE,
  type PixelRegionRequest,
  type PixelRegionResult,
} from "../types/PixelRegion";

const RGBA_CHANNELS = 4;
const ALIGNED_ROW_BYTES = 256;
const BUFFER_SIZE = ALIGNED_ROW_BYTES * PIXEL_INSPECTOR_REGION_SIZE;
const MAX_IN_FLIGHT_CAPTURES = 3;
const MAP_READ_USAGE = globalThis.GPUBufferUsage?.MAP_READ ?? 0x0001;
const COPY_DST_USAGE = globalThis.GPUBufferUsage?.COPY_DST ?? 0x0008;
const MAP_READ_MODE = globalThis.GPUMapMode?.READ ?? 0x0001;

type SlotState = "idle" | "encoded" | "mapping";

interface Slot {
  state: SlotState;
  buffer: GPUBuffer | null;
  request: PixelRegionRequest | null;
  sourceWidth: number;
  sourceHeight: number;
  destinationX: number;
  destinationY: number;
  operation: number;
}

/**
 * Reads the final WebGPU image into fixed-size, top-left-origin RGBA regions
 * without waiting for the GPU from the render loop. Only rgba8unorm(-srgb)
 * and bgra8unorm(-srgb) formats are supported because this layout is fixed at
 * four bytes per pixel.
 */
export class WebGPUPixelRegionCapturer {
  private readonly slots: Slot[] = Array.from({ length: MAX_IN_FLIGHT_CAPTURES }, () => ({
    state: "idle",
    buffer: null,
    request: null,
    sourceWidth: 0,
    sourceHeight: 0,
    destinationX: 0,
    destinationY: 0,
    operation: 0,
  }));
  private queuedRequest: PixelRegionRequest | null = null;
  private completedResults: PixelRegionResult[] = [];
  private generation = 0;
  private disposed = false;

  constructor(
    private readonly device: GPUDevice,
    private readonly format: GPUTextureFormat,
  ) {}

  queue(request: PixelRegionRequest): boolean {
    if (this.disposed) {
      return false;
    }
    this.queuedRequest = request;
    return true;
  }

  encodeAfterRender(
    encoder: GPUCommandEncoder,
    texture: GPUTexture,
    canvasWidth: number,
    canvasHeight: number,
  ): boolean {
    if (this.disposed || !this.queuedRequest) {
      return false;
    }
    const slot = this.slots.find((candidate) => candidate.state === "idle");
    if (!slot) {
      return false;
    }

    const request = this.queuedRequest;
    let geometry;
    try {
      geometry = getPixelRegionGeometry(request.centerX, request.centerY, canvasWidth, canvasHeight);
    } catch {
      return false;
    }
    this.queuedRequest = null;
    if (geometry.copyWidth === 0 || geometry.copyHeight === 0) {
      this.completedResults.push(this.createEmptyResult(request));
      return true;
    }

    try {
      slot.buffer ??= this.device.createBuffer({ size: BUFFER_SIZE, usage: MAP_READ_USAGE | COPY_DST_USAGE });
      encoder.copyTextureToBuffer(
        { texture, origin: { x: geometry.sourceX, y: geometry.sourceY, z: 0 } },
        {
          buffer: slot.buffer,
          offset: 0,
          bytesPerRow: ALIGNED_ROW_BYTES,
          rowsPerImage: PIXEL_INSPECTOR_REGION_SIZE,
        },
        { width: geometry.copyWidth, height: geometry.copyHeight, depthOrArrayLayers: 1 },
      );
    } catch {
      this.destroySlotBuffer(slot);
      this.retryRequest(request);
      return false;
    }

    slot.state = "encoded";
    slot.request = request;
    slot.sourceWidth = geometry.copyWidth;
    slot.sourceHeight = geometry.copyHeight;
    slot.destinationX = geometry.destinationX;
    slot.destinationY = geometry.destinationY;
    return true;
  }

  beginMappings(): void {
    if (this.disposed) {
      return;
    }
    for (const slot of this.slots) {
      if (slot.state !== "encoded" || !slot.buffer) {
        continue;
      }
      slot.state = "mapping";
      const operation = ++slot.operation;
      const generation = this.generation;
      try {
        const mapping = slot.buffer.mapAsync(MAP_READ_MODE);
        void this.finishMapping(slot, operation, generation, mapping);
      } catch {
        this.failSlot(slot, operation, generation);
      }
    }
  }

  collectResults(): PixelRegionResult[] {
    if (this.disposed) {
      return [];
    }
    const results = this.completedResults;
    this.completedResults = [];
    return results;
  }

  cancelPendingCaptures(): void {
    this.generation += 1;
    this.queuedRequest = null;
    this.completedResults = [];
    for (const slot of this.slots) {
      slot.operation += 1;
      this.destroySlotBuffer(slot);
      this.resetSlot(slot);
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.cancelPendingCaptures();
    this.disposed = true;
  }

  private async finishMapping(slot: Slot, operation: number, generation: number, mapping: Promise<void>): Promise<void> {
    try {
      await mapping;
      if (!this.isCurrent(slot, operation, generation) || !slot.buffer || !slot.request) {
        return;
      }
      const mapped = new Uint8Array(slot.buffer.getMappedRange()).slice();
      const result = this.createResult(slot, mapped);
      slot.buffer.unmap();
      if (!this.isCurrent(slot, operation, generation)) {
        return;
      }
      this.completedResults.push(result);
      this.resetSlot(slot);
    } catch {
      this.failSlot(slot, operation, generation);
    }
  }

  private failSlot(slot: Slot, operation: number, generation: number): void {
    if (!this.isCurrent(slot, operation, generation)) {
      return;
    }
    const request = slot.request;
    this.destroySlotBuffer(slot);
    this.resetSlot(slot);
    if (request) {
      this.retryRequest(request);
    }
  }

  private isCurrent(slot: Slot, operation: number, generation: number): boolean {
    return !this.disposed && this.generation === generation && slot.operation === operation;
  }

  private destroySlotBuffer(slot: Slot): void {
    try {
      slot.buffer?.destroy?.();
    } catch {
      // A device-loss destroy failure must not disrupt rendering.
    }
    slot.buffer = null;
  }

  private resetSlot(slot: Slot): void {
    slot.state = "idle";
    slot.request = null;
    slot.sourceWidth = 0;
    slot.sourceHeight = 0;
    slot.destinationX = 0;
    slot.destinationY = 0;
  }

  private retryRequest(request: PixelRegionRequest): void {
    this.queuedRequest ??= request;
  }

  private createEmptyResult(request: PixelRegionRequest): PixelRegionResult {
    return {
      ...request,
      width: PIXEL_INSPECTOR_REGION_SIZE,
      height: PIXEL_INSPECTOR_REGION_SIZE,
      rgba: new Uint8ClampedArray(PIXEL_INSPECTOR_REGION_SIZE ** 2 * RGBA_CHANNELS),
    };
  }

  private createResult(slot: Slot, source: Uint8Array): PixelRegionResult {
    const result = this.createEmptyResult(slot.request!);
    for (let row = 0; row < slot.sourceHeight; row += 1) {
      const sourceOffset = row * ALIGNED_ROW_BYTES;
      const destinationOffset = ((slot.destinationY + row) * PIXEL_INSPECTOR_REGION_SIZE + slot.destinationX) * RGBA_CHANNELS;
      for (let column = 0; column < slot.sourceWidth; column += 1) {
        const src = sourceOffset + column * RGBA_CHANNELS;
        const dst = destinationOffset + column * RGBA_CHANNELS;
        if (this.format === "bgra8unorm" || this.format === "bgra8unorm-srgb") {
          result.rgba[dst] = source[src + 2];
          result.rgba[dst + 1] = source[src + 1];
          result.rgba[dst + 2] = source[src];
          result.rgba[dst + 3] = source[src + 3];
        } else {
          result.rgba[dst] = source[src];
          result.rgba[dst + 1] = source[src + 1];
          result.rgba[dst + 2] = source[src + 2];
          result.rgba[dst + 3] = source[src + 3];
        }
      }
    }
    return result;
  }
}
