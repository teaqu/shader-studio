import type { StorageBindingNode } from '../types/PassGraph';

export function initializeStorage(device: GPUDevice, buffer: GPUBuffer, node: StorageBindingNode): void {
  const bytes = node.initialBytes;
  if (!bytes?.byteLength) {
    return;
  }
  if (bytes.byteLength > node.count * node.stride) {
    throw new Error(`Initial data exceeds storage ${node.name}`);
  }
  // writeBuffer sizes must be multiples of 4; the buffer itself is already padded.
  const aligned = bytes.byteLength % 4 === 0 ? bytes : new Uint8Array(Math.ceil(bytes.byteLength / 4) * 4);
  if (aligned !== bytes) {
    aligned.set(bytes);
  }
  device.queue.writeBuffer(buffer, 0, aligned);
}

export function clearFrameStorage(encoder: GPUCommandEncoder, buffers: Map<string, GPUBuffer>, layouts: Map<string, StorageBindingNode>): void {
  for (const [name, node] of layouts) {
    const buffer = buffers.get(name);
    if (node.clearEachFrame && buffer) {
      encoder.clearBuffer(buffer);
    }
  }
}
