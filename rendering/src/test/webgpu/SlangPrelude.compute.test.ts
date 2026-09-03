import { describe, expect, it } from "vitest";
import type { StorageBindingNode } from "../../types/PassGraph";
import {
  DISPATCH_UNIFORM_SIZE,
  getNativeComputeWorkgroupSize,
  getNativeComputeEntryPoint,
  getNativeComputeEntryPoints,
  wrapSlangComputeSource,
  wrapSlangImageSource,
} from "../../webgpu/SlangPrelude";

const computeSource = `[shader("compute")]
[numthreads(1, 1, 1)]
void computeKernel(uint3 tid : SV_DispatchThreadID) {}`;

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
  it("detects an author-owned numthreads compute entry point", () => {
    const source = `
      [shader("compute")]
      [numthreads(16, 8, 1)]
      void blurKernel(uint3 id : SV_DispatchThreadID) {}
    `;
    expect(getNativeComputeWorkgroupSize(source)).toEqual([16, 8, 1]);
    expect(getNativeComputeEntryPoint(source)).toEqual({ name: 'blurKernel', workgroupSize: [16, 8, 1] });
    expect(wrapSlangComputeSource(source, {
      workgroupSize: [8, 8, 1], outputLayers: 1, hasOutput: false,
    })).not.toContain("computeMainEntry");
  });

  it("discovers every annotated compute function in one source file", () => {
    expect(getNativeComputeEntryPoints(`
      [shader("compute")] [numthreads(64, 1, 1)] void clear(uint3 id : SV_DispatchThreadID) {}
      [shader("compute")] [numthreads(8, 8, 1)] void draw(uint3 id : SV_DispatchThreadID) {}
    `)).toEqual([
      { name: 'clear', workgroupSize: [64, 1, 1] },
      { name: 'draw', workgroupSize: [8, 8, 1] },
    ]);
  });
  it("does not generate an entry point for a legacy compute function", () => {
    const source = "void computeMain(uint3 tid) {}";
    const wrapped = wrapSlangComputeSource(source, {
      workgroupSize: [8, 4, 2],
      outputLayers: 0,
      hasOutput: false,
    });

    expect(wrapped).toContain(source);
    expect(wrapped).not.toContain("computeMainEntry");
  });

  it("keeps gradient sampling available in a compute pass", () => {
    const wrapped = wrapSlangComputeSource("void computeMain(uint3 tid) {}", {
      workgroupSize: [8, 8, 1],
      outputLayers: 0,
      hasOutput: false,
      channels: [{ slot: 0, key: "iChannel0" }],
    });

    // SampleGrad takes its derivatives as arguments, so it is legal here even
    // though implicit-LOD Sample is not.
    expect(wrapped).toContain("float4 sampleIChannel0Grad(float2 uv, float2 ddxUv, float2 ddyUv)");
    expect(wrapped).toContain(
      "return iChannel0.SampleGrad(iChannel0Sampler, float2(uv.x, 1.0 - uv.y), "
      + "float2(ddxUv.x, -ddxUv.y), float2(ddyUv.x, -ddyUv.y));",
    );
    expect(wrapped).toContain("float4 sampleIChannel0Lod(float2 uv, float lod)");
    expect(wrapped).toContain(
      "return iChannel0.SampleLevel(iChannel0Sampler, float2(uv.x, 1.0 - uv.y), lod);",
    );
  });

  it("allocates channel, storage, output, and dispatch bindings without conflicts", () => {
    const wrapped = wrapSlangComputeSource(computeSource, {
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
    expect(wrapped).toContain(
      '[[vk::binding(7, 0)]]\n[[vk::image_format("rgba16f")]]\nWTexture2D<float4> _outTex;',
    );
    expect(wrapped).toContain("[[vk::binding(8, 0)]]\nConstantBuffer<DispatchUniforms> _dsp;");
  });

  it("places one storage binding before output and dispatch with no channels", () => {
    const wrapped = wrapSlangComputeSource(computeSource, {
      storage: [builtinStorage],
      workgroupSize: [1, 1, 1],
      outputLayers: 1,
      hasOutput: true,
    });

    expect(wrapped).toContain("[[vk::binding(1, 0)]]\nRWStructuredBuffer<float4> positions;");
    expect(wrapped).toContain(
      '[[vk::binding(2, 0)]]\n[[vk::image_format("rgba16f")]]\nWTexture2D<float4> _outTex;',
    );
    expect(wrapped).toContain("[[vk::binding(3, 0)]]\nConstantBuffer<DispatchUniforms> _dsp;");
  });

  it("declares the sixteen-byte dispatch uniform and iDispatch macro", () => {
    const wrapped = wrapSlangComputeSource(computeSource, {
      workgroupSize: [1, 1, 1],
      outputLayers: 0,
      hasOutput: false,
    });

    expect(DISPATCH_UNIFORM_SIZE).toBe(16);
    expect(wrapped).toContain("int4 dispatch;");
    expect(wrapped).toContain("#define iDispatch (_dsp.dispatch.x)");
    expect(wrapped).not.toContain("int dispatchIndex;");
    expect(wrapped).not.toContain("int3 _dspPad;");
  });

  it("does not declare writeOutput or an output texture when output is disabled", () => {
    const wrapped = wrapSlangComputeSource(computeSource, {
      workgroupSize: [1, 1, 1],
      outputLayers: 0,
      hasOutput: false,
    });

    expect(wrapped).not.toContain("writeOutput");
    expect(wrapped).not.toContain("_outTex");
    expect(wrapped).toContain("[[vk::binding(1, 0)]]\nConstantBuffer<DispatchUniforms> _dsp;");
  });

  it("emits a Y-flipped, bounds-checked 2D output helper", () => {
    const wrapped = wrapSlangComputeSource(computeSource, {
      workgroupSize: [1, 1, 1],
      outputLayers: 1,
      hasOutput: true,
    });

    expect(wrapped).toContain('[[vk::image_format("rgba16f")]]');
    expect(wrapped).toContain("WTexture2D<float4> _outTex;");
    expect(wrapped).not.toContain("RWTexture2D");
    expect(wrapped).toContain("void writeOutput(uint2 coord, float4 color)");
    expect(wrapped).toContain("_outTex.GetDimensions(w, h);");
    expect(wrapped).toContain("if (coord.x >= w || coord.y >= h)");
    expect(wrapped).toContain("_outTex.Store(uint2(coord.x, h - 1 - coord.y), color);");
    expect(wrapped).not.toContain("_outTex[uint2");
  });

  it("emits a Y-flipped, bounds-checked array output helper", () => {
    const wrapped = wrapSlangComputeSource(computeSource, {
      workgroupSize: [1, 1, 1],
      outputLayers: 3,
      hasOutput: true,
    });

    expect(wrapped).toContain('[[vk::image_format("rgba16f")]]');
    expect(wrapped).toContain("WTexture2DArray<float4> _outTex;");
    expect(wrapped).not.toContain("RWTexture2DArray");
    expect(wrapped).toContain("void writeOutput(uint2 coord, uint layer, float4 color)");
    expect(wrapped).toContain("_outTex.GetDimensions(w, h, layers);");
    expect(wrapped).toContain("if (coord.x >= w || coord.y >= h || layer >= layers)");
    expect(wrapped).toContain(
      "_outTex.Store(uint3(coord.x, h - 1 - coord.y, layer), color);",
    );
    expect(wrapped).not.toContain("_outTex[uint3");
  });

  it("keeps built-in storage before common code and custom storage after it", () => {
    const wrapped = wrapSlangComputeSource(computeSource, {
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

  it("uses explicit LOD for 2D texture and buffer channels in compute helpers", () => {
    const wrapped = wrapSlangComputeSource(computeSource, {
      channels: [
        { slot: 1, key: "bufferChannel", kind: "buffer" },
        { slot: 0, key: "textureChannel", kind: "texture" },
      ],
      workgroupSize: [1, 1, 1],
      outputLayers: 0,
      hasOutput: false,
    });

    expect(wrapped).toContain(
      "textureChannel.SampleLevel(textureChannelSampler, float2(uv.x, 1.0 - uv.y), 0.0)",
    );
    expect(wrapped).toContain(
      "bufferChannel.SampleLevel(bufferChannelSampler, float2(uv.x, 1.0 - uv.y), 0.0)",
    );
    expect(wrapped).not.toContain(".Sample(");
  });

  it("uses explicit LOD for cubemap channels in compute helpers", () => {
    const wrapped = wrapSlangComputeSource(computeSource, {
      channels: [{ slot: 0, key: "cubeChannel", kind: "cubemap" }],
      workgroupSize: [1, 1, 1],
      outputLayers: 0,
      hasOutput: false,
    });

    expect(wrapped).toContain("cubeChannel.SampleLevel(cubeChannelSampler, dir, 0.0)");
    expect(wrapped).not.toContain(".Sample(");
  });

  it("retains implicit sampling in fragment channel helpers", () => {
    const wrapped = wrapSlangImageSource("float4 mainImage(float2 c) { return float4(0); }", {
      channels: [
        { slot: 0, key: "textureChannel", kind: "texture" },
        { slot: 1, key: "cubeChannel", kind: "cubemap" },
      ],
    });

    expect(wrapped).toContain(
      "textureChannel.Sample(textureChannelSampler, float2(uv.x, 1.0 - uv.y))",
    );
    expect(wrapped).toContain("cubeChannel.Sample(cubeChannelSampler, dir)");
    expect(wrapped).toContain("sampleIChannel0Vertex(float2 uv)");
    expect(wrapped).toContain("textureChannel.SampleLevel(textureChannelSampler");
    expect(wrapped).toContain("sampleIChannel0(float2 uv)");
  });

  it("puts #line directly above user source and the entry point after it", () => {
    const source = `[shader("compute")]\n[numthreads(1, 1, 1)]\nvoid dispatchKernel(uint3 tid : SV_DispatchThreadID) { int value = iDispatch; }`;
    const wrapped = wrapSlangComputeSource(source, {
      workgroupSize: [1, 1, 1],
      outputLayers: 0,
      hasOutput: false,
    });

    expect(wrapped).toContain(`#line 1\n${source}`);
    expect(wrapped).not.toContain("computeMainEntry");
  });
});
