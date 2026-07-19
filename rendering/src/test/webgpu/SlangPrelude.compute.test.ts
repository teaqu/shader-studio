import { describe, expect, it } from "vitest";
import type { StorageBindingNode } from "../../types/PassGraph";
import {
  DISPATCH_UNIFORM_SIZE,
  SLANG_ENTRY_COMPUTE,
  wrapSlangComputeSource,
} from "../../webgpu/SlangPrelude";

const builtinStorage: StorageBindingNode = {
  name: "positions",
  binding: 0,
  elementType: "float4",
  builtin: true,
  count: 64,
  stride: 16,
};

const customStorage: StorageBindingNode = {
  name: "particles",
  binding: 1,
  elementType: "Particle",
  builtin: false,
  count: 64,
  stride: 32,
};

describe("wrapSlangComputeSource", () => {
  it("generates the configured compute entry point", () => {
    const wrapped = wrapSlangComputeSource("void computeMain(uint3 tid) {}", {
      workgroupSize: [8, 4, 2],
      outputLayers: 0,
      hasOutput: false,
    });

    expect(SLANG_ENTRY_COMPUTE).toBe("computeMainEntry");
    expect(wrapped).toContain('[shader("compute")]');
    expect(wrapped).toContain("[numthreads(8, 4, 2)]");
    expect(wrapped).toContain("void computeMainEntry(uint3 tid : SV_DispatchThreadID)");
    expect(wrapped).toContain("computeMain(tid);");
  });

  it("allocates channel, storage, output, and dispatch bindings without conflicts", () => {
    const wrapped = wrapSlangComputeSource("void computeMain(uint3 tid) {}", {
      channels: [
        { slot: 2, key: "iChannel2" },
        { slot: 0, key: "iChannel0" },
      ],
      storage: [builtinStorage, customStorage],
      workgroupSize: [1, 1, 1],
      outputLayers: 1,
      hasOutput: true,
    });

    for (const binding of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(wrapped.match(new RegExp(`\\[\\[vk::binding\\(${binding}, 0\\)\\]`, "g"))).toHaveLength(1);
    }
    expect(wrapped).toContain("[[vk::binding(1, 0)]]\nTexture2D<float4> iChannel0;");
    expect(wrapped).toContain("[[vk::binding(2, 0)]]\nSamplerState iChannel0Sampler;");
    expect(wrapped).toContain("[[vk::binding(3, 0)]]\nTexture2D<float4> iChannel2;");
    expect(wrapped).toContain("[[vk::binding(4, 0)]]\nSamplerState iChannel2Sampler;");
    expect(wrapped).toContain("[[vk::binding(5, 0)]]\nRWStructuredBuffer<float4> positions;");
    expect(wrapped).toContain("[[vk::binding(6, 0)]]\nRWStructuredBuffer<Particle> particles;");
    expect(wrapped).toContain("[[vk::binding(7, 0)]]\nRWTexture2D<float4> _outTex;");
    expect(wrapped).toContain("[[vk::binding(8, 0)]]\nConstantBuffer<DispatchUniforms> _dsp;");
  });

  it("places one storage binding before output and dispatch with no channels", () => {
    const wrapped = wrapSlangComputeSource("void computeMain(uint3 tid) {}", {
      storage: [builtinStorage],
      workgroupSize: [1, 1, 1],
      outputLayers: 1,
      hasOutput: true,
    });

    expect(wrapped).toContain("[[vk::binding(1, 0)]]\nRWStructuredBuffer<float4> positions;");
    expect(wrapped).toContain("[[vk::binding(2, 0)]]\nRWTexture2D<float4> _outTex;");
    expect(wrapped).toContain("[[vk::binding(3, 0)]]\nConstantBuffer<DispatchUniforms> _dsp;");
  });

  it("declares the sixteen-byte dispatch uniform and iDispatch macro", () => {
    const wrapped = wrapSlangComputeSource("void computeMain(uint3 tid) {}", {
      workgroupSize: [1, 1, 1],
      outputLayers: 0,
      hasOutput: false,
    });

    expect(DISPATCH_UNIFORM_SIZE).toBe(16);
    expect(wrapped).toContain("int dispatchIndex;");
    expect(wrapped).toContain("int3 _dspPad;");
    expect(wrapped).toContain("#define iDispatch (_dsp.dispatchIndex)");
  });

  it("does not declare writeOutput or an output texture when output is disabled", () => {
    const wrapped = wrapSlangComputeSource("void computeMain(uint3 tid) {}", {
      workgroupSize: [1, 1, 1],
      outputLayers: 0,
      hasOutput: false,
    });

    expect(wrapped).not.toContain("writeOutput");
    expect(wrapped).not.toContain("_outTex");
    expect(wrapped).toContain("[[vk::binding(1, 0)]]\nConstantBuffer<DispatchUniforms> _dsp;");
  });

  it("emits a Y-flipped, bounds-checked 2D output helper", () => {
    const wrapped = wrapSlangComputeSource("void computeMain(uint3 tid) {}", {
      workgroupSize: [1, 1, 1],
      outputLayers: 1,
      hasOutput: true,
    });

    expect(wrapped).toContain("RWTexture2D<float4> _outTex;");
    expect(wrapped).toContain("void writeOutput(uint2 coord, float4 color)");
    expect(wrapped).toContain("_outTex.GetDimensions(w, h);");
    expect(wrapped).toContain("if (coord.x >= w || coord.y >= h)");
    expect(wrapped).toContain("_outTex[uint2(coord.x, h - 1 - coord.y)] = color;");
  });

  it("emits a Y-flipped, bounds-checked array output helper", () => {
    const wrapped = wrapSlangComputeSource("void computeMain(uint3 tid) {}", {
      workgroupSize: [1, 1, 1],
      outputLayers: 3,
      hasOutput: true,
    });

    expect(wrapped).toContain("RWTexture2DArray<float4> _outTex;");
    expect(wrapped).toContain("void writeOutput(uint2 coord, uint layer, float4 color)");
    expect(wrapped).toContain("_outTex.GetDimensions(w, h, layers);");
    expect(wrapped).toContain("if (coord.x >= w || coord.y >= h || layer >= layers)");
    expect(wrapped).toContain("_outTex[uint3(coord.x, h - 1 - coord.y, layer)] = color;");
  });

  it("keeps built-in storage before common code and custom storage after it", () => {
    const wrapped = wrapSlangComputeSource("void computeMain(uint3 tid) {}", {
      commonCode: "struct Particle { float4 position; };",
      storage: [builtinStorage, customStorage],
      workgroupSize: [1, 1, 1],
      outputLayers: 0,
      hasOutput: false,
    });

    expect(wrapped.indexOf("RWStructuredBuffer<float4> positions;")).toBeLessThan(
      wrapped.indexOf("struct Particle"),
    );
    expect(wrapped.indexOf("struct Particle")).toBeLessThan(
      wrapped.indexOf("RWStructuredBuffer<Particle> particles;"),
    );
  });

  it("puts #line directly above user source and the entry point after it", () => {
    const source = "void computeMain(uint3 tid) { int value = iDispatch; }";
    const wrapped = wrapSlangComputeSource(source, {
      workgroupSize: [1, 1, 1],
      outputLayers: 0,
      hasOutput: false,
    });

    expect(wrapped).toContain(`#line 1\n${source}`);
    expect(wrapped.indexOf(source)).toBeLessThan(wrapped.indexOf("void computeMainEntry"));
  });
});
