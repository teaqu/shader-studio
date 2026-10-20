import { describe, expect, it, vi } from "vitest";
import { initializeStorage } from "../../webgpu/StorageLifecycle";
import { storageCacheKey } from "../../webgpu/WebGPUCompileKeys";
import type { StorageBindingNode } from "../../types/PassGraph";

const node = (overrides: Partial<StorageBindingNode> = {}): StorageBindingNode =>
  ({ name: "values", binding: 0, elementType: "u32", builtin: true, count: 4, stride: 4, ...overrides });

function device() {
  const writeBuffer = vi.fn();
  return { device: { queue: { writeBuffer } } as unknown as GPUDevice, writeBuffer };
}

describe("initializeStorage", () => {
  it("writes file bytes padded to WebGPU's 4-byte write granularity", () => {
    const { device: gpu, writeBuffer } = device();
    const buffer = {} as GPUBuffer;
    initializeStorage(gpu, buffer, node({ initialBytes: new Uint8Array([1, 2, 3, 4, 5]) }));
    expect(writeBuffer).toHaveBeenCalledWith(buffer, 0, new Uint8Array([1, 2, 3, 4, 5, 0, 0, 0]));
  });

  it("writes aligned file bytes without copying", () => {
    const { device: gpu, writeBuffer } = device();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    initializeStorage(gpu, {} as GPUBuffer, node({ initialBytes: bytes }));
    expect(writeBuffer.mock.calls[0]![2]).toBe(bytes);
  });

  it("skips zero-initialised storage and empty files", () => {
    const { device: gpu, writeBuffer } = device();
    initializeStorage(gpu, {} as GPUBuffer, node());
    initializeStorage(gpu, {} as GPUBuffer, node({ initialBytes: new Uint8Array([]) }));
    expect(writeBuffer).not.toHaveBeenCalled();
  });

  it("rejects file bytes that exceed the buffer", () => {
    const { device: gpu } = device();
    expect(() => initializeStorage(gpu, {} as GPUBuffer, node({ count: 1, initialBytes: new Uint8Array(5) })))
      .toThrow("Initial data exceeds storage values");
  });

});

describe("storageCacheKey", () => {
  it("changes when referenced file bytes or URL change", () => {
    const base = storageCacheKey(node({ initialDataFiles: [{ path: "a.bin" }], initialBytes: new Uint8Array([1]) }));
    expect(storageCacheKey(node({ initialDataFiles: [{ path: "a.bin" }], initialBytes: new Uint8Array([1]) }))).toBe(base);
    expect(storageCacheKey(node({ initialDataFiles: [{ path: "a.bin" }], initialBytes: new Uint8Array([2]) }))).not.toBe(base);
    expect(storageCacheKey(node({ initialDataFiles: [{ path: "b.bin" }], initialBytes: new Uint8Array([1]) }))).not.toBe(base);
    expect(storageCacheKey(node())).not.toBe(base);
  });
  it('includes ordered paths, URLs and offsets even when the resulting bytes are identical', () => {
    const files = [{ path: 'a.bin', byteOffset: 0 }, { path: 'b.bin', byteOffset: 4 }];
    const base = storageCacheKey(node({ initialDataFiles: files }));
    expect(storageCacheKey(node({ initialDataFiles: files.map(file => ({ ...file, resolved_path: 'https://host/' + file.path })) }))).not.toBe(base);
    expect(storageCacheKey(node({ initialDataFiles: [...files].reverse() }))).not.toBe(base);
    expect(storageCacheKey(node({ initialDataFiles: [{ path: 'a.bin', byteOffset: 1 }, files[1]!] }))).not.toBe(base);
    expect(storageCacheKey(node({ initialDataFiles: [{ path: 'a.bin' }, files[1]!] }))).toBe(base);
  });

});
