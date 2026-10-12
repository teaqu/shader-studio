import { describe, expect, it, vi } from "vitest";
import type { RenderPassChannel } from "../../types/PassGraph";
import { WebGPUChannels } from "../../webgpu/WebGPUChannels";

const cubeChannel = (source: string, readFrom: "current-frame" | "previous-frame" = "current-frame"): RenderPassChannel => ({
  kind: "buffer", key: "sky", slot: 0, source, readFrom, outputKind: "cubemap",
});

function channelsHost(render = new Map(), compute = new Map(), width = 64, height = 32) {
  return {
    device: null,
    keyboardManager: {} as never,
    session: {
      passPipelines: render,
      computePipelines: compute,
      passGraph: [{ name: "Sky", width, height }],
      resourceManager: undefined,
    },
  } as never;
}

describe("WebGPUChannels cubemap buffer sources", () => {
  it("binds current and previous cube views from compute feedback without selecting an array layer", () => {
    const current = { id: "compute-current" } as unknown as GPUTextureView;
    const previous = { id: "compute-previous" } as unknown as GPUTextureView;
    const compute = {
      getCurrentCubemapOutputView: vi.fn(() => current),
      getPreviousCubemapOutputView: vi.fn(() => previous),
      getOutputSize: vi.fn(() => ({ width: 64, height: 32 })),
    };
    const channels = new WebGPUChannels(channelsHost(new Map(), new Map([["Sky", compute]])));
    const pass = { channels: [cubeChannel("Sky")] } as never;

    expect(channels.getChannelResources(pass, false, new Set(["Sky"]))).toEqual([
      { slot: 0, textureView: current, width: 64, height: 32 },
    ]);
    expect(channels.getChannelResources({ channels: [cubeChannel("Sky", "previous-frame")] } as never, false, new Set(["Sky"]))).toEqual([
      { slot: 0, textureView: previous, width: 64, height: 32 },
    ]);
    expect(compute.getCurrentCubemapOutputView).toHaveBeenCalled();
    expect(compute.getPreviousCubemapOutputView).toHaveBeenCalled();
  });

  it("uses render cube views for buffer uniforms and marks the channel loaded", () => {
    const current = { id: "render-current" } as unknown as GPUTextureView;
    const previous = { id: "render-previous" } as unknown as GPUTextureView;
    const render = {
      getCurrentCubemapOutputView: vi.fn(() => current),
      getPreviousCubemapOutputView: vi.fn(() => previous),
      getOutputSize: vi.fn(() => ({ width: 128, height: 96 })),
    };
    const channels = new WebGPUChannels(channelsHost(new Map([["Sky", render]]), new Map(), 128, 96));

    expect(channels.getChannelResources({ channels: [cubeChannel("Sky")] } as never)).toEqual([
      { slot: 0, textureView: current, width: 128, height: 96 },
    ]);
    const uniforms = channels.getChannelUniforms({ channels: [cubeChannel("Sky", "previous-frame")] } as never);
    expect(uniforms.channelLoaded[0]).toBe(1);
    expect(uniforms.channelResolution.slice(0, 3)).toEqual([128, 96, 1]);
    expect(render.getCurrentCubemapOutputView).toHaveBeenCalledWith(0);
    expect(render.getPreviousCubemapOutputView).toHaveBeenCalledWith(0);
  });
});
