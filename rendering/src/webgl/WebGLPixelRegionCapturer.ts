import { getPixelRegionGeometry } from "../capture/PixelRegionGeometry";
import {
  PIXEL_INSPECTOR_REGION_SIZE,
  type PixelRegionRequest,
  type PixelRegionResult,
} from "../types/PixelRegion";

const RGBA_CHANNELS = 4;
const REGION_BYTE_LENGTH = PIXEL_INSPECTOR_REGION_SIZE ** 2 * RGBA_CHANNELS;
const MAX_IN_FLIGHT_CAPTURES = 3;

interface PendingCapture {
  request: PixelRegionRequest;
  pbo: WebGLBuffer;
  fence: WebGLSync;
  sourceWidth: number;
  sourceHeight: number;
  destinationX: number;
  destinationY: number;
}

/**
 * Captures the post-render WebGL framebuffer without stalling the CPU.
 * Results always use a fixed 60x60, top-left-origin RGBA byte buffer.
 */
export class WebGLPixelRegionCapturer {
  private queuedRequest: PixelRegionRequest | null = null;
  private pendingCaptures: PendingCapture[] = [];
  private completedResults: PixelRegionResult[] = [];
  private pboPool = new Map<number, WebGLBuffer[]>();
  private disposed = false;

  constructor(private readonly gl: WebGL2RenderingContext) {}

  queue(request: PixelRegionRequest): boolean {
    if (this.disposed || this.gl.isContextLost()) {
      return false;
    }

    this.queuedRequest = request;
    return true;
  }

