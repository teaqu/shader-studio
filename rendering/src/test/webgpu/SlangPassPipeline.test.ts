import { describe, expect, it, vi } from "vitest";
import { SlangPassPipeline } from "../../webgpu/SlangPassPipeline";
import { SLANG_ENTRY_FRAGMENT, SLANG_ENTRY_VERTEX } from "../../webgpu/SlangPrelude";

function fakeDevice(compilationMessages: Array<{ type: string; lineNum: number; linePos: number; message: string }> = []) {
  const bindGroupLayout = {};
  const pipeline = {
    getBindGroupLayout: vi.fn(() => bindGroupLayout),
  };
  return {
    createShaderModule: vi.fn(() => ({
      getCompilationInfo: vi.fn(async () => ({ messages: compilationMessages })),
    })),
    createRenderPipeline: vi.fn(() => pipeline),
    createBuffer: vi.fn(() => ({ label: "uniform-buffer", destroy: vi.fn() })),
    createSampler: vi.fn(() => ({ label: "sampler" })),
    createBindGroup: vi.fn(() => ({ label: "bind-group" })),
    createTexture: vi.fn(() => ({
      createView: vi.fn(() => ({ label: "texture-view" })),
      destroy: vi.fn(),
    })),
  } as unknown as GPUDevice & {
    createShaderModule: ReturnType<typeof vi.fn>;
    createRenderPipeline: ReturnType<typeof vi.fn>;
    createBuffer: ReturnType<typeof vi.fn>;
    createSampler: ReturnType<typeof vi.fn>;
    createTexture: ReturnType<typeof vi.fn>;
    createBindGroup: ReturnType<typeof vi.fn>;
  };
}

