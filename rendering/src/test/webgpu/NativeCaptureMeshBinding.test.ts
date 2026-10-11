import { describe, expect, it, vi } from "vitest";
import {
  captureUniformBindingIndex,
  createNativeMeshUniformBuffer,
  nativeMeshBindingIndex,
  NATIVE_MESH_UNIFORM_BYTES,
} from "../../webgpu/NativeCaptureMeshBinding";

describe("NativeCaptureMeshBinding", () => {
  it("reserves the mesh uniform before the capture uniform and snapshots 256 bytes", () => {
    const buffer = { destroy: vi.fn() };
    const device = {
      createBuffer: vi.fn(() => buffer),
      queue: { writeBuffer: vi.fn() },
    } as unknown as GPUDevice;
    const values = new Float32Array(NATIVE_MESH_UNIFORM_BYTES / Float32Array.BYTES_PER_ELEMENT);
    values[0] = 1;

    expect(nativeMeshBindingIndex(5, 2)).toBe(7);
    expect(captureUniformBindingIndex(5, 2, true)).toBe(8);
    expect(captureUniformBindingIndex(5, 2, false)).toBe(7);
    expect(createNativeMeshUniformBuffer(device, values)).toBe(buffer);
    expect(device.createBuffer).toHaveBeenCalledWith(expect.objectContaining({ size: 256 }));
    const written = (device.queue.writeBuffer as ReturnType<typeof vi.fn>).mock.calls[0]?.[2] as Float32Array;
    values[0] = 9;
    expect(written[0]).toBe(1);
  });

  it("refuses malformed mesh snapshots before binding them", () => {
    const device = { createBuffer: vi.fn(), queue: { writeBuffer: vi.fn() } } as unknown as GPUDevice;
    expect(createNativeMeshUniformBuffer(device, new Float32Array(1))).toBeUndefined();
    expect(device.createBuffer).not.toHaveBeenCalled();
  });
});
