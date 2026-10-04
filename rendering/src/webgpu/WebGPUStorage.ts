
import type { StorageBufferSnapshot, StorageCapturePoint } from "@shader-studio/types";
import { StorageCaptureQueue } from './StorageCaptureQueue';
import { initializeStorage, clearFrameStorage } from './StorageLifecycle';
import type { StorageBindingNode } from "../types/PassGraph";
import type { PendingReset,PreparedStorageBuffers } from "./WebGPUCompilationTypes";
import * as compileKeys from "./WebGPUCompileKeys";

const WEBGPU_BUFFER_SIZE_ALIGNMENT = 4;

function storageBufferByteSize(node: StorageBindingNode): number {
  const logicalSize = node.count * node.stride;
  return Math.ceil(logicalSize / WEBGPU_BUFFER_SIZE_ALIGNMENT) * WEBGPU_BUFFER_SIZE_ALIGNMENT;
}

interface WebGPUStorageHost {

  device: GPUDevice | null;
  retireAfterPublication(resource: string, retire: () => void, warnings: string[]): void;
}

/** Owns storage state and operations; dependencies stay live across compilation swaps. */
export class WebGPUStorage {
  readonly captures = new StorageCaptureQueue();
  constructor(private readonly host: WebGPUStorageHost) {}

  storageBuffers = new Map<string, GPUBuffer>();

  storageKeys = new Map<string, string>();

  storageLayouts = new Map<string, StorageBindingNode>();

  pendingStoragePreparations = new Set<PreparedStorageBuffers>();

  resetStorageOnNextSync = false;

  resetGeneration = 0;

  pendingReset: PendingReset | null = null;

  prepareStorageBuffers(
    storage: StorageBindingNode[],
    generation: number,
    forceFresh = false,
    pendingReset: PendingReset | null = null,
  ): PreparedStorageBuffers {
    if (!this.host.device) {
      throw new Error("WebGPU device unavailable while allocating storage buffers");
    }
    const STORAGE = globalThis.GPUBufferUsage?.STORAGE ?? 0x0080;
    const COPY_SRC = globalThis.GPUBufferUsage?.COPY_SRC ?? 0x0004;
    const COPY_DST = globalThis.GPUBufferUsage?.COPY_DST ?? 0x0008;
    const nextBuffers = new Map<string, GPUBuffer>();
    const nextKeys = new Map<string, string>();
    const nextLayouts = new Map<string, StorageBindingNode>();
    const stagedBuffers: GPUBuffer[] = [];
    const borrowedResetBuffers = new Set<GPUBuffer>();
    try {
      for (const node of storage) {
        const key = compileKeys.storageCacheKey(node);
        let buffer = this.reusableBuffer(node, key, forceFresh, pendingReset);
        if (buffer) {
          if (forceFresh && pendingReset?.storageBuffers.get(node.name) === buffer) {
            borrowedResetBuffers.add(buffer);
          }
        } else {
          buffer = this.host.device.createBuffer({
            size: storageBufferByteSize(node),
            usage: STORAGE | COPY_SRC | COPY_DST,
          });
          stagedBuffers.push(buffer);
          initializeStorage(this.host.device, buffer, node);
        }
        nextBuffers.set(node.name, buffer);
        nextKeys.set(node.name, key);
        nextLayouts.set(node.name, { ...node, fields: node.fields ?? (this.storageKeys.get(node.name) === key ? this.storageLayouts.get(node.name)?.fields : undefined) });
      }
    } catch (error) {
      for (const buffer of stagedBuffers) {
        buffer.destroy();
      }
      throw error;
    }

    const prepared: PreparedStorageBuffers = {
      generation,
      buffers: nextBuffers,
      keys: nextKeys,
      layouts: nextLayouts,
      stagedBuffers,
      borrowedResetBuffers,
      settled: false,
    };
    this.pendingStoragePreparations.add(prepared);
    return prepared;
  }

  private reusableBuffer(node: StorageBindingNode, key: string, forceFresh: boolean, pendingReset: PendingReset | null): GPUBuffer | undefined {
    const existing = this.storageKeys.get(node.name) === key ? this.storageBuffers.get(node.name) : undefined;
    if (forceFresh && pendingReset) {
      if (node.resetOnRestart === false && existing) {
        return existing;
      }
      if (pendingReset.storageKeys.get(node.name) === key) {
        return pendingReset.storageBuffers.get(node.name);
      }
    }
    return !forceFresh && !this.resetStorageOnNextSync ? existing : undefined;
  }

  applyCompiledFields(prepared: PreparedStorageBuffers, nodes: StorageBindingNode[]): void {
    for (const node of nodes) {
      const layout = prepared.layouts.get(node.name);
      if (layout && node.fields) {
        layout.fields = node.fields;
      }
    }
  }

