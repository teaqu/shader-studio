import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GeometryConfig, ShaderConfig } from "@shader-studio/types";
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
  Object.assign(device, {
    createCommandEncoder: vi.fn(() => ({
      beginRenderPass: vi.fn(() => renderPass),
      finish: vi.fn(() => ({})),
    })),
  });
  return { engine, device, renderPass };
}

function config(geometry?: GeometryConfig): ShaderConfig {
  return {
    version: "1",
    passes: { Image: { inputs: {}, ...(geometry ? { geometry } : {}) } },
  };
}

/** iVertexCount from every ShaderToy uniform block written this frame. */
function writtenVertexCounts(device: ReturnType<typeof engineHarness>["device"]): number[] {
  return (device.queue.writeBuffer.mock.calls as unknown as [unknown, number, ArrayBuffer | ArrayBufferView][])
    .map(([, , data]) => data)
    .filter((data): data is ArrayBuffer => data instanceof ArrayBuffer && data.byteLength > UNIFORM_OFFSETS.iVertexCount)
    .map((data) => new DataView(data).getUint32(UNIFORM_OFFSETS.iVertexCount, true));
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
    expect(renderPass.drawIndexed).toHaveBeenCalledWith(36);
    expect(renderPass.draw).not.toHaveBeenCalled();
  });

  it.each(["triangle-list", "triangle-strip", "line-list", "line-strip", "point-list"] as const)(
    "builds a %s pipeline and draws the configured vertexCount",
    async (topology) => {
      const { engine, device, renderPass } = engineHarness(language);
      await engine.compileShaderPipeline("// image", config({ type: "fullscreen", vertexCount: 12, topology }), imagePath);

      engine.render(1000);

      expect(primitiveStates(device)).toEqual([{ topology }]);
      expect(renderPass.draw).toHaveBeenCalledTimes(1);
      expect(renderPass.draw).toHaveBeenCalledWith(12);
      expect(renderPass.drawIndexed).not.toHaveBeenCalled();
      expect(writtenVertexCounts(device)).toEqual([12]);
    },
  );

  it("asks the compiler to wrap the fullscreen corner index only for configured draws", async () => {
    const { engine } = engineHarness(language);
    const compile = (engine as unknown as { compiler: { compile: ReturnType<typeof vi.fn> } }).compiler.compile;

    await engine.compileShaderPipeline("// default", config(), imagePath);
    await engine.compileShaderPipeline("// count", config({ type: "fullscreen", vertexCount: 6 }), imagePath);
    await engine.compileShaderPipeline("// topology", config({ type: "fullscreen", topology: "point-list" }), imagePath);

    const options = compile.mock.calls.map(([, compileOptions]) => compileOptions as Record<string, unknown>);
    expect(options[0]).not.toHaveProperty("wrapFullscreenVertexIndex");
    expect(options[1]).toMatchObject({ wrapFullscreenVertexIndex: true });
    expect(options[2]).toMatchObject({ wrapFullscreenVertexIndex: true });
  });

  it("defaults to a 3-vertex triangle-list when only one field is configured", async () => {
    const counted = engineHarness(language);
    await counted.engine.compileShaderPipeline("// image", config({ type: "fullscreen", vertexCount: 2_147_483_647 }), imagePath);
    counted.engine.render(1000);
    expect(primitiveStates(counted.device)).toEqual([{ topology: "triangle-list" }]);
    expect(counted.renderPass.draw).toHaveBeenCalledWith(2_147_483_647);

    const pointed = engineHarness(language);
    await pointed.engine.compileShaderPipeline("// image", config({ type: "fullscreen", topology: "point-list" }), imagePath);
    pointed.engine.render(1000);
    expect(primitiveStates(pointed.device)).toEqual([{ topology: "point-list" }]);
    expect(pointed.renderPass.draw).toHaveBeenCalledWith(3);
    expect(writtenVertexCounts(pointed.device)).toEqual([3]);
  });

  it("rebuilds the pipeline when topology changes on hot reload", async () => {
    const { engine, device, renderPass } = engineHarness(language);
    await engine.compileShaderPipeline("// image", config({ type: "fullscreen", vertexCount: 6, topology: "triangle-strip" }), imagePath);
    await engine.compileShaderPipeline("// image", config({ type: "fullscreen", vertexCount: 6, topology: "line-strip" }), imagePath);

    engine.render(1000);

    expect(primitiveStates(device)).toEqual([{ topology: "triangle-strip" }, { topology: "line-strip" }]);
    expect(renderPass.draw).toHaveBeenCalledWith(6);
  });

  it("reuses the pipeline when only vertexCount changes, drawing the new count", async () => {
    const { engine, device, renderPass } = engineHarness(language);
    await engine.compileShaderPipeline("// image", config({ type: "fullscreen", vertexCount: 6, topology: "line-list" }), imagePath);
    await engine.compileShaderPipeline("// image", config({ type: "fullscreen", vertexCount: 10, topology: "line-list" }), imagePath);

    engine.render(1000);

    expect(primitiveStates(device)).toEqual([{ topology: "line-list" }]);
    expect(renderPass.draw).toHaveBeenCalledWith(10);
    expect(writtenVertexCounts(device)).toEqual([10]);
  });

  it("rebuilds when a pass gains or loses a draw config, since the wrapper source changes", async () => {
    const { engine, device } = engineHarness(language);
    await engine.compileShaderPipeline("// image", config(), imagePath);
    await engine.compileShaderPipeline("// image", config({ type: "fullscreen", vertexCount: 3 }), imagePath);
    await engine.compileShaderPipeline("// image", config({ type: "fullscreen" }), imagePath);

    expect(device.createRenderPipeline).toHaveBeenCalledTimes(3);
  });

  it("reports the captured pass's iVertexCount in capture uniforms", async () => {
    const { engine } = engineHarness(language);
    await engine.compileShaderPipeline("// image", config({ type: "fullscreen", vertexCount: 12, topology: "point-list" }), imagePath);

    expect(engine.getCaptureUniforms().vertexCount).toBe(12);
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
