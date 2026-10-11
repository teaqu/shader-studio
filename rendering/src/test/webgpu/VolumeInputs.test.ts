import { wrapWgslImageSource, wrapWgslComputeSource } from "../../webgpu/WgslPrelude";
import { buildSlangBindingPlan, getSlangChannels } from "../../webgpu/SlangBindingPlan";
import { slangChannelLayoutEntries } from "../../webgpu/SlangBindingResources";
import { hasFileResources, resourceLayoutKey } from "../../webgpu/WebGPUCompileKeys";
import { describe, expect, it, vi } from "vitest";
import type { ShaderConfig } from "@shader-studio/types";
import { buildSlangPassGraph } from "../../webgpu/SlangPassGraph";
import { wrapSlangImageSource, wrapSlangComputeSource } from "../../webgpu/SlangPrelude";
import { WebGPUTextureBackend } from "../../webgpu/WebGPUTextureBackend";
import { ConfigValidator } from "../../util/ConfigValidator";

const config: ShaderConfig = { version: "1", passes: { Image: { inputs: { density: { type: "volume", path: "data.ktx2", resolved_path: "https://assets/data.ktx2", filter: "linear", wrap: "clamp" } } } } };
const graph = (value = config) => buildSlangPassGraph({ imageCode: "float4 mainImage(float2 p) { return sampleDensity(float3(p, 0.5)); }", config: value, buffers: {}, canvasWidth: 2, canvasHeight: 2 });
describe("volume input contracts", () => {
  it("validates and preserves volume paths and options in the graph", () => {
    expect(ConfigValidator.validateConfig(config).isValid).toBe(true);
    expect(graph().errors).toEqual([]);
    expect(graph().passes[0].channels).toEqual([{ kind: "volume", key: "density", slot: 0, path: "https://assets/data.ktx2", filter: "linear", wrap: "clamp" }]);
  });
  it.each([{ path: "", resolved_path: "" }, { filter: "mipmap" }, { wrap: "invalid" }])("rejects invalid volume options %j", options => {
    const invalid = structuredClone(config);
    Object.assign(invalid.passes.Image.inputs!.density, options);
    expect(ConfigValidator.validateConfig(invalid).isValid).toBe(false);
    expect(graph(invalid).errors.join(" ")).toContain("volume requires");
  });
  it("generates native 3D resources and three-dimensional metadata in both Slang stages", () => {
    const channels = [{ slot: 0, key: "density", kind: "volume" as const }];
    const fragment = wrapSlangImageSource("float4 mainImage(float2 p) { return density.SampleLevel(float3(p,0),0); }", { channels });
    const compute = wrapSlangComputeSource("void mainCompute(uint3 p) {}", { channels, workgroupSize: [1, 1, 1], outputLayers: 1, hasOutput: false });
    for (const source of [fragment, compute]) {
      expect(source).toContain("Texture3D<float4> _ssTexture0;");
      expect(source).toContain("property ShaderStudioChannel3D density");
      expect(source).toContain("result.size = uint3(_st.channelResolution[0]);");
      expect(source).toContain("float4 SampleLevel(float3 uv, float lod)");
      expect(source).toContain("texture.SampleLevel(sampling, uv, lod)");
    }
  });
});

