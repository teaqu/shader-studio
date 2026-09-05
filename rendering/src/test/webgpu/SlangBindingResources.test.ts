import { describe, expect, it, vi } from "vitest";
import { buildSlangBindingPlan, getSlangChannels } from "../../webgpu/SlangBindingPlan";
import { slangChannelLayoutEntries, slangChannelResourceEntries } from "../../webgpu/SlangBindingResources";
import { getWebGPUSampler } from "../../webgpu/WebGPUSamplerCache";
import { wrapSlangComputeSource, wrapSlangImageSource } from "../../webgpu/SlangPrelude";

const channels = getSlangChannels([
  { kind: "texture", slot: 0, key: "a", path: "a" },
  { kind: "texture", slot: 5, key: "b", path: "b" },
  { kind: "texture", slot: 9, key: "c", path: "a", wrap: "clamp" },
]);
const plan = buildSlangBindingPlan(channels);

describe("Slang shared resource bindings", () => {
  it("uses independent texture and sampler bindings at every shader visibility", () => {
    for (const visibility of [1, 2, 3, 4]) {
      expect(slangChannelLayoutEntries(plan, visibility)).toEqual([
        { binding: 1, visibility, texture: { sampleType: "float" } },
        { binding: 2, visibility, sampler: { type: "filtering" } },
        { binding: 3, visibility, texture: { sampleType: "float" } },
        { binding: 4, visibility, sampler: { type: "filtering" } },
      ]);
    }
  });
  it("binds one entry per unique resource and requires every logical input", () => {
    const a = {} as GPUTextureView, b = {} as GPUTextureView;
    const repeat = {} as GPUSampler, clamp = {} as GPUSampler;
    const resources = [
      { slot: 9, textureView: a, sampler: clamp },
      { slot: 5, textureView: b, sampler: repeat },
      { slot: 0, textureView: a, sampler: repeat },
    ];
    expect(slangChannelResourceEntries(plan, resources, null)).toEqual([
      { binding: 1, resource: a }, { binding: 2, resource: repeat },
      { binding: 3, resource: b }, { binding: 4, resource: clamp },
    ]);
    expect(slangChannelResourceEntries(plan, resources.slice(1), repeat)).toBeNull();
    expect(slangChannelResourceEntries(plan, resources.map(({ slot, textureView }) => ({ slot, textureView })), null)).toBeNull();
    expect(slangChannelResourceEntries(buildSlangBindingPlan([]), [], null)).toEqual([]);
  });
  it("resolves replacement views without renumbering aliases or merging temporary fallbacks", () => {
    const sampler = {} as GPUSampler;
    const fallback = {} as GPUTextureView, replacement = {} as GPUTextureView;
    const before = slangChannelResourceEntries(plan, channels.map(c => ({ slot: c.slot, textureView: fallback })), sampler)!;
    const after = slangChannelResourceEntries(plan, channels.map(c => ({ slot: c.slot, textureView: c.slot === 5 ? replacement : fallback })), sampler)!;
    expect(before.map(e => e.binding)).toEqual(after.map(e => e.binding));
    expect(after.find(e => e.binding === 3)?.resource).toBe(replacement);
    expect(after.find(e => e.binding === 1)?.resource).toBe(fallback);
  });
  it("emits only unique declarations and keeps per-slot metadata for aliases", () => {
    const source = wrapSlangImageSource("float4 mainImage(float2 p) { return inputs.c.Sample(p); }", { channels });
    expect(source.match(/\[\[vk::binding\(\d+, 0\)\]\]\nTexture2D/g)).toHaveLength(2);
    expect(source.match(/\[\[vk::binding\(\d+, 0\)\]\]\nSamplerState/g)).toHaveLength(2);
    expect(source).toContain("_st.channelResolution[9]");
    expect(source).toContain("_st.channelTime[9]");
    expect(source).toContain("_st.channelLoaded[9]");
  });
  it("places storage, capture, mesh, compute output and dispatch after unique channel bindings", () => {
    const storage = [{ name: "data", binding: 0, elementType: "float", builtin: true, count: 1, stride: 4 }];
    const options = { channels, storage };
    const capture = wrapSlangImageSource("", { ...options, captureMode: true });
    expect(capture).toContain("[[vk::binding(5, 0)]]\nStructuredBuffer<float> data");
    expect(capture).toContain("[[vk::binding(6, 0)]]\nConstantBuffer<DbgCaptureUniforms>");
    expect(wrapSlangImageSource("", { ...options, geometry: "sphere" })).toContain("[[vk::binding(6, 0)]]\nConstantBuffer<MeshUniforms>");
    for (const hasOutput of [false, true]) {
      const compute = wrapSlangComputeSource("", { ...options, workgroupSize: [1, 1, 1], outputLayers: 1, hasOutput });
      expect(compute).toContain("[[vk::binding(5, 0)]]\nRWStructuredBuffer<float> data");
      expect(compute).toContain(`[[vk::binding(${hasOutput ? 7 : 6}, 0)]]\nConstantBuffer<DispatchUniforms>`);
      if (hasOutput) {
        expect(compute).toContain('[[vk::binding(6, 0)]]\n[[vk::image_format("rgba16f")]]');
      }
    }
  });
});

describe("WebGPU sampler cache", () => {
  it("shares equivalent settings only within a device, preserving filter and wrap differences", () => {
    const createSampler = vi.fn(() => ({} as GPUSampler));
    const device = { createSampler } as unknown as GPUDevice;
    const linear = getWebGPUSampler(device, "linear", "clamp");
    expect(getWebGPUSampler(device, "linear", "clamp")).toBe(linear);
    expect(getWebGPUSampler(device, "nearest", "clamp")).not.toBe(linear);
    expect(getWebGPUSampler(device, "linear", "repeat")).not.toBe(linear);
    expect(getWebGPUSampler(device, "mipmap", "clamp")).not.toBe(linear);
    expect(getWebGPUSampler({ createSampler } as unknown as GPUDevice, "linear", "clamp")).not.toBe(linear);
    expect(createSampler).toHaveBeenCalledTimes(5);
    expect(createSampler).toHaveBeenCalledWith({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge", mipmapFilter: "linear" });
  });
});