  collectRetiredStorageBuffers(
    prepared: PreparedStorageBuffers,
  ): Array<[string, GPUBuffer]> {
    return [...this.storageBuffers].filter(([name, buffer]) =>
      prepared.buffers.get(name) !== buffer);
  }

  resolveStorageRange(
    name: string,
    start: number,
    count: number,
  ): { buffer: GPUBuffer; layout: StorageBindingNode; offset: number; size: number } {
    const layout = this.storageLayouts.get(name);
    const buffer = this.storageBuffers.get(name);
    if (!layout || !buffer) {
      throw new Error(`Storage buffer "${name}" is not available`);
    }
    if (!Number.isInteger(start) || !Number.isInteger(count) || start < 0 || count <= 0 || start + count > layout.count) {
      throw new Error(`Storage buffer "${name}" has an invalid element range`);
    }
    const offset = start * layout.stride;
    const size = count * layout.stride;
    return { buffer, layout, offset, size };
  }

  publishPreparedStorage(prepared: PreparedStorageBuffers): void {
    this.captures.cancel();
    this.storageBuffers = prepared.buffers;
    this.storageKeys = prepared.keys;
    this.storageLayouts = prepared.layouts;
    this.resetStorageOnNextSync = false;
    prepared.settled = true;
    this.pendingStoragePreparations.delete(prepared);
  }

  consumePendingReset(
    generation: number,
    prepared: PreparedStorageBuffers,
    warnings: string[],
  ): void {
    const pendingReset = this.pendingReset;
    if (!pendingReset || pendingReset.generation !== generation) {
      return;
    }
    for (const [name, buffer] of pendingReset.storageBuffers) {
      if (prepared.borrowedResetBuffers.has(buffer)) {
        continue;
      }
      this.host.retireAfterPublication(`unused reset storage buffer ${name}`, () => buffer.destroy(), warnings);
    }
    pendingReset.storageBuffers.clear();
    pendingReset.storageKeys.clear();
    this.pendingReset = null;
  }

  discardPreparedStorage(prepared: PreparedStorageBuffers): void {
    if (prepared.settled) {
      return;
    }
    prepared.settled = true;
    this.pendingStoragePreparations.delete(prepared);
    for (const buffer of prepared.stagedBuffers) {
      try {
        buffer.destroy();
      } catch {
        // A failed candidate owns no live state. Continue releasing its other
        // resources even if one driver-backed destroy call fails.
      }
    }
  }

  prepareResetStorageBuffers(): Map<string, GPUBuffer> {
    if (!this.host.device || this.storageLayouts.size === 0) {
      return new Map();
    }
    const STORAGE = globalThis.GPUBufferUsage?.STORAGE ?? 0x0080;
    const COPY_SRC = globalThis.GPUBufferUsage?.COPY_SRC ?? 0x0004;
    const COPY_DST = globalThis.GPUBufferUsage?.COPY_DST ?? 0x0008;
    const nextBuffers = new Map<string, GPUBuffer>();
    const stagedBuffers: GPUBuffer[] = [];
    try {
      for (const node of this.storageLayouts.values()) {
        if (node.resetOnRestart === false) {
          continue;
        }
        const buffer = this.host.device.createBuffer({
          size: storageBufferByteSize(node),
          usage: STORAGE | COPY_SRC | COPY_DST,
        });
        stagedBuffers.push(buffer);
        initializeStorage(this.host.device, buffer, node);
        nextBuffers.set(node.name, buffer);
      }
    } catch (error) {
      for (const buffer of stagedBuffers) {
        try {
          buffer.destroy();
        } catch {
          // Preserve the allocation failure and keep releasing the rest of
          // this unpublished reset candidate.
        }
      }
      throw error;
    }
    return nextBuffers;
  }

  discardPendingReset(pendingReset: PendingReset): void {
    for (const buffer of pendingReset.storageBuffers.values()) {
      try {
        buffer.destroy();
      } catch {
        // A pending reset owns only unpublished storage. Keep releasing the
        // remaining candidates if a driver-backed destroy fails.
      }
    }
    pendingReset.storageBuffers.clear();
    pendingReset.storageKeys.clear();
    if (this.pendingReset === pendingReset) {
      this.pendingReset = null;
    }
  }

  async readStorageBuffer(name: string, start: number, count: number, point?: StorageCapturePoint): Promise<StorageBufferSnapshot> {
    const { buffer, layout, offset, size } = this.resolveStorageRange(name, start, count);
    if (point) {
      return this.captures.request(name, start, count, point);
    }
    const alignedOffset = Math.floor(offset / WEBGPU_BUFFER_SIZE_ALIGNMENT) * WEBGPU_BUFFER_SIZE_ALIGNMENT;
    const alignedEnd = Math.ceil((offset + size) / WEBGPU_BUFFER_SIZE_ALIGNMENT) * WEBGPU_BUFFER_SIZE_ALIGNMENT;
    const copied = await this.readStorageBytes(buffer, alignedOffset, alignedEnd - alignedOffset, name);
    const data = copied.slice(offset - alignedOffset, offset - alignedOffset + size);
    return { name, elementType: layout.elementType, stride: layout.stride, start, count, data, fields: layout.fields };
  }

