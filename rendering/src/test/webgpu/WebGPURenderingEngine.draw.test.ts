import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GeometryConfig, RenderPassSettings, ShaderConfig } from "@shader-studio/types";
import { WebGPURenderingEngine } from "../../webgpu/WebGPURenderingEngine";
import { sharedSlangWgslCache } from "../../webgpu/SlangWgslCache";
import { UNIFORM_OFFSETS } from "../../webgpu/SlangPrelude";

const assets = { scriptUrl: "slang.js", wasmUrl: "slang.wasm" };

function engineHarness(language: "slang" | "wgsl") {
  const device = {
    limits: {},
    createShaderModule: vi.fn(() => ({
      getCompilationInfo: vi.fn(async () => ({ messages: [] })),
    })),
    createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: vi.fn(() => ({})) })),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
    createSampler: vi.fn(() => ({})),
    createBindGroup: vi.fn(() => ({})),
    createTexture: vi.fn(() => ({
      createView: vi.fn(() => ({})),
      destroy: vi.fn(),
    })),
    queue: {
      writeBuffer: vi.fn(),
      writeTexture: vi.fn(),
      submit: vi.fn(),
    },
    pushErrorScope: vi.fn(),
    popErrorScope: vi.fn(async () => null),
  };
  const compiler = {
    compile: vi.fn(async () => ({ success: true as const, wgsl: "// wgsl" })),
    dispose: vi.fn(),
  };
  const engine = new WebGPURenderingEngine(assets, language);
  const internals = engine as unknown as {
    canvas: { width: number; height: number };
    device: GPUDevice;
    compiler: typeof compiler;
    format: GPUTextureFormat;
    context: GPUCanvasContext;
  };
  internals.canvas = { width: 320, height: 180 };
  internals.device = device as unknown as GPUDevice;
  internals.compiler = compiler;
  internals.format = "bgra8unorm";
  internals.context = {
    getCurrentTexture: () => ({ createView: () => ({ label: "canvas-view" }) }),
  } as unknown as GPUCanvasContext;

  const renderPass = {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    setVertexBuffer: vi.fn(),
    setIndexBuffer: vi.fn(),
    draw: vi.fn(),
    drawIndexed: vi.fn(),
    end: vi.fn(),
  };
  const beginRenderPass = vi.fn((_descriptor: GPURenderPassDescriptor) => renderPass);
  Object.assign(device, {
    createCommandEncoder: vi.fn(() => ({
      beginRenderPass,
      finish: vi.fn(() => ({})),
    })),
  });
  return { engine, device, renderPass, beginRenderPass };
}

function config(geometry?: GeometryConfig, settings: RenderPassSettings = {}): ShaderConfig {
  return {
    version: "1",
    passes: { Image: { inputs: {}, ...(geometry ? { geometry } : {}), ...settings } },
  };
}

function pipelineDescriptors(device: ReturnType<typeof engineHarness>["device"]): GPURenderPipelineDescriptor[] {
  return (device.createRenderPipeline.mock.calls as unknown as [GPURenderPipelineDescriptor][]).map(([descriptor]) => descriptor);
}

/** iVertexCount from every ShaderToy uniform block written this frame. */
function writtenVertexCounts(device: ReturnType<typeof engineHarness>["device"]): number[] {
  return (device.queue.writeBuffer.mock.calls as unknown as [unknown, number, ArrayBuffer | ArrayBufferView][])
    .map(([, , data]) => data)
    .filter((data): data is ArrayBuffer => data instanceof ArrayBuffer && data.byteLength > UNIFORM_OFFSETS.iVertexCount)
    .map((data) => new DataView(data).getUint32(UNIFORM_OFFSETS.iVertexCount, true));
}

function writtenInstanceCounts(device: ReturnType<typeof engineHarness>["device"]): number[] {
  return (device.queue.writeBuffer.mock.calls as unknown as [unknown, number, ArrayBuffer | ArrayBufferView][])
    .map(([, , data]) => data)
    .filter((data): data is ArrayBuffer => data instanceof ArrayBuffer && data.byteLength > UNIFORM_OFFSETS.iVertexCount)
    .map((data) => new DataView(data).getUint32(UNIFORM_OFFSETS.iVertexCount + 4, true));
}

