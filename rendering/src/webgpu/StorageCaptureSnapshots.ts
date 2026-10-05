/// <reference types="@webgpu/types" />
import type { StorageBindingNode } from "../types/PassGraph";

const BUFFER_ALIGNMENT = 4;

export interface StorageCaptureSnapshot {
  buffers: Map<string, GPUBuffer>;
  copies: GPUBuffer[];
}

function byteSize(node: StorageBindingNode): number {
  return Math.ceil(node.count * node.stride / BUFFER_ALIGNMENT) * BUFFER_ALIGNMENT;
}

/**
 * Capture instrumentation is allowed to write atomics and storage buffers.
 * Bind a GPU copy for the whole batch so debug execution cannot mutate the
 * installed simulation state between normal frames.
 */
export function createStorageCaptureSnapshot(
  device: GPUDevice,
  storage: StorageBindingNode[],
  sourceBuffers: Map<string, GPUBuffer>,
  onCreate: () => void = () => undefined,
  onDestroy: () => void = () => undefined,
): StorageCaptureSnapshot | null {
  if (storage.length === 0) {
    return { buffers: sourceBuffers, copies: [] };
  }
  const missing = storage.find(node => !sourceBuffers.has(node.name));
  if (missing) {
    return null;
  }

  const STORAGE = globalThis.GPUBufferUsage?.STORAGE ?? 0x0080;
  const COPY_SRC = globalThis.GPUBufferUsage?.COPY_SRC ?? 0x0004;
  const COPY_DST = globalThis.GPUBufferUsage?.COPY_DST ?? 0x0008;
  const buffers = new Map<string, GPUBuffer>();
  const copies: GPUBuffer[] = [];
  try {
    const encoder = device.createCommandEncoder({ label: "variable-capture storage snapshot" });
    for (const node of storage) {
      const copy = device.createBuffer({
        label: `variable-capture storage snapshot: ${node.name}`,
        size: byteSize(node),
        usage: STORAGE | COPY_SRC | COPY_DST,
      });
      onCreate();
      const source = sourceBuffers.get(node.name)!;
      encoder.copyBufferToBuffer(source, 0, copy, 0, byteSize(node));
      buffers.set(node.name, copy);
      copies.push(copy);
    }
    device.queue.submit([encoder.finish()]);
    return { buffers, copies };
  } catch (error) {
    for (const copy of copies) {
      copy.destroy?.();
      onDestroy();
    }
    throw error;
  }
}

export function releaseStorageCaptureSnapshot(
  device: GPUDevice,
  snapshot: StorageCaptureSnapshot | undefined,
  onDestroy: () => void,
): void {
  if (!snapshot || snapshot.copies.length === 0) {
    return;
  }
  const destroy = () => {
    for (const copy of snapshot.copies) {
      copy.destroy?.();
      onDestroy();
    }
  };
  try {
    const pending = device.queue.onSubmittedWorkDone?.();
    if (pending) {
      void pending.then(destroy, destroy);
    } else {
      destroy();
    }
  } catch {
    destroy();
  }
}

export function createStorageCaptureSnapshots(
  device: GPUDevice, count: number, storage: StorageBindingNode[], sourceBuffers: Map<string, GPUBuffer>,
  onCreate: () => void, onDestroy: () => void,
): StorageCaptureSnapshot[] {
  const snapshots: StorageCaptureSnapshot[] = [];
  try {
    for (let index = 0; index < count; index++) {
      const snapshot = createStorageCaptureSnapshot(device, storage, sourceBuffers, onCreate, onDestroy);
      if (!snapshot) {
        throw new Error("Capture storage buffers are not resolvable yet");
      }
      snapshots.push(snapshot);
    }
    return snapshots;
  } catch (error) {
    for (const snapshot of snapshots) {
      releaseStorageCaptureSnapshot(device, snapshot, onDestroy);
    }
    throw error;
  }
}
