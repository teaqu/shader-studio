/** Frozen mesh-camera uniform binding used only by native raster capture. */
export const NATIVE_MESH_UNIFORM_BYTES = 256;

export function createNativeMeshUniformBuffer(
  device: GPUDevice,
  data: Float32Array | undefined,
): GPUBuffer | undefined {
  if (!data || data.byteLength !== NATIVE_MESH_UNIFORM_BYTES) {
    return undefined;
  }
  const usage = (globalThis.GPUBufferUsage?.UNIFORM ?? 0x0040) | (globalThis.GPUBufferUsage?.COPY_DST ?? 0x0008);
  const buffer = device.createBuffer({
    label: "native-capture mesh uniform snapshot",
    size: NATIVE_MESH_UNIFORM_BYTES,
    usage,
  });
  device.queue.writeBuffer(buffer, 0, new Float32Array(data));
  return buffer;
}

export function nativeMeshBindingIndex(storageBaseBinding: number, storageCount: number): number {
  return storageBaseBinding + storageCount;
}

export function captureUniformBindingIndex(storageBaseBinding: number, storageCount: number, nativeMesh: boolean): number {
  return nativeMeshBindingIndex(storageBaseBinding, storageCount) + (nativeMesh ? 1 : 0);
}
