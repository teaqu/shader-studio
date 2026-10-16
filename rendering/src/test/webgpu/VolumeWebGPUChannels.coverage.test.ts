import { describe, expect, it, vi } from "vitest";

vi.mock("../../webgpu/WebGPUSamplerCache", () => ({ getWebGPUSampler: vi.fn(() => ({ sampler: true })) }));

import { WebGPUChannels } from "../../webgpu/WebGPUChannels";

const volume = { slot: 2, key: "density", kind: "volume" as const, path: "density.ktx2", filter: "nearest" as const, wrap: "clamp" as const };

function channels(handle: unknown, loaded: boolean) {
  const resourceManager = {
    getVolumeTexture: vi.fn(() => handle),
    isVolumeLoaded: vi.fn(() => loaded),
  };
  return {
    resourceManager,
    subject: new WebGPUChannels({
      device: {} as GPUDevice,
      keyboardManager: {} as never,
      session: { passPipelines: new Map(), computePipelines: new Map(), passGraph: [], resourceManager },
    } as never),
  };
}

describe("volume WebGPU channels", () => {
  it("binds a 3D volume with sampler and XYZ dimensions", () => {
    const handle = { view: { id: "volume" }, sampler: {}, width: 3, height: 4, depth: 5 };
    const { subject, resourceManager } = channels(handle, true);
    const pass = { channels: [volume] } as never;

    expect(subject.getChannelResources(pass)).toEqual([{
      slot: 2, textureView: handle.view, sampler: expect.anything(), width: 3, height: 4, depth: 5,
    }]);
    expect(subject.getChannelUniforms(pass)).toMatchObject({
      channelLoaded: [0, 0, 1, 0],
      channelResolution: [0, 0, 0, 0, 0, 0, 3, 4, 5, 0, 0, 0],
    });
    expect(resourceManager.getVolumeTexture).toHaveBeenCalledWith("density.ktx2", volume);
  });

  it("keeps an unavailable volume unbound and reports it unloaded", () => {
    const { subject } = channels(null, false);
    const pass = { channels: [volume] } as never;
    expect(subject.getChannelResources(pass)).toBeNull();
    expect(subject.getChannelUniforms(pass)).toMatchObject({
      channelLoaded: [0, 0, 0, 0],
      channelResolution: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    });
  });
});