describe("WebGPU volume upload", () => {
  function setup() {
    const texture = { createView: vi.fn(() => ({})), destroy: vi.fn() };
    const device = { limits: { maxTextureDimension3D: 16 }, createTexture: vi.fn(() => texture), createSampler: vi.fn(() => ({})), queue: { writeTexture: vi.fn() } };
    return { device, texture, backend: new WebGPUTextureBackend(device as unknown as GPUDevice) };
  }
  const volume = { width: 1, height: 2, depth: 3, channels: 1 as const, data: new Uint8Array([10, 20, 30, 40, 50, 60]) };
  it("uploads all depth slices with matching orientation and three-axis interpolation/wrapping", () => {
    const { device, texture, backend } = setup();
    expect(backend.createVolumeTexture(volume, "linear", "repeat")).toMatchObject({ width: 1, height: 2, depth: 3 });
    expect(device.createTexture).toHaveBeenCalledWith(expect.objectContaining({ dimension: "3d", size: { width: 1, height: 2, depthOrArrayLayers: 3 } }));
    expect(texture.createView).toHaveBeenCalledWith({ dimension: "3d" });
    const bytes = device.queue.writeTexture.mock.calls[0][1] as Uint8Array;
    expect(Array.from(bytes).filter((_, i) => i % 4 === 0)).toEqual([10, 20, 30, 40, 50, 60]);
    expect(device.queue.writeTexture).toHaveBeenCalledWith({ texture }, bytes, { bytesPerRow: 4, rowsPerImage: 2 }, { width: 1, height: 2, depthOrArrayLayers: 3 });
    expect(device.createSampler).toHaveBeenCalledWith({ minFilter: "linear", magFilter: "linear", addressModeU: "repeat", addressModeV: "repeat", addressModeW: "repeat" });
  });
  it("supports nearest/clamp and rejects dimensions exceeding the device limit", () => {
    const { device, backend } = setup();
    backend.createVolumeTexture(volume, "nearest", "clamp");
    expect(device.createSampler).toHaveBeenCalledWith(expect.objectContaining({ minFilter: "nearest", addressModeW: "clamp-to-edge" }));
    expect(() => backend.createVolumeTexture({ ...volume, depth: 17 }, "linear", "repeat")).toThrow("maxTextureDimension3D");
    expect(device.createTexture).toHaveBeenCalledTimes(1);
  });
  it("destroys partially allocated textures on upload failure", () => {
    const { device, texture, backend } = setup();
    device.queue.writeTexture.mockImplementationOnce(() => {
      throw new Error("upload failed");
    });
    expect(() => backend.createVolumeTexture(volume, "linear", "clamp")).toThrow("upload failed");
    expect(texture.destroy).toHaveBeenCalledOnce();
  });
});

describe("volume bindings shared by WGSL and Slang", () => {
  it("generates 3D WGSL declarations, loads and metadata in fragment and compute stages", () => {
    const channels = [{ slot: 0, key: "density", kind: "volume" as const }];
    const fragment = wrapWgslImageSource("fn mainImage(p: vec2f) -> vec4f { return densitySampleLevel(vec3f(p,0.5),0.0); }", { channels });
    const compute = wrapWgslComputeSource("@compute @workgroup_size(1) fn compute() {}", { channels, workgroupSize: [1,1,1], outputLayers: 1, hasOutput: false });
    for (const { source: code } of [fragment, compute]) {
      expect(code).toContain("texture_3d<f32>");
      expect(code).toContain("var<private> density: _ss_VolumeMetadata;");
      expect(code).toContain("fn densitySize() -> vec3<u32>");
      expect(code).toContain("fn densityLoad(pixel: vec3i)");
      expect(code).toContain("textureLoad(densityTexture, pixel, 0)");
      expect(code).toContain("vec3<u32>(_ss_u.channelResolution[0].xyz)");
    }
    expect(fragment.source).toContain("fn densitySample(uv: vec3<f32>)");
    expect(compute.source).not.toContain("fn densitySample(uv:");
  });
  it("deduplicates matching 3D resources while keeping dimensions and sampler variants separate", () => {
    const channels = getSlangChannels([
      { kind: "volume", slot: 0, key: "a", path: "density.ktx2" },
      { kind: "volume", slot: 1, key: "b", path: "density.ktx2", wrap: "clamp" },
      { kind: "texture", slot: 2, key: "flat", path: "density.ktx2" },
    ]);
    const plan = buildSlangBindingPlan(channels);
    expect(plan.textures).toHaveLength(2);
    expect(plan.channels[0].textureBinding).toBe(plan.channels[1].textureBinding);
    expect(plan.channels[0].samplerBinding).not.toBe(plan.channels[1].samplerBinding);
    expect(slangChannelLayoutEntries(plan, 4).find(entry => entry.texture?.viewDimension === "3d")).toBeDefined();
    const pass = graph().passes[0];
    expect(hasFileResources([pass])).toBe(true);
    const changed = { ...pass, channels: [{ kind: "volume" as const, slot: 0, key: "density", path: "other.ktx2" }] };
    expect(resourceLayoutKey([pass])).not.toBe(resourceLayoutKey([changed]));
  });
});