function primitiveStates(device: ReturnType<typeof engineHarness>["device"]): GPUPrimitiveState[] {
  return (device.createRenderPipeline.mock.calls as unknown as [GPURenderPipelineDescriptor][])
    .map(([descriptor]) => descriptor.primitive!);
}

describe.each(["slang", "wgsl"] as const)("WebGPURenderingEngine draw calls (%s)", (language) => {
  const imagePath = language === "wgsl" ? "/image.wgsl" : "/image.slang";

  beforeEach(() => {
    sharedSlangWgslCache.clear();
  });

  it("draws a fullscreen pass as one three-vertex triangle list", async () => {
    const { engine, device, renderPass } = engineHarness(language);
    await engine.compileShaderPipeline("// image", config(), imagePath);

    engine.render(1000);

    expect(primitiveStates(device)).toEqual([{ topology: "triangle-list" }]);
    expect(renderPass.draw).toHaveBeenCalledTimes(1);
    expect(renderPass.draw).toHaveBeenCalledWith(3);
    expect(renderPass.drawIndexed).not.toHaveBeenCalled();
    expect(renderPass.setVertexBuffer).not.toHaveBeenCalled();
  });

  it("uses the configured pass clear colour", async () => {
    const { engine, beginRenderPass } = engineHarness(language);
    await engine.compileShaderPipeline("// image", config(undefined, { clear: [0.25, 0.5, 0.75, 0.5] }), imagePath);

    engine.render(1000);

    expect(beginRenderPass.mock.calls[0][0].colorAttachments?.[0]).toMatchObject({
      clearValue: { r: 0.25, g: 0.5, b: 0.75, a: 0.5 },
      loadOp: "clear",
    });
  });

  it("treats explicit fullscreen geometry like the default", async () => {
    const { engine, renderPass } = engineHarness(language);
    await engine.compileShaderPipeline("// image", config({ type: "fullscreen" }), imagePath);

    engine.render(1000);

    expect(renderPass.draw).toHaveBeenCalledWith(3);
  });

  it("keeps mesh passes indexed", async () => {
    const { engine, device, renderPass } = engineHarness(language);
    const mesh = { vertexBuffer: { id: "vb" }, indexBuffer: { id: "ib" }, indexFormat: "uint16", indexCount: 36 };
    (engine as unknown as { meshResources: unknown }).meshResources = {
      get: vi.fn(() => mesh),
      getModel: vi.fn(),
      dispose: vi.fn(),
    };
    await engine.compileShaderPipeline("// image", config({ type: "cube" }), imagePath);

    engine.render(1000);

    expect(primitiveStates(device)).toEqual([{ topology: "triangle-list" }]);
    expect(renderPass.setVertexBuffer).toHaveBeenCalledWith(0, mesh.vertexBuffer);
    expect(renderPass.setIndexBuffer).toHaveBeenCalledWith(mesh.indexBuffer, "uint16");
    expect(renderPass.drawIndexed).toHaveBeenCalledWith(36, 1);
    expect(renderPass.draw).not.toHaveBeenCalled();
  });

  it("builds the fullscreen pipeline without depth, culling or blending", async () => {
    const { engine, device, beginRenderPass } = engineHarness(language);
    await engine.compileShaderPipeline("// image", config(), imagePath);

    engine.render(1000);

    const [descriptor] = pipelineDescriptors(device);
    expect(descriptor.depthStencil).toBeUndefined();
    expect(descriptor.primitive).toEqual({ topology: "triangle-list" });
    expect(descriptor.fragment!.targets).toEqual([{ format: "bgra8unorm" }]);
    expect(beginRenderPass.mock.calls[0][0]).not.toHaveProperty("depthStencilAttachment");
  });

  it.each(["triangle-list", "triangle-strip", "line-list", "line-strip", "point-list"] as const)(
    "builds a %s vertices pipeline with no vertex buffers and draws the configured vertexCount",
    async (topology) => {
      const { engine, device, renderPass } = engineHarness(language);
      await engine.compileShaderPipeline("// image", config({ type: "vertices", vertexCount: 12, topology }), imagePath);

      engine.render(1000);

      expect(primitiveStates(device)).toEqual([{ topology }]);
      expect(pipelineDescriptors(device)[0].vertex).not.toHaveProperty("buffers");
      expect(renderPass.draw).toHaveBeenCalledTimes(1);
      expect(renderPass.draw).toHaveBeenCalledWith(12, 1);
      expect(renderPass.drawIndexed).not.toHaveBeenCalled();
      expect(renderPass.setVertexBuffer).not.toHaveBeenCalled();
      expect(writtenVertexCounts(device)).toEqual([12]);
    },
  );

  it("defaults a vertices pass to a 3-vertex triangle list in world space", async () => {
    const { engine, device, renderPass } = engineHarness(language);
    await engine.compileShaderPipeline("// image", config({ type: "vertices" }), imagePath);

    engine.render(1000);

    expect(primitiveStates(device)).toEqual([{ topology: "triangle-list" }]);
    expect(renderPass.draw).toHaveBeenCalledWith(3, 1);
    expect(writtenVertexCounts(device)).toEqual([3]);
  });

  it("draws the maximum vertexCount", async () => {
    const { engine, renderPass } = engineHarness(language);
    await engine.compileShaderPipeline("// image", config({ type: "vertices", vertexCount: 2_147_483_647 }), imagePath);

    engine.render(1000);

    expect(renderPass.draw).toHaveBeenCalledWith(2_147_483_647, 1);
  });

  it("asks the compiler for the vertices space and only for vertices geometry", async () => {
    const { engine } = engineHarness(language);
    const compile = (engine as unknown as { compiler: { compile: ReturnType<typeof vi.fn> } }).compiler.compile;

    await engine.compileShaderPipeline("// fullscreen", config(), imagePath);
    await engine.compileShaderPipeline("// world", config({ type: "vertices" }), imagePath);
    await engine.compileShaderPipeline("// clip", config({ type: "vertices", space: "clip" }), imagePath);

    const options = compile.mock.calls.map(([, compileOptions]) => compileOptions as Record<string, unknown>);
    expect(options[0]).not.toHaveProperty("vertexSpace");
    expect(options[0]).not.toHaveProperty("geometry");
    expect(options[1]).toMatchObject({ geometry: "vertices", vertexSpace: "world" });
    expect(options[2]).toMatchObject({ geometry: "vertices", vertexSpace: "clip" });
  });

  it("writes camera uniforms and attaches depth for world-space vertices", async () => {
    const { engine, device, beginRenderPass } = engineHarness(language);
    await engine.compileShaderPipeline("// image", config({ type: "vertices" }), imagePath);

    engine.render(1000);

    const meshWrites = device.queue.writeBuffer.mock.calls.filter((call) => (call as unknown[])[2] instanceof Float32Array && ((call as unknown[])[2] as Float32Array).length === 64);
    expect(meshWrites).toHaveLength(1);
    expect(pipelineDescriptors(device)[0].depthStencil).toEqual({ format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" });
    expect(beginRenderPass.mock.calls[0][0].depthStencilAttachment).toMatchObject({ depthLoadOp: "clear", depthClearValue: 1 });
  });

  it("skips camera uniforms but keeps a depth attachment, tested with always, for clip-space vertices", async () => {
    const { engine, device, beginRenderPass } = engineHarness(language);
    await engine.compileShaderPipeline("// image", config({ type: "vertices", space: "clip" }), imagePath);

    engine.render(1000);

    const meshWrites = device.queue.writeBuffer.mock.calls.filter((call) => (call as unknown[])[2] instanceof Float32Array && ((call as unknown[])[2] as Float32Array).length === 64);
    expect(meshWrites).toHaveLength(0);
    expect(pipelineDescriptors(device)[0].depthStencil).toEqual({ format: "depth24plus", depthWriteEnabled: true, depthCompare: "always" });
    expect(beginRenderPass.mock.calls[0][0]).toHaveProperty("depthStencilAttachment");
  });

  it.each([
    ["alpha", { color: { operation: "add", srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" }, alpha: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" } }],
    ["premultiplied", { color: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" }, alpha: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" } }],
    ["additive", { color: { operation: "add", srcFactor: "one", dstFactor: "one" }, alpha: { operation: "add", srcFactor: "one", dstFactor: "one" } }],
  ] as const)("sets ColorTargetState.blend for %s on fullscreen and vertices", async (blend, state) => {
    for (const geometry of [undefined, { type: "vertices" } as const]) {
      const { engine, device } = engineHarness(language);
      await engine.compileShaderPipeline("// image", config(geometry, { blend }), imagePath);

      expect(pipelineDescriptors(device)[0].fragment!.targets).toEqual([{ format: "bgra8unorm", blend: state }]);
    }
  });

  it.each([
    ["never"], ["less"], ["equal"], ["less-equal"], ["greater"], ["not-equal"], ["greater-equal"], ["always"],
  ] as const)("bakes depth compare %s and write off into the pipeline", async (compare) => {
    const { engine, device } = engineHarness(language);
    await engine.compileShaderPipeline("// image", config({ type: "sphere" }, { depth: { compare, write: false } }), imagePath);

    expect(pipelineDescriptors(device)[0].depthStencil).toEqual({ format: "depth24plus", depthWriteEnabled: false, depthCompare: compare });
  });

  it.each([
    [{ compare: "greater" }, 0],
    [{ compare: "greater-equal" }, 0],
    [{ compare: "greater", test: false }, 1],
    [{}, 1],
  ] as const)("clears the depth attachment for %j to %d", async (depth, clearValue) => {
    const { engine, beginRenderPass } = engineHarness(language);
    await engine.compileShaderPipeline("// image", config({ type: "vertices" }, { depth }), imagePath);

    engine.render(1000);

    expect(beginRenderPass.mock.calls[0][0].depthStencilAttachment).toMatchObject({ depthClearValue: clearValue });
  });

  it("tests with always when the depth test is off, keeping writes", async () => {
    const { engine, device } = engineHarness(language);
    await engine.compileShaderPipeline("// image", config({ type: "cube" }, { depth: { test: false, compare: "greater" } }), imagePath);

    expect(pipelineDescriptors(device)[0].depthStencil).toEqual({ format: "depth24plus", depthWriteEnabled: true, depthCompare: "always" });
  });

  it.each(["back", "front"] as const)("culls %s faces with ccw front faces", async (cull) => {
    for (const geometry of [{ type: "cube" } as const, { type: "vertices", space: "clip" } as const]) {
      const { engine, device } = engineHarness(language);
      await engine.compileShaderPipeline("// image", config(geometry, { cull }), imagePath);

      expect(pipelineDescriptors(device)[0].primitive).toEqual({ topology: "triangle-list", cullMode: cull, frontFace: "ccw" });
    }
  });

  it("omits cullMode for cull none", async () => {
    const { engine, device } = engineHarness(language);
    await engine.compileShaderPipeline("// image", config({ type: "cube" }, { cull: "none" }), imagePath);

    expect(pipelineDescriptors(device)[0].primitive).toEqual({ topology: "triangle-list" });
  });

  it.each([
    ["topology", { type: "vertices", vertexCount: 6, topology: "triangle-strip" }, {}, { type: "vertices", vertexCount: 6, topology: "line-strip" }, {}],
    ["space", { type: "vertices", vertexCount: 6 }, {}, { type: "vertices", vertexCount: 6, space: "clip" }, {}],
    ["blend", { type: "vertices" }, {}, { type: "vertices" }, { blend: "additive" }],
    ["fullscreen blend", undefined, { blend: "alpha" }, undefined, { blend: "premultiplied" }],
    ["depth test", { type: "cube" }, {}, { type: "cube" }, { depth: { test: false } }],
    ["depth write", { type: "vertices" }, {}, { type: "vertices" }, { depth: { write: false } }],
    ["depth compare", { type: "vertices" }, { depth: { compare: "less" } }, { type: "vertices" }, { depth: { compare: "greater" } }],
    ["cull", { type: "cube" }, { cull: "back" }, { type: "cube" }, { cull: "front" }],
  ] as const)("rebuilds the pipeline when %s changes on hot reload", async (_field, firstGeometry, firstSettings, nextGeometry, nextSettings) => {
    const meshResources = {
      get: vi.fn(() => ({ vertexBuffer: {}, indexBuffer: {}, indexFormat: "uint16", indexCount: 36, vertexCount: 24 })),
      getModel: vi.fn(),
      dispose: vi.fn(),
    };
    const { engine, device } = engineHarness(language);
    (engine as unknown as { meshResources: unknown }).meshResources = meshResources;
    await engine.compileShaderPipeline("// image", config(firstGeometry as GeometryConfig | undefined, firstSettings as RenderPassSettings), imagePath);
    await engine.compileShaderPipeline("// image", config(nextGeometry as GeometryConfig | undefined, nextSettings as RenderPassSettings), imagePath);

    expect(device.createRenderPipeline).toHaveBeenCalledTimes(2);
  });

  it("reuses the pipeline when only vertexCount changes, drawing the new count", async () => {
    const { engine, device, renderPass } = engineHarness(language);
    const settings = { blend: "additive", depth: { write: false }, cull: "back" } as const;
    await engine.compileShaderPipeline("// image", config({ type: "vertices", vertexCount: 6, topology: "line-list" }, settings), imagePath);
    await engine.compileShaderPipeline("// image", config({ type: "vertices", vertexCount: 10, topology: "line-list" }, settings), imagePath);

    engine.render(1000);

    expect(device.createRenderPipeline).toHaveBeenCalledTimes(1);
    expect(renderPass.draw).toHaveBeenCalledWith(10, 1);
    expect(writtenVertexCounts(device)).toEqual([10]);
  });

  it("draws every instance of a vertices pass and writes iInstanceCount", async () => {
    const { engine, device, renderPass } = engineHarness(language);
    await engine.compileShaderPipeline("// image", config({ type: "vertices", vertexCount: 6, instanceCount: 40 }), imagePath);

    engine.render(1000);

    expect(renderPass.draw).toHaveBeenCalledWith(6, 40);
    expect(writtenVertexCounts(device)).toEqual([6]);
    expect(writtenInstanceCounts(device)).toEqual([40]);
  });

  it("draws every instance of an indexed mesh pass", async () => {
    const { engine, device, renderPass } = engineHarness(language);
    const mesh = { vertexBuffer: { id: "vb" }, indexBuffer: { id: "ib" }, indexFormat: "uint16", indexCount: 36, vertexCount: 24 };
    (engine as unknown as { meshResources: unknown }).meshResources = { get: vi.fn(() => mesh), getModel: vi.fn(), dispose: vi.fn() };
    await engine.compileShaderPipeline("// image", config({ type: "cube", instanceCount: 7 }), imagePath);

    engine.render(1000);

    expect(renderPass.drawIndexed).toHaveBeenCalledWith(36, 7);
    expect(writtenInstanceCounts(device)).toEqual([7]);
  });

  it("writes one instance for fullscreen passes", async () => {
    const { engine, device, renderPass } = engineHarness(language);
    await engine.compileShaderPipeline("// image", config(), imagePath);

    engine.render(1000);

    expect(renderPass.draw).toHaveBeenCalledWith(3);
    expect(writtenInstanceCounts(device)).toEqual([1]);
  });

  it("reuses the pipeline when only instanceCount changes, drawing the new count", async () => {
    const { engine, device, renderPass } = engineHarness(language);
    await engine.compileShaderPipeline("// image", config({ type: "vertices", vertexCount: 6, instanceCount: 2 }), imagePath);
    await engine.compileShaderPipeline("// image", config({ type: "vertices", vertexCount: 6, instanceCount: 9 }), imagePath);

    engine.render(1000);

    expect(device.createRenderPipeline).toHaveBeenCalledTimes(1);
    expect(renderPass.draw).toHaveBeenCalledWith(6, 9);
    expect(writtenInstanceCounts(device)).toEqual([9]);
  });

  it("reuses the pipeline when a setting is spelled out at its default", async () => {
    const { engine, device } = engineHarness(language);
    await engine.compileShaderPipeline("// image", config({ type: "vertices" }), imagePath);
    await engine.compileShaderPipeline("// image", config(
      { type: "vertices", topology: "triangle-list", space: "world" },
      { blend: "none", clear: [0, 0, 0, 1], depth: { test: true, write: true, compare: "less" }, cull: "none" },
    ), imagePath);

    expect(device.createRenderPipeline).toHaveBeenCalledTimes(1);
  });

  it("rebuilds when a pass switches between fullscreen and vertices", async () => {
    const { engine, device } = engineHarness(language);
    await engine.compileShaderPipeline("// image", config(), imagePath);
    await engine.compileShaderPipeline("// image", config({ type: "vertices", vertexCount: 3 }), imagePath);
    await engine.compileShaderPipeline("// image", config({ type: "fullscreen" }), imagePath);

    expect(device.createRenderPipeline).toHaveBeenCalledTimes(3);
  });

  it("reports the captured pass's iVertexCount in capture uniforms", async () => {
    const vertices = engineHarness(language);
    await vertices.engine.compileShaderPipeline("// image", config({ type: "vertices", vertexCount: 12, topology: "point-list" }), imagePath);
    expect(vertices.engine.getCaptureUniforms().vertexCount).toBe(12);

    const fullscreen = engineHarness(language);
    await fullscreen.engine.compileShaderPipeline("// image", config(), imagePath);
    expect(fullscreen.engine.getCaptureUniforms().vertexCount).toBe(3);
  });

  it("reports the captured pass's iInstanceCount in capture uniforms", async () => {
    const vertices = engineHarness(language);
    await vertices.engine.compileShaderPipeline("// image", config({ type: "vertices", instanceCount: 8 }), imagePath);
    expect(vertices.engine.getCaptureUniforms().instanceCount).toBe(8);

    const fullscreen = engineHarness(language);
    await fullscreen.engine.compileShaderPipeline("// image", config(), imagePath);
    expect(fullscreen.engine.getCaptureUniforms().instanceCount).toBe(1);
  });

  it.each([
    [false, "rgba16float", true],
    [true, "rgba32float", false],
  ] as const)("renders a blended buffer into the right format when float32-blendable is %s", async (blendable, format, warns) => {
    const { engine, device } = engineHarness(language);
    Object.assign(device, { features: new Set(blendable ? ["float32-filterable", "float32-blendable"] : ["float32-filterable"]) });
    const bufferConfig: ShaderConfig = {
      version: "1",
      passes: {
        Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA" } } },
        BufferA: { path: `a.${language}`, blend: "additive" },
      },
    };

    const result = await engine.compileShaderPipeline("// image", bufferConfig, imagePath, { BufferA: "// buffer" });

    const warning = "BufferA: renders into rgba16float because rgba32float blending is unavailable on this device";
    expect(result.success).toBe(true);
    expect((result.warnings ?? []).includes(warning)).toBe(warns);
    const targets = pipelineDescriptors(device).map((descriptor) => descriptor.fragment!.targets![0]!.format);
    expect(targets).toContain(format);
  });

  it("writes iVertexCount 3 for an unconfigured fullscreen pass", async () => {
    const { engine, device } = engineHarness(language);
    await engine.compileShaderPipeline("// image", config(), imagePath);

    engine.render(1000);

    expect(writtenVertexCounts(device)).toEqual([3]);
  });

  it("writes the mesh vertex count as iVertexCount, or 0 while a model is loading", async () => {
    const cube = engineHarness(language);
    (cube.engine as unknown as { meshResources: unknown }).meshResources = {
      get: vi.fn(() => ({ vertexBuffer: {}, indexBuffer: {}, indexFormat: "uint16", indexCount: 36, vertexCount: 24 })),
      getModel: vi.fn(),
      dispose: vi.fn(),
    };
    await cube.engine.compileShaderPipeline("// image", config({ type: "cube" }), imagePath);
    cube.engine.render(1000);
    expect(writtenVertexCounts(cube.device)).toEqual([24]);

    const model = engineHarness(language);
    (model.engine as unknown as { meshResources: unknown }).meshResources = {
      get: vi.fn(),
      getModel: vi.fn(() => undefined),
      dispose: vi.fn(),
      loadModel: vi.fn(async () => undefined),
    };
    await model.engine.compileShaderPipeline("// image", config({ type: "model", path: "robot.glb", resolved_path: "https://x/robot.glb" }), imagePath);
    model.engine.render(1000);
    expect(writtenVertexCounts(model.device)).toEqual([0]);
    expect(model.renderPass.drawIndexed).not.toHaveBeenCalled();
    expect(model.renderPass.draw).not.toHaveBeenCalled();
  });
});
