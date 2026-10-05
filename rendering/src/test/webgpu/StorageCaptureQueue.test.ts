import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageCaptureQueue } from '../../webgpu/StorageCaptureQueue';
import { initializeStorage, clearFrameStorage } from '../../webgpu/StorageLifecycle';
import type { StorageBindingNode } from '../../types/PassGraph';
function fixture() {
  const node: StorageBindingNode = { name: 'data', binding: 0, builtin: true, elementType: 'f16', count: 4, stride: 2 };
  const source = {} as GPUBuffer;
  const readback = { mapAsync: vi.fn(async () => {}), getMappedRange: vi.fn(() => new Uint8Array([1, 2, 3, 4]).buffer), unmap: vi.fn(), destroy: vi.fn() };
  const device = { createBuffer: vi.fn(() => readback), queue: { writeBuffer: vi.fn() } } as unknown as GPUDevice;
  const encoder = { copyBufferToBuffer: vi.fn(), clearBuffer: vi.fn() } as unknown as GPUCommandEncoder;
  return { node, source, readback, device, encoder, buffers: new Map([['data', source]]), layouts: new Map([['data', node]]) };
}
afterEach(() => vi.useRealTimers());
describe('Storage captures and lifecycle', () => {
  it('copies an aligned envelope at the requested boundary and reports exact frame context', async () => {
    const f = fixture(), queue = new StorageCaptureQueue();
    const point = { pass: 'Compute', timing: 'after' as const };
    const promise = queue.request('data', 1, 1, point);
    queue.encode(f.device, f.encoder, f.buffers, f.layouts, { ...point, timing: 'before' }, 8);
    expect(f.encoder.copyBufferToBuffer).not.toHaveBeenCalled();
    queue.encode(f.device, f.encoder, f.buffers, f.layouts, point, 9);
    expect(f.encoder.copyBufferToBuffer).toHaveBeenCalledWith(f.source, 0, f.readback, 0, 4);
    queue.beginMappings();
    const snapshot = await promise;
    expect(Array.from(new Uint8Array(snapshot.data))).toEqual([3, 4]);
    expect(snapshot).toMatchObject({ frame: 9, capturePoint: point, start: 1 });
    expect(f.readback.destroy).toHaveBeenCalledOnce();
  });
  it('times out an unexecuted pass and cancels pending or mapping requests', async () => {
    vi.useFakeTimers();
    const queue = new StorageCaptureQueue(), f = fixture(), point = { pass: 'Compute', timing: 'after' as const };
    const pending = queue.request('data', 0, 1, point);
    const rejection = expect(pending).rejects.toThrow('was not reached');
    await vi.advanceTimersByTimeAsync(3000); await rejection;
    const next = queue.request('data', 0, 1, point); const cancelled = expect(next).rejects.toThrow('cancelled');
    queue.encode(f.device, f.encoder, f.buffers, f.layouts, point, 0);
    queue.cancel(); await cancelled; expect(f.readback.destroy).toHaveBeenCalledOnce();
  });
  it('rejects invalidated buffers and mapping failures and releases readbacks', async () => {
    const queue = new StorageCaptureQueue(), f = fixture(), point = { pass: 'Image', timing: 'before' as const };
    const missing = queue.request('data', 0, 1, point); const invalid = expect(missing).rejects.toThrow('changed');
    queue.encode(f.device, f.encoder, new Map(), f.layouts, point, 0); await invalid;
    f.readback.mapAsync.mockRejectedValueOnce(new Error('map failed'));
    const next = queue.request('data', 0, 1, point); const failed = expect(next).rejects.toThrow('map failed');
    queue.encode(f.device, f.encoder, f.buffers, f.layouts, point, 0); queue.beginMappings(); await failed;
    expect(f.readback.destroy).toHaveBeenCalledOnce();
  });
  it('initializes padded binary data and clears only opted-in buffers', () => {
    const f = fixture(); f.node.initialData = 'AQID';
    initializeStorage(f.device, f.source, f.node);
    expect(f.device.queue.writeBuffer).toHaveBeenCalledWith(f.source, 0, new Uint8Array([1, 2, 3, 0]));
    clearFrameStorage(f.encoder, f.buffers, f.layouts); expect(f.encoder.clearBuffer).not.toHaveBeenCalled();
    f.node.clearEachFrame = true; clearFrameStorage(f.encoder, f.buffers, f.layouts); expect(f.encoder.clearBuffer).toHaveBeenCalledWith(f.source);
    f.node.initialData = btoa('0123456789'); expect(() => initializeStorage(f.device, f.source, f.node)).toThrow('exceeds');
  });
  it('rejects encoding failures, changed ranges and pending requests without leaking allocations', async () => {
    const queue = new StorageCaptureQueue(), f = fixture(), point = { pass: 'Image', timing: 'after' as const };
    const pending = queue.request('data', 0, 1, point);
    const cancelled = expect(pending).rejects.toThrow('disposed');
    queue.cancel('disposed'); await cancelled;
    const range = queue.request('data', 4, 1, point);
    const invalid = expect(range).rejects.toThrow('changed');
    queue.encode(f.device, f.encoder, f.buffers, f.layouts, point, 0); await invalid;
    vi.mocked(f.encoder.copyBufferToBuffer).mockImplementationOnce(() => {
      // eslint-disable-next-line no-throw-literal -- External driver failures may reject with non-Error values.
      throw 'copy failed';
    });
    const copy = queue.request('data', 0, 1, point);
    const failed = expect(copy).rejects.toThrow('copy failed');
    queue.encode(f.device, f.encoder, f.buffers, f.layouts, point, 0); await failed;
    expect(f.readback.destroy).toHaveBeenCalledOnce();
    vi.mocked(f.device.createBuffer).mockImplementationOnce(() => {
      throw new Error('allocation failed');
    });
    const allocation = queue.request('data', 0, 1, point);
    const rejected = expect(allocation).rejects.toThrow('allocation failed');
    queue.encode(f.device, f.encoder, f.buffers, f.layouts, point, 0); await rejected;
    expect(f.readback.destroy).toHaveBeenCalledOnce();
  });
  it('cancels an in-flight mapping and ignores its late completion', async () => {
    const queue = new StorageCaptureQueue(), f = fixture(), point = { pass: 'Image', timing: 'after' as const };
    let complete!: () => void;
    f.readback.mapAsync.mockImplementationOnce(() => new Promise<void>(resolve => {
      complete = resolve;
    }));
    const request = queue.request('data', 0, 1, point);
    const rejected = expect(request).rejects.toThrow('cancelled');
    queue.encode(f.device, f.encoder, f.buffers, f.layouts, point, 0); queue.beginMappings();
    queue.cancel(); complete(); await rejected;
    expect(f.readback.getMappedRange).not.toHaveBeenCalled();
    expect(f.readback.destroy).toHaveBeenCalledOnce();
  });
});
