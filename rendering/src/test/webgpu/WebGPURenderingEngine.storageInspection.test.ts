import { describe, expect, it, vi } from 'vitest';
import { WebGPURenderingEngine } from '../../webgpu/WebGPURenderingEngine';

function engineWithStorage() {
  const source = { label: 'source' } as unknown as GPUBuffer;
  const readback = {
    mapAsync: vi.fn(async () => {}),
    getMappedRange: vi.fn(() => new Float32Array([1.5, 2.5, 3.5, 4.5]).buffer),
    unmap: vi.fn(),
    destroy: vi.fn(),
  } as unknown as GPUBuffer;
  const copyBufferToBuffer = vi.fn();
  const finish = vi.fn(() => ({ label: 'readback-command' }));
  const writeBuffer = vi.fn();
  const device = {
    createBuffer: vi.fn(() => readback),
    createCommandEncoder: vi.fn(() => ({ copyBufferToBuffer, finish })),
    queue: { submit: vi.fn(), writeBuffer },
  } as unknown as GPUDevice;
  const engine = new WebGPURenderingEngine({ scriptUrl: 'slang.js', wasmUrl: 'slang.wasm' });
  (engine as unknown as { device: GPUDevice }).device = device;
  (engine as unknown as { storageBuffers: Map<string, GPUBuffer> }).storageBuffers = new Map([['particles', source]]);
  (engine as unknown as { storageLayouts: Map<string, unknown> }).storageLayouts = new Map([[
    'particles', { name: 'particles', elementType: 'float4', stride: 16, count: 8 },
  ]]);
  return { engine, source, device, readback, copyBufferToBuffer, writeBuffer };
}

describe('WebGPURenderingEngine storage inspection', () => {
  it('copies a requested aligned storage range into a CPU snapshot', async () => {
    const { engine, source, copyBufferToBuffer, readback } = engineWithStorage();

    const snapshot = await engine.readStorageBuffer('particles', 2, 1);

    expect(copyBufferToBuffer).toHaveBeenCalledWith(source, 32, readback, 0, 16);
    expect(snapshot).toMatchObject({ name: 'particles', elementType: 'float4', stride: 16, start: 2, count: 1 });
    expect(new DataView(snapshot.data).getFloat32(0, true)).toBeCloseTo(1.5);
  });

  it('writes an edited element range back at the corresponding byte offset', async () => {
    const { engine, source, writeBuffer } = engineWithStorage();
    const data = new Float32Array([9, 8, 7, 6]).buffer;

    await engine.writeStorageBuffer('particles', 3, data);

    expect(writeBuffer).toHaveBeenCalledWith(source, 48, data);
  });

  it('rejects out-of-range storage reads before encoding work', async () => {
    const { engine } = engineWithStorage();

    await expect(engine.readStorageBuffer('particles', 8, 1)).rejects.toThrow('invalid element range');
  });
});
