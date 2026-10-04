import { afterEach, describe, expect, it, vi } from "vitest";
import { createStorageCaptureSnapshot, createStorageCaptureSnapshots, releaseStorageCaptureSnapshot } from "../../webgpu/StorageCaptureSnapshots";
import type { StorageBindingNode } from "../../types/PassGraph";

const storage: StorageBindingNode = {
  name: "counter",
  binding: 0,
  elementType: "atomic<u32>",
  builtin: false,
  containsAtomic: true,
  count: 3,
  stride: 4,
};

describe("storage capture snapshots", () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the existing bank for a pass without storage and rejects unresolved bindings', () => {
    const device = {} as GPUDevice;
    const buffers = new Map<string, GPUBuffer>();
    expect(createStorageCaptureSnapshot(device, [], buffers)).toEqual({ buffers, copies: [] });
    expect(createStorageCaptureSnapshot(device, [storage], buffers)).toBeNull();
    expect(() => createStorageCaptureSnapshots(device, 1, [storage], buffers, vi.fn(), vi.fn())).toThrow('not resolvable');
  });

  it('uses standard usage flags without a browser constants object and cleans partial allocation', () => {
    vi.stubGlobal('GPUBufferUsage', undefined);
    const destroy = vi.fn();
    const copied = { destroy } as unknown as GPUBuffer;
    const onDestroy = vi.fn();
    const createBuffer = vi.fn().mockReturnValueOnce(copied).mockImplementationOnce(() => {
      throw new Error('allocation failed'); 
    });
    const device = {
      createBuffer,
      createCommandEncoder: () => ({ copyBufferToBuffer: vi.fn(), finish: vi.fn() }),
      queue: { submit: vi.fn() },
    } as unknown as GPUDevice;
    const other = { ...storage, name: 'other' };
    const buffers = new Map([[storage.name, {} as GPUBuffer], [other.name, {} as GPUBuffer]]);
    expect(() => createStorageCaptureSnapshot(device, [storage, other], buffers, vi.fn(), onDestroy)).toThrow('allocation failed');
    expect(createBuffer).toHaveBeenCalledWith(expect.objectContaining({ usage: 140, size: 12 }));
    expect(destroy).toHaveBeenCalledOnce();
    expect(onDestroy).toHaveBeenCalledOnce();
  });

  it.each(['absent', 'throw', 'reject'] as const)('releases storage snapshots when completion notification is %s', async (mode) => {
    const destroy = vi.fn();
    const onDestroy = vi.fn();
    const device = { queue: {
      ...(mode === 'absent' ? {} : { onSubmittedWorkDone: mode === 'throw'
        ? () => {
          throw new Error('lost device'); 
        } : () => Promise.reject(new Error('lost device')) }),
    } } as unknown as GPUDevice;
    releaseStorageCaptureSnapshot(device, { buffers: new Map(), copies: [{ destroy } as unknown as GPUBuffer] }, onDestroy);
    await Promise.resolve();
    expect(destroy).toHaveBeenCalledOnce();
    expect(onDestroy).toHaveBeenCalledOnce();
  });

  it('releases already-created batch snapshots when a later batch allocation fails', () => {
    const destroy = vi.fn();
    const onCreate = vi.fn();
    const onDestroy = vi.fn();
    const createBuffer = vi.fn().mockReturnValueOnce({ destroy }).mockImplementationOnce(() => {
      throw new Error('batch allocation failed');
    });
    const device = { createBuffer, createCommandEncoder: () => ({ copyBufferToBuffer: vi.fn(), finish: vi.fn() }), queue: { submit: vi.fn() } } as unknown as GPUDevice;
    expect(() => createStorageCaptureSnapshots(device, 2, [storage], new Map([[storage.name, {} as GPUBuffer]]), onCreate, onDestroy)).toThrow('batch allocation failed');
    expect(onCreate).toHaveBeenCalledOnce();
    expect(onDestroy).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('cleans failed allocation without optional lifecycle observers', () => {
    const destroy = vi.fn();
    const device = {
      createBuffer: vi.fn().mockReturnValueOnce({ destroy }).mockImplementationOnce(() => {
        throw new Error('allocation failed');
      }),
      createCommandEncoder: () => ({ copyBufferToBuffer: vi.fn(), finish: vi.fn() }),
      queue: { submit: vi.fn() },
    } as unknown as GPUDevice;
    const other = { ...storage, name: 'second' };
    expect(() => createStorageCaptureSnapshot(device, [storage, other], new Map([[storage.name, {} as GPUBuffer], [other.name, {} as GPUBuffer]]))).toThrow('allocation failed');
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("copies an aligned storage range and never returns the installed writable buffer", async () => {
    const copyBufferToBuffer = vi.fn();
    const submit = vi.fn();
    const snapshotBuffer = { destroy: vi.fn() } as unknown as GPUBuffer;
    const sourceBuffer = { tag: "installed writable storage" } as unknown as GPUBuffer;
    const device = {
      createBuffer: vi.fn(() => snapshotBuffer),
      createCommandEncoder: vi.fn(() => ({ copyBufferToBuffer, finish: vi.fn(() => ({ tag: "copy" })) })),
      queue: { submit, onSubmittedWorkDone: vi.fn(async () => undefined) },
    } as unknown as GPUDevice;

    const snapshot = createStorageCaptureSnapshot(device, [storage], new Map([[storage.name, sourceBuffer]]));

    expect(snapshot?.buffers.get(storage.name)).toBe(snapshotBuffer);
    expect(snapshot?.buffers.get(storage.name)).not.toBe(sourceBuffer);
    expect(copyBufferToBuffer).toHaveBeenCalledWith(sourceBuffer, 0, snapshotBuffer, 0, 12);
    expect(submit).toHaveBeenCalledTimes(1);

    releaseStorageCaptureSnapshot(device, snapshot ?? undefined, () => undefined);
    await Promise.resolve();
    expect((snapshotBuffer as unknown as { destroy: ReturnType<typeof vi.fn> }).destroy).toHaveBeenCalledTimes(1);
  });
});
