import type { StorageBufferSnapshot, StorageCapturePoint } from '@shader-studio/types';
import type { StorageBindingNode } from '../types/PassGraph';

interface Request {
  name: string;
  start: number;
  count: number;
  point: StorageCapturePoint;
  resolve: (snapshot: StorageBufferSnapshot) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}
interface Encoded { request: Request; buffer: GPUBuffer; layout: StorageBindingNode; trim: number; size: number; frame: number; }

/** Copies only requested ranges at pass boundaries; mappings never block rendering. */
export class StorageCaptureQueue {
  private pending = new Set<Request>();
  private encoded = new Set<Encoded>();
  private mapping = new Set<Encoded>();

  request(name: string, start: number, count: number, point: StorageCapturePoint): Promise<StorageBufferSnapshot> {
    return new Promise((resolve, reject) => {
      const request: Request = { name, start, count, point, resolve, reject, timeout: setTimeout(() => {
        this.pending.delete(request);
        reject(new Error(`Capture point ${point.timing} ${point.pass} was not reached. Resume the shader or choose Latest values.`));
      }, 3000) };
      this.pending.add(request);
    });
  }

  encode(device: GPUDevice, encoder: GPUCommandEncoder, buffers: Map<string, GPUBuffer>, layouts: Map<string, StorageBindingNode>, point: StorageCapturePoint, frame: number): void {
    for (const request of this.pending) {
      if (request.point.pass !== point.pass || request.point.timing !== point.timing) {
        continue;
      }
      this.pending.delete(request);
      clearTimeout(request.timeout);
      const source = buffers.get(request.name), layout = layouts.get(request.name);
      if (!source || !layout || request.start + request.count > layout.count) {
        request.reject(new Error('Storage buffer changed before capture'));
        continue;
      }
      const offset = request.start * layout.stride;
      const size = request.count * layout.stride;
      const alignedOffset = Math.floor(offset / 4) * 4;
      const alignedSize = Math.ceil((offset + size) / 4) * 4 - alignedOffset;
      let buffer: GPUBuffer | undefined;
      try {
        buffer = device.createBuffer({ size: alignedSize, usage: (globalThis.GPUBufferUsage?.COPY_DST ?? 8) | (globalThis.GPUBufferUsage?.MAP_READ ?? 1) });
        encoder.copyBufferToBuffer(source, alignedOffset, buffer, 0, alignedSize);
        this.encoded.add({ request, buffer, layout, trim: offset - alignedOffset, size, frame });
      } catch (error) {
        buffer?.destroy();
        request.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  beginMappings(): void {
    for (const item of this.encoded) {
      this.mapping.add(item);
      void this.map(item);
    }
    this.encoded.clear();
  }

  private async map(item: Encoded): Promise<void> {
    try {
      await item.buffer.mapAsync(globalThis.GPUMapMode?.READ ?? 1);
      if (!this.mapping.has(item)) {
        return;
      }
      const data = item.buffer.getMappedRange().slice(item.trim, item.trim + item.size);
      item.buffer.unmap();
      item.request.resolve({ name: item.request.name, elementType: item.layout.elementType, stride: item.layout.stride,
        start: item.request.start, count: item.request.count, fields: item.layout.fields, frame: item.frame, capturePoint: item.request.point, data });
    } catch (error) {
      item.request.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      if (this.mapping.delete(item)) {
        item.buffer.destroy();
      }
    }
  }

  cancel(reason = 'Storage capture cancelled because the shader changed'): void {
    for (const request of this.pending) {
      clearTimeout(request.timeout); request.reject(new Error(reason));
    }
    this.pending.clear();
    for (const item of [...this.encoded, ...this.mapping]) {
      item.request.reject(new Error(reason)); item.buffer.destroy();
    }
    this.encoded.clear();
    this.mapping.clear();
  }
}
