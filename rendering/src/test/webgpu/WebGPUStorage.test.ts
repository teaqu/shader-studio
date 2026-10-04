import { describe, expect, it, vi } from "vitest";
import { WebGPUStorage } from "../../webgpu/WebGPUStorage";
import type { StorageBindingNode } from "../../types/PassGraph";

const node = (name = "particles"): StorageBindingNode => ({ name, binding: 0, elementType: "float", builtin: true, count: 4, stride: 4 });
const buffer = () => ({ destroy: vi.fn() });

function harness() {
  const createBuffer = vi.fn(() => buffer());
  let device: GPUDevice | null = { createBuffer } as unknown as GPUDevice;
  const storage = new WebGPUStorage({
    get device() {
      return device;
    },
    retireAfterPublication: (_name, retire, warnings) => {
      try {
        retire();
      } catch {
        warnings.push("retirement failed");
      }
    },
  });
  return { storage, createBuffer, loseDevice: () => {
    device = null;
  } };
}

describe("WebGPUStorage boundaries", () => {
  it("rejects allocation without a device and leaves installed buffers intact", () => {
    const { storage, loseDevice } = harness();
    loseDevice();
    expect(() => storage.prepareStorageBuffers([node()], 1)).toThrow("device unavailable");
    expect(storage.storageBuffers.size).toBe(0);
  });

  it("destroys unpublished allocations when a later allocation fails", () => {
    const { storage, createBuffer } = harness();
    const first = buffer();
    createBuffer.mockReturnValueOnce(first).mockImplementationOnce(() => {
      throw new Error("allocation failed");
    });
    expect(() => storage.prepareStorageBuffers([node(), node("other")], 1)).toThrow("allocation failed");
    expect(first.destroy).toHaveBeenCalledOnce();
    expect(storage.pendingStoragePreparations.size).toBe(0);
    expect(storage.storageBuffers.size).toBe(0);
  });

  it("rejects missing storage and invalid ranges before accessing the GPU", async () => {
    const { storage } = harness();
    expect(() => storage.resolveStorageRange("missing", 0, 1)).toThrow("not available");
    await expect(storage.writeStorageBuffer("missing", 0, new ArrayBuffer(4))).rejects.toThrow("not available");
    storage.publishPreparedStorage(storage.prepareStorageBuffers([node()], 1));
    for (const start of [-1, 0.5, 4]) {
      await expect(storage.writeStorageBuffer("particles", start, new ArrayBuffer(4))).rejects.toThrow("invalid element range");
    }
    for (const length of [0, 3]) {
      await expect(storage.writeStorageBuffer("particles", 0, new ArrayBuffer(length))).rejects.toThrow("does not match its stride");
    }
  });

  it("rejects writes after device loss without discarding the installed buffer", async () => {
    const { storage, loseDevice } = harness();
    storage.publishPreparedStorage(storage.prepareStorageBuffers([node()], 1));
    loseDevice();
    await expect(storage.writeStorageBuffer("particles", 0, new ArrayBuffer(4))).rejects.toThrow("device unavailable");
    expect(storage.storageBuffers.size).toBe(1);
  });

  it("retains a reset belonging to another generation and retires unused buffers from the consumed reset", () => {
    const { storage } = harness();
    const unused = buffer();
    storage.pendingReset = { generation: 2, storageBuffers: new Map([["unused", unused as unknown as GPUBuffer]]), storageKeys: new Map() };
    const prepared = storage.prepareStorageBuffers([node()], 1);
    storage.consumePendingReset(1, prepared, []);
    expect(storage.pendingReset?.generation).toBe(2);
    storage.consumePendingReset(2, prepared, []);
    expect(unused.destroy).toHaveBeenCalledOnce();
    expect(storage.pendingReset).toBeNull();
  });

  it("continues discarding unpublished candidates even if one buffer destroy fails", () => {
    const { storage, createBuffer } = harness();
    const bad = buffer();
    bad.destroy.mockImplementation(() => {
      throw new Error("driver error");
    });
    const good = buffer();
    createBuffer.mockReturnValueOnce(bad).mockReturnValueOnce(good);
    const prepared = storage.prepareStorageBuffers([node(), node("other")], 1);
    storage.discardPreparedStorage(prepared);
    storage.discardPreparedStorage(prepared);
    expect(bad.destroy).toHaveBeenCalledOnce();
    expect(good.destroy).toHaveBeenCalledOnce();
    expect(storage.pendingStoragePreparations.size).toBe(0);
  });
});