describe("SlangPassPipeline", () => {
  it("creates a canvas pipeline without ping-pong textures", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 800,
      height: 600,
      output: "canvas",
      channels: [],
    });

    await pass.rebuild("// wgsl");

    expect(device.createRenderPipeline).toHaveBeenCalled();
    expect(device.createTexture).not.toHaveBeenCalled();
    expect(pass.getCurrentOutputView()).toBeNull();
  });

  it("creates ping-pong output textures for a buffer pass and swaps them", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "BufferA",
      width: 320,
      height: 180,
      output: "texture",
      channels: [],
    });

    await pass.rebuild("// wgsl");
    const before = pass.getCurrentOutputView();

    pass.swap();

    expect(device.createTexture).toHaveBeenCalledTimes(2);
    expect(before).not.toBe(pass.getCurrentOutputView());
  });

  it("returns null getters before rebuild has ever run", () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 800,
      height: 600,
      output: "canvas",
      channels: [],
    });

    expect(pass.getPipeline()).toBeNull();
    expect(pass.getBindGroup()).toBeNull();
    expect(pass.getUniformBuffer()).toBeNull();
    expect(pass.getCurrentOutputView()).toBeNull();
    expect(pass.getPreviousOutputView()).toBeNull();
  });

  it("exposes the created pipeline, bind group and uniform buffer after rebuild", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 800,
      height: 600,
      output: "canvas",
      channels: [],
    });

    await pass.rebuild("// wgsl");

    expect(pass.getPipeline()).toBe(device.createRenderPipeline.mock.results[0].value);
    expect(pass.getBindGroup()).toBe(device.createBindGroup.mock.results[0].value);
    expect(pass.getUniformBuffer()).toBe(device.createBuffer.mock.results[0].value);
  });

  it("wires the bind group to binding 0 with the uniform buffer via the pipeline's auto layout", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 800,
      height: 600,
      output: "canvas",
      channels: [],
    });

    await pass.rebuild("// wgsl");

    const pipelineResult = device.createRenderPipeline.mock.results[0].value;
    expect(pipelineResult.getBindGroupLayout).toHaveBeenCalledWith(0);

    const bindGroupCall = device.createBindGroup.mock.calls[0][0];
    expect(bindGroupCall.layout).toBe(pipelineResult.getBindGroupLayout.mock.results[0].value);
    expect(bindGroupCall.entries).toEqual([
      { binding: 0, resource: { buffer: pass.getUniformBuffer() } },
    ]);
  });

  it("creates a linear-filtering sampler on rebuild", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 800,
      height: 600,
      output: "canvas",
      channels: [],
    });

    await pass.rebuild("// wgsl");

    expect(device.createSampler).toHaveBeenCalledWith({ magFilter: "linear", minFilter: "linear" });
  });

  it("swap() is a safe no-op for a canvas pass with no ping-pong textures", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 800,
      height: 600,
      output: "canvas",
      channels: [],
    });

    await pass.rebuild("// wgsl");

    expect(() => pass.swap()).not.toThrow();
    expect(pass.getCurrentOutputView()).toBeNull();
    expect(pass.getPreviousOutputView()).toBeNull();
  });

  it("getPreviousOutputView returns the other ping-pong texture and tracks swaps", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "BufferA",
      width: 320,
      height: 180,
      output: "texture",
      channels: [],
    });

    await pass.rebuild("// wgsl");
    const [textureA, textureB] = device.createTexture.mock.results.map((r) => r.value);
    const currentBeforeSwap = pass.getCurrentOutputView();
    const previousBeforeSwap = pass.getPreviousOutputView();
    expect(previousBeforeSwap).not.toBe(currentBeforeSwap);
    expect(previousBeforeSwap).toBe(textureB.createView.mock.results[0].value);

    pass.swap();

    expect(pass.getCurrentOutputView()).toBe(textureB.createView.mock.results[1].value);
    expect(pass.getPreviousOutputView()).toBe(textureA.createView.mock.results[1].value);
  });

  it("destroys the previous ping-pong textures when rebuild runs again", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "BufferA",
      width: 320,
      height: 180,
      output: "texture",
      channels: [],
    });

    await pass.rebuild("// wgsl");
    const firstTextures = device.createTexture.mock.results.map((r) => r.value);

    await pass.rebuild("// wgsl v2");

    for (const texture of firstTextures) {
      expect(texture.destroy).toHaveBeenCalledTimes(1);
    }
    expect(device.createTexture).toHaveBeenCalledTimes(4);
  });

  it("dispose() destroys ping-pong textures and clears the output view", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "BufferA",
      width: 320,
      height: 180,
      output: "texture",
      channels: [],
    });

    await pass.rebuild("// wgsl");
    const textures = device.createTexture.mock.results.map((r) => r.value);

    pass.dispose();

    for (const texture of textures) {
      expect(texture.destroy).toHaveBeenCalledTimes(1);
    }
    expect(pass.getCurrentOutputView()).toBeNull();
    expect(pass.getPreviousOutputView()).toBeNull();
  });

  it("dispose() is a safe no-op for a canvas pass with no textures", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 800,
      height: 600,
      output: "canvas",
      channels: [],
    });

    await pass.rebuild("// wgsl");

    expect(() => pass.dispose()).not.toThrow();
  });

  it("updateDescriptor changes the size used for textures created by the next rebuild", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "BufferA",
      width: 320,
      height: 180,
      output: "texture",
      channels: [],
    });

    await pass.rebuild("// wgsl");
    pass.updateDescriptor({
      name: "BufferA",
      width: 640,
      height: 360,
      output: "texture",
      channels: [],
    });
    await pass.rebuild("// wgsl v2");

    const lastCall = device.createTexture.mock.calls[device.createTexture.mock.calls.length - 1][0];
    expect(lastCall.size).toEqual({ width: 640, height: 360 });
  });

  it("destroys the uniform buffer on dispose()", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 800,
      height: 600,
      output: "canvas",
      channels: [],
    });

    await pass.rebuild("// wgsl");
    const uniformBuffer = device.createBuffer.mock.results[0].value;

    pass.dispose();

    expect(uniformBuffer.destroy).toHaveBeenCalledTimes(1);
    expect(pass.getUniformBuffer()).toBeNull();
  });

  it("destroys the old uniform buffer when rebuild replaces it", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 800,
      height: 600,
      output: "canvas",
      channels: [],
    });

    await pass.rebuild("// wgsl");
    const firstBuffer = device.createBuffer.mock.results[0].value;

    await pass.rebuild("// wgsl v2");

    expect(firstBuffer.destroy).toHaveBeenCalledTimes(1);
    const secondBuffer = device.createBuffer.mock.results[1].value;
    expect(pass.getUniformBuffer()).toBe(secondBuffer);
    expect(secondBuffer.destroy).not.toHaveBeenCalled();
  });

  it("dispose() before any rebuild is a safe no-op", () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 800,
      height: 600,
      output: "canvas",
      channels: [],
    });

    expect(() => pass.dispose()).not.toThrow();
  });

  it("passes the exact WGSL source to createShaderModule", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 800,
      height: 600,
      output: "canvas",
      channels: [],
    });

    const wgsl = "// the exact wgsl source\nfn main() {}";
    await pass.rebuild(wgsl);

    expect(device.createShaderModule).toHaveBeenCalledWith({ code: wgsl });
  });

  it("configures the render pipeline with the Slang entry points and constructor format", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "rgba16float", {
      name: "Image",
      width: 800,
      height: 600,
      output: "canvas",
      channels: [],
    });

    await pass.rebuild("// wgsl");

    const pipelineDescriptor = device.createRenderPipeline.mock.calls[0][0];
    expect(pipelineDescriptor.layout).toBe("auto");
    expect(pipelineDescriptor.vertex.module).toBe(device.createShaderModule.mock.results[0].value);
    expect(pipelineDescriptor.vertex.entryPoint).toBe(SLANG_ENTRY_VERTEX);
    expect(pipelineDescriptor.fragment.module).toBe(device.createShaderModule.mock.results[0].value);
    expect(pipelineDescriptor.fragment.entryPoint).toBe(SLANG_ENTRY_FRAGMENT);
    expect(pipelineDescriptor.fragment.targets).toEqual([{ format: "rgba16float" }]);
    expect(pipelineDescriptor.primitive).toEqual({ topology: "triangle-list" });
  });

  it("maps compilation errors to formatted messages and filters out non-error messages", async () => {
    const device = fakeDevice([
      { type: "warning", lineNum: 3, linePos: 2, message: "unused variable" },
      { type: "error", lineNum: 10, linePos: 5, message: "undeclared identifier 'foo'" },
    ]);
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 800,
      height: 600,
      output: "canvas",
      channels: [],
    });

    const errors = await pass.rebuild("// wgsl");

    expect(errors).toEqual(["Image: WGSL L10:5 undeclared identifier 'foo'"]);
  });

  it("returns an empty error list when compilation has no messages", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 800,
      height: 600,
      output: "canvas",
      channels: [],
    });

    const errors = await pass.rebuild("// wgsl");

    expect(errors).toEqual([]);
  });
});