  resetStorageBuffer(name: string): void {
    const buffer = this.storageBuffers.get(name), node = this.storageLayouts.get(name);
    const device = this.host.device;
    if (!buffer || !node || !device) {
      throw new Error(`Storage buffer "${name}" is not available`);
    }
    const encoder = device.createCommandEncoder();
    encoder.clearBuffer(buffer);
    device.queue.submit([encoder.finish()]);
    initializeStorage(device, buffer, node);
  }

  clearFrame(encoder: GPUCommandEncoder): void {
    clearFrameStorage(encoder, this.storageBuffers, this.storageLayouts);
  }

  captureAt(encoder: GPUCommandEncoder, pass: string, timing: 'before' | 'after', frame: number): void {
    if (this.host.device) {
      this.captures.encode(this.host.device, encoder, this.storageBuffers, this.storageLayouts, { pass, timing }, frame);
    }
  }

  async readStorageBytes(buffer: GPUBuffer, offset: number, size: number, name: string): Promise<ArrayBuffer> {
    if (!this.host.device) {
      throw new Error("WebGPU device unavailable while reading storage buffer");
    }
    const COPY_DST = globalThis.GPUBufferUsage?.COPY_DST ?? 0x0008;
    const MAP_READ = globalThis.GPUBufferUsage?.MAP_READ ?? 0x0001;
    const readback = this.host.device.createBuffer({ size, usage: COPY_DST | MAP_READ });
    try {
      const encoder = this.host.device.createCommandEncoder({ label: `storage-readback-${name}` });
      encoder.copyBufferToBuffer(buffer, offset, readback, 0, size);
      this.host.device.queue.submit([encoder.finish()]);
      await readback.mapAsync(globalThis.GPUMapMode?.READ ?? 0x0001);
      const data = readback.getMappedRange().slice(0);
      readback.unmap();
      return data;
    } finally {
      readback.destroy();
    }
  }

  async writeStorageBuffer(name: string, start: number, data: ArrayBuffer): Promise<void> {
    const layout = this.storageLayouts.get(name);
    const buffer = this.storageBuffers.get(name);
    if (!layout || !buffer) {
      throw new Error(`Storage buffer "${name}" is not available`);
    }
    if (!Number.isInteger(start) || start < 0 || start >= layout.count) {
      throw new Error(`Storage buffer "${name}" has an invalid element range`);
    }
    if (data.byteLength === 0 || data.byteLength % layout.stride !== 0) {
      throw new Error(`Storage buffer "${name}" write data does not match its stride`);
    }
    const count = data.byteLength / layout.stride;
    const { offset, size } = this.resolveStorageRange(name, start, count);
    if (size !== data.byteLength || !this.host.device) {
      throw new Error("WebGPU device unavailable while writing storage buffer");
    }
    const alignedOffset = Math.floor(offset / WEBGPU_BUFFER_SIZE_ALIGNMENT) * WEBGPU_BUFFER_SIZE_ALIGNMENT;
    const alignedEnd = Math.ceil((offset + size) / WEBGPU_BUFFER_SIZE_ALIGNMENT) * WEBGPU_BUFFER_SIZE_ALIGNMENT;
    if (alignedOffset === offset && alignedEnd === offset + size) {
      this.host.device.queue.writeBuffer(buffer, offset, data);
      return;
    }
    const padded = new Uint8Array(await this.readStorageBytes(buffer, alignedOffset, alignedEnd - alignedOffset, name));
    padded.set(new Uint8Array(data), offset - alignedOffset);
    this.host.device.queue.writeBuffer(buffer, alignedOffset, padded);
  }
  discardPendingPreparations(attempt: (cleanup: () => void) => void): void {
    for (const prepared of [...this.pendingStoragePreparations]) {
      attempt(() => this.discardPreparedStorage(prepared));
    }
  }

  disposeBuffers(attempt: (cleanup: () => void) => void): void {
    this.captures.cancel('Storage capture cancelled because the renderer was disposed');
    if (this.pendingReset) {
      const pendingReset = this.pendingReset;
      attempt(() => this.discardPendingReset(pendingReset));
    }
    for (const buffer of this.storageBuffers.values()) {
      attempt(() => buffer.destroy());
    }
    this.storageBuffers.clear();
    this.storageKeys.clear();
    this.storageLayouts.clear();
    this.resetStorageOnNextSync = false;
  }

}
