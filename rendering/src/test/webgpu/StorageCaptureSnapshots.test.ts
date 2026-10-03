import { describe, expect, it, vi } from "vitest";
import { createStorageCaptureSnapshot, releaseStorageCaptureSnapshot } from "../../webgpu/StorageCaptureSnapshots";
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
