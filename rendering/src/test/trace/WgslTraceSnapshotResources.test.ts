import { describe, expect, it, vi } from 'vitest';
import { cloneWgslTraceChannels, cloneWgslTraceStorage } from '../../trace/WgslTraceSnapshotResources';

function fakeTexture(mipLevelCount = 1) {
  return {
    width: 16,
    height: 8,
    depthOrArrayLayers: 4,
    format: 'rgba8unorm',
    dimension: '2d',
    mipLevelCount,
    sampleCount: 1,
    createView: vi.fn(() => ({})),
    destroy: vi.fn(),
  };
}

function fakeDevice(createdTextures: ReturnType<typeof fakeTexture>[] = []) {
  const encoder = {
    copyBufferToBuffer: vi.fn(),
    copyTextureToTexture: vi.fn(),
    finish: vi.fn(() => ({})),
  };
  const device = {
    createCommandEncoder: vi.fn(() => encoder),
    createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
    createTexture: vi.fn(() => {
      const texture = fakeTexture();
      createdTextures.push(texture);
      return texture;
    }),
    queue: { submit: vi.fn() },
  };
  return { device: device as unknown as GPUDevice, encoder, deviceMock: device };
}

describe('WGSL trace snapshot resources', () => {
  it('copies each mip once for aliases and recreates layer views', () => {
    const { device, encoder, deviceMock } = fakeDevice();
    const source = fakeTexture(3) as unknown as GPUTexture;
    const resources = [
      { slot: 0, texture: source, textureView: {}, layer: 2 },
      { slot: 1, texture: source, textureView: {} },
    ] as never[];

    const owned: GPUTexture[] = [];
    const copied = cloneWgslTraceChannels(device, resources, owned);

    expect(deviceMock.createTexture).toHaveBeenCalledTimes(1);
    expect(encoder.copyTextureToTexture).toHaveBeenCalledTimes(3);
    expect(copied[0].texture).toBe(copied[1].texture);
    expect((copied[0].texture as unknown as ReturnType<typeof fakeTexture>).createView)
      .toHaveBeenNthCalledWith(1, { dimension: '2d', baseArrayLayer: 2, arrayLayerCount: 1 });
    expect((copied[1].texture as unknown as ReturnType<typeof fakeTexture>).createView)
      .toHaveBeenNthCalledWith(2, { dimension: '2d' });
    expect(owned).toHaveLength(1);
    expect(deviceMock.queue.submit).toHaveBeenCalledTimes(1);
  });

  it('copies storage into owned buffers before pipeline work', () => {
    const { device, encoder, deviceMock } = fakeDevice();
    const source = new Map([['state', {} as GPUBuffer]]);
    const owned: GPUBuffer[] = [];

    const copied = cloneWgslTraceStorage(device, [{ name: 'state', count: 3, stride: 6 } as never], source, owned);

    expect(copied.get('state')).toBe(owned[0]);
    expect(encoder.copyBufferToBuffer).toHaveBeenCalledWith(source.get('state'), 0, owned[0], 0, 20);
    expect(deviceMock.queue.submit).toHaveBeenCalledTimes(1);
  });

  it('destroys partial channel clones when snapshot construction fails', () => {
    const created: ReturnType<typeof fakeTexture>[] = [];
    const { device } = fakeDevice(created);
    const source = fakeTexture() as unknown as GPUTexture;
    const owned: GPUTexture[] = [];

    expect(() => cloneWgslTraceChannels(device, [
      { slot: 0, texture: source, textureView: {} },
      { slot: 1, textureView: {} },
    ] as never[], owned)).toThrow('Channel 1 is not a frozen texture snapshot.');

    expect(created[0].destroy).toHaveBeenCalledOnce();
    expect(owned).toHaveLength(0);
  });

  it('destroys partial storage clones when a source is missing', () => {
    const { device, deviceMock } = fakeDevice();
    const source = new Map([['first', {} as GPUBuffer]]);
    const owned: GPUBuffer[] = [];

    expect(() => cloneWgslTraceStorage(device, [
      { name: 'first', count: 1, stride: 4 },
      { name: 'missing', count: 1, stride: 4 },
    ] as never[], source, owned)).toThrow("Missing live storage buffer 'missing' for trace.");

    expect(deviceMock.createBuffer.mock.results[0].value.destroy).toHaveBeenCalledOnce();
    expect(owned).toHaveLength(0);
  });
});
