/// <reference types="@webgpu/types" />

describe('WebGPU browser availability', () => {
  it('creates an adapter and device for Slang browser tests', async () => {
    expect(navigator.gpu).toBeDefined();

    const adapter = await navigator.gpu.requestAdapter();
    expect(adapter).not.toBeNull();

    const device = await adapter!.requestDevice();
    expect(device).toBeDefined();
    device.destroy();
  });
});
