import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GeometryConfig, ShaderConfig } from "@shader-studio/types";
import { WebGPURenderingEngine } from "../../webgpu/WebGPURenderingEngine";
import { sharedSlangWgslCache } from "../../webgpu/SlangWgslCache";

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
});
