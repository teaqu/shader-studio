import { describe, expect, it, vi } from "vitest";
import { WebGPUStorage } from "../../webgpu/WebGPUStorage";
import type { StorageBindingNode } from "../../types/PassGraph";

const node = (name = "particles"): StorageBindingNode => ({ name, binding: 0, elementType: "float", builtin: true, count: 4, stride: 4 });
const buffer = () => ({ destroy: vi.fn() });

function harness() {
  const createBuffer = vi.fn(() => buffer());
  const encoder = { clearBuffer: vi.fn(), finish: vi.fn(() => ({})) };
  const queue = { writeBuffer: vi.fn(), submit: vi.fn() };
  let device: GPUDevice | null = { createBuffer, queue, createCommandEncoder: vi.fn(() => encoder) } as unknown as GPUDevice;
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
  return { storage, createBuffer, queue, encoder, loseDevice: () => {
    device = null;
  } };
}

describe("WebGPUStorage boundaries", () => {
  it('initializes new and reset allocations, but retains opted-out buffers on restart', () => {
    const { storage, createBuffer, queue, encoder, loseDevice } = harness();
    const keep = { ...node('keep'), initialData: 'AQIDBA==', resetOnRestart: false };
    const reset = { ...node('reset'), initialData: 'BQYHCA==', clearEachFrame: true };
    storage.publishPreparedStorage(storage.prepareStorageBuffers([keep, reset], 1));
    expect(queue.writeBuffer).toHaveBeenCalledTimes(2);
    const existing = storage.storageBuffers.get('keep');
    storage.storageLayouts.get('keep')!.fields = [{ name: 'value', type: 'f32', offset: 0 }];
    const reused = storage.prepareStorageBuffers([keep, reset], 2);
    expect(reused.buffers.get('keep')).toBe(existing);
    expect(reused.layouts.get('keep')!.fields).toHaveLength(1);
    storage.applyCompiledFields(reused, [keep]);
    expect(reused.layouts.get('keep')!.fields).toHaveLength(1);
    storage.applyCompiledFields(reused, [{ ...keep, fields: [{ name: 'updated', type: 'f32', offset: 0 }] }]);
    expect(reused.layouts.get('keep')!.fields![0]!.name).toBe('updated');
    expect(createBuffer).toHaveBeenCalledTimes(2);
    const pending = { generation: 3, storageBuffers: storage.prepareResetStorageBuffers(), storageKeys: new Map(storage.storageKeys) };
    expect(pending.storageBuffers.has('keep')).toBe(false);
    const restarted = storage.prepareStorageBuffers([keep, reset], 3, true, pending);
    expect(restarted.buffers.get('keep')).toBe(existing);
    expect(restarted.buffers.get('reset')).toBe(pending.storageBuffers.get('reset'));
    storage.publishPreparedStorage(restarted);
    storage.resetStorageBuffer('keep');
    expect(encoder.clearBuffer).toHaveBeenCalledWith(existing);
    expect(queue.submit).toHaveBeenCalledOnce();
    expect(queue.writeBuffer).toHaveBeenLastCalledWith(existing, 0, new Uint8Array([1, 2, 3, 4]));
    storage.clearFrame(encoder as unknown as GPUCommandEncoder);
    expect(encoder.clearBuffer).toHaveBeenLastCalledWith(restarted.buffers.get('reset'));
    loseDevice();
    expect(() => storage.resetStorageBuffer('keep')).toThrow('not available');
  });
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