  captureAfterRender(canvasWidth: number, canvasHeight: number): void {
    if (this.disposed || this.gl.isContextLost() || this.pendingCaptures.length >= MAX_IN_FLIGHT_CAPTURES) {
      return;
    }

    const request = this.queuedRequest;
    if (!request) {
      return;
    }

    const geometry = getPixelRegionGeometry(request.centerX, request.centerY, canvasWidth, canvasHeight);
    this.queuedRequest = null;
    if (geometry.copyWidth === 0 || geometry.copyHeight === 0) {
      this.completedResults.push(this.createEmptyResult(request));
      return;
    }

    const previousFramebuffer = this.gl.getParameter(this.gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const previousPackBuffer = this.gl.getParameter(this.gl.PIXEL_PACK_BUFFER_BINDING) as WebGLBuffer | null;
    let pbo: WebGLBuffer | null = null;
    let fence: WebGLSync | null = null;

    try {
      pbo = this.allocatePbo(geometry.copyWidth * geometry.copyHeight * RGBA_CHANNELS);
      if (!pbo) {
        this.retryRequest(request);
        return;
      }

      this.gl.bindFramebuffer(this.gl.READ_FRAMEBUFFER, null);
      this.gl.bindBuffer(this.gl.PIXEL_PACK_BUFFER, pbo);
      this.gl.bufferData(
        this.gl.PIXEL_PACK_BUFFER,
        geometry.copyWidth * geometry.copyHeight * RGBA_CHANNELS,
        this.gl.STREAM_READ,
      );
      this.gl.readPixels(
        geometry.sourceX,
        canvasHeight - (geometry.sourceY + geometry.copyHeight),
        geometry.copyWidth,
        geometry.copyHeight,
        this.gl.RGBA,
        this.gl.UNSIGNED_BYTE,
        0,
      );
      fence = this.gl.fenceSync(this.gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (!fence) {
        this.gl.deleteBuffer(pbo);
        pbo = null;
        this.retryRequest(request);
        return;
      }
      this.gl.flush();
      this.pendingCaptures.push({
        request,
        pbo,
        fence,
        sourceWidth: geometry.copyWidth,
        sourceHeight: geometry.copyHeight,
        destinationX: geometry.destinationX,
        destinationY: geometry.destinationY,
      });
      pbo = null;
      fence = null;
    } catch {
      this.retryRequest(request);
    } finally {
      if (fence) {
        this.gl.deleteSync(fence);
      }
      if (pbo) {
        this.gl.deleteBuffer(pbo);
      }
      this.gl.bindFramebuffer(this.gl.READ_FRAMEBUFFER, previousFramebuffer);
      this.gl.bindBuffer(this.gl.PIXEL_PACK_BUFFER, previousPackBuffer);
    }
  }

  collectResults(): PixelRegionResult[] {
    if (this.disposed) {
      return [];
    }
    if (this.gl.isContextLost()) {
      this.abandonCaptures();
      return [];
    }

    const previousPackBuffer = this.gl.getParameter(this.gl.PIXEL_PACK_BUFFER_BINDING) as WebGLBuffer | null;
    const remaining: PendingCapture[] = [];
    try {
      for (const pending of this.pendingCaptures) {
        let syncStatus: unknown;
        try {
          syncStatus = this.gl.getSyncParameter(pending.fence, this.gl.SYNC_STATUS);
        } catch {
          remaining.push(pending);
          continue;
        }
        if (syncStatus !== this.gl.SIGNALED) {
          remaining.push(pending);
          continue;
        }

        const source = new Uint8Array(pending.sourceWidth * pending.sourceHeight * RGBA_CHANNELS);
        try {
          this.gl.bindBuffer(this.gl.PIXEL_PACK_BUFFER, pending.pbo);
          this.gl.getBufferSubData(this.gl.PIXEL_PACK_BUFFER, 0, source);
        } catch {
          remaining.push(pending);
          continue;
        }
        this.gl.deleteSync(pending.fence);
        this.releasePbo(pending.pbo, source.byteLength);
        this.completedResults.push(this.createResult(pending, source));
      }
    } finally {
      this.gl.bindBuffer(this.gl.PIXEL_PACK_BUFFER, previousPackBuffer);
    }
    this.pendingCaptures = remaining;

    const results = this.completedResults;
    this.completedResults = [];
    return results;
  }

  cancelPendingCaptures(): void {
    if (this.gl.isContextLost()) {
      this.abandonCaptures();
      return;
    }
    for (const pending of this.pendingCaptures) {
      this.gl.deleteSync(pending.fence);
      this.gl.deleteBuffer(pending.pbo);
    }
    this.pendingCaptures = [];
    this.queuedRequest = null;
    this.completedResults = [];
    this.deletePboPool();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.cancelPendingCaptures();
    this.disposed = true;
  }

  private allocatePbo(byteLength: number): WebGLBuffer | null {
    const pool = this.pboPool.get(byteLength);
    const reused = pool?.pop();
    if (reused) {
      return reused;
    }
    return this.gl.createBuffer();
  }

  private releasePbo(pbo: WebGLBuffer, byteLength: number): void {
    const pool = this.pboPool.get(byteLength) ?? [];
    pool.push(pbo);
    this.pboPool.set(byteLength, pool);
  }

  private deletePboPool(): void {
    for (const buffers of this.pboPool.values()) {
      for (const buffer of buffers) {
        this.gl.deleteBuffer(buffer);
      }
    }
    this.pboPool.clear();
  }

  private abandonCaptures(): void {
    this.pendingCaptures = [];
    this.queuedRequest = null;
    this.completedResults = [];
    this.pboPool.clear();
  }

  private retryRequest(request: PixelRegionRequest): void {
    if (!this.queuedRequest || this.queuedRequest.requestId <= request.requestId) {
      this.queuedRequest = request;
    }
  }

  private createEmptyResult(request: PixelRegionRequest): PixelRegionResult {
    return {
      ...request,
      width: PIXEL_INSPECTOR_REGION_SIZE,
      height: PIXEL_INSPECTOR_REGION_SIZE,
      rgba: new Uint8ClampedArray(REGION_BYTE_LENGTH),
    };
  }

  private createResult(pending: PendingCapture, source: Uint8Array): PixelRegionResult {
    const result = this.createEmptyResult(pending.request);
    const rowBytes = pending.sourceWidth * RGBA_CHANNELS;
    for (let row = 0; row < pending.sourceHeight; row += 1) {
      const destinationRow = pending.destinationY + (pending.sourceHeight - row - 1);
      const destinationOffset = (destinationRow * PIXEL_INSPECTOR_REGION_SIZE + pending.destinationX) * RGBA_CHANNELS;
      result.rgba.set(source.subarray(row * rowBytes, (row + 1) * rowBytes), destinationOffset);
    }
    return result;
  }
}
