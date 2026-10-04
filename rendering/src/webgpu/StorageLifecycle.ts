import type { StorageBindingNode } from '../types/PassGraph';

export function initializeStorage(device: GPUDevice, buffer: GPUBuffer, node: StorageBindingNode): void {
  if (!node.initialData) {
    return;
  }
  const decoded = atob(node.initialData);
  if (decoded.length > node.count * node.stride) {
    throw new Error(`Initial data exceeds storage ${node.name}`);
  }
  const data = new Uint8Array(Math.ceil(decoded.length / 4) * 4);
  for (let i = 0; i < decoded.length; i++) {
    data[i] = decoded.charCodeAt(i);
  }
  if (data.length) {
    device.queue.writeBuffer(buffer, 0, data);
  }
}

export function clearFrameStorage(encoder: GPUCommandEncoder, buffers: Map<string, GPUBuffer>, layouts: Map<string, StorageBindingNode>): void {
  for (const [name, node] of layouts) {
    const buffer = buffers.get(name);
    if (node.clearEachFrame && buffer) {
      encoder.clearBuffer(buffer);
    }
  }
}
