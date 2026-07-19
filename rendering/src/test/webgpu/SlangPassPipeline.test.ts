import { describe, expect, it, vi } from "vitest";
import { SlangPassPipeline } from "../../webgpu/SlangPassPipeline";
import { SLANG_ENTRY_FRAGMENT, SLANG_ENTRY_VERTEX } from "../../webgpu/SlangPrelude";

function fakeDevice(compilationMessages: Array<{ type: string; lineNum: number; linePos: number; message: string }> = []) {
  const pipeline = {
    getBindGroupLayout: vi.fn(() => ({})),
  };
  return {
    createShaderModule: vi.fn(() => ({
      getCompilationInfo: vi.fn(async () => ({ messages: compilationMessages })),
    })),
    createRenderPipeline: vi.fn(() => pipeline),
    createBindGroupLayout: vi.fn(() => ({ label: "bind-group-layout" })),
    createPipelineLayout: vi.fn(() => ({ label: "pipeline-layout" })),
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
    createBindGroupLayout: ReturnType<typeof vi.fn>;
    createPipelineLayout: ReturnType<typeof vi.fn>;
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
    expect(pass.getOutputSize()).toEqual({ width: 800, height: 600 });

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

  it("wires the bind group to binding 0 with the uniform buffer via the explicit layout", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 800,
      height: 600,
      output: "canvas",
      channels: [],
    });

    await pass.rebuild("// wgsl");

    const bindGroupCall = device.createBindGroup.mock.calls[0][0];
    expect(bindGroupCall.layout).toBe(device.createBindGroupLayout.mock.results[0].value);
    expect(bindGroupCall.entries).toEqual([
      { binding: 0, resource: { buffer: pass.getUniformBuffer() } },
    ]);
  });

  it("creates an explicit bind group layout covering the uniform and every declared channel", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 320,
      height: 180,
      output: "canvas",
      channels: [
        { slot: 0, key: "iChannel0" },
        { slot: 1, key: "iChannel1" },
      ],
    });

    await pass.rebuild("// wgsl");

    // With layout:"auto" a shader that declares but never statically uses a
    // channel would get a layout WITHOUT those bindings, and the bind group
    // (which always supplies them) would silently fail validation. The
    // explicit layout is derived from the descriptor instead.
    expect(device.createBindGroupLayout).toHaveBeenCalledWith({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      ],
    });
  });

  it("uses cube texture layout entries for cubemap channels", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 320,
      height: 180,
      output: "canvas",
      channels: [
        { slot: 0, key: "iChannel0", kind: "cubemap" },
        { slot: 1, key: "iChannel1" },
      ],
    });

    await pass.rebuild("// wgsl");

    expect(device.createBindGroupLayout).toHaveBeenCalledWith({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float", viewDimension: "cube" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      ],
    });
  });

  it("creates the render pipeline with the explicit pipeline layout, not \"auto\"", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 320,
      height: 180,
      output: "canvas",
      channels: [{ slot: 0, key: "iChannel0" }],
    });

    await pass.rebuild("// wgsl");

    expect(device.createPipelineLayout).toHaveBeenCalledWith({
      bindGroupLayouts: [device.createBindGroupLayout.mock.results[0].value],
    });
    const pipelineDescriptor = device.createRenderPipeline.mock.calls[0][0];
    expect(pipelineDescriptor.layout).toBe(device.createPipelineLayout.mock.results[0].value);
    expect(pipelineDescriptor.layout).not.toBe("auto");
  });

  it("does not create a bind group at rebuild time for a pass with channels", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 320,
      height: 180,
      output: "canvas",
      channels: [{ slot: 0, key: "iChannel0" }],
    });

    await pass.rebuild("// wgsl");

    // The explicit layout declares channel bindings, so a uniform-only bind
    // group would be invalid; the full one is built per frame by
    // rebuildBindGroup once channel views are known.
    expect(device.createBindGroup).not.toHaveBeenCalled();
    expect(pass.getBindGroup()).toBeNull();
  });

  it("rebuildBindGroup builds the bind group against the explicit layout", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 320,
      height: 180,
      output: "canvas",
      channels: [{ slot: 0, key: "iChannel0" }],
    });

    await pass.rebuild("// wgsl");
    pass.rebuildBindGroup([{ slot: 0, textureView: { label: "view" } as unknown as GPUTextureView }]);

    const call = device.createBindGroup.mock.calls.at(-1)![0];
    expect(call.layout).toBe(device.createBindGroupLayout.mock.results[0].value);
    const pipelineResult = device.createRenderPipeline.mock.results[0].value;
    expect(pipelineResult.getBindGroupLayout).not.toHaveBeenCalled();
  });

  it("creates buffer pass ping-pong textures and render targets in rgba16float", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "BufferA",
      width: 320,
      height: 180,
      output: "texture",
      channels: [],
    });

    await pass.rebuild("// wgsl");

    // Feedback state must not be clamped/quantized by the canvas format.
    const pipelineDescriptor = device.createRenderPipeline.mock.calls[0][0];
    expect(pipelineDescriptor.fragment.targets).toEqual([{ format: "rgba16float" }]);
    for (const [descriptor] of device.createTexture.mock.calls) {
      expect(descriptor.format).toBe("rgba16float");
    }
  });

  it("keeps the canvas format for canvas-output passes", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 320,
      height: 180,
      output: "canvas",
      channels: [],
    });

    await pass.rebuild("// wgsl");

    const pipelineDescriptor = device.createRenderPipeline.mock.calls[0][0];
    expect(pipelineDescriptor.fragment.targets).toEqual([{ format: "bgra8unorm" }]);
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

  it("resize() recreates ping-pong textures at the new size without recompiling", async () => {
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

    pass.resize(640, 360);
    expect(pass.getOutputSize()).toEqual({ width: 640, height: 360 });

    for (const texture of firstTextures) {
      expect(texture.destroy).toHaveBeenCalledTimes(1);
    }
    expect(device.createTexture).toHaveBeenCalledTimes(4);
    const newCalls = device.createTexture.mock.calls.slice(2);
    for (const [descriptor] of newCalls) {
      expect(descriptor.size).toEqual({ width: 640, height: 360 });
    }
    // No shader/pipeline recompilation happened.
    expect(device.createShaderModule).toHaveBeenCalledTimes(1);
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(1);
  });

  it("resize() with an unchanged size does not recreate textures", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "BufferA",
      width: 320,
      height: 180,
      output: "texture",
      channels: [],
    });

    await pass.rebuild("// wgsl");

    pass.resize(320, 180);

    expect(device.createTexture).toHaveBeenCalledTimes(2);
    for (const result of device.createTexture.mock.results) {
      expect(result.value.destroy).not.toHaveBeenCalled();
    }
  });

  it("resize() on a canvas pass updates the descriptor without creating textures", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 320,
      height: 180,
      output: "canvas",
      channels: [],
    });

    await pass.rebuild("// wgsl");

    expect(() => pass.resize(640, 360)).not.toThrow();
    expect(device.createTexture).not.toHaveBeenCalled();
  });

  it("resize() before rebuild is safe and the next rebuild uses the new size", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "BufferA",
      width: 320,
      height: 180,
      output: "texture",
      channels: [],
    });

    pass.resize(640, 360);
    await pass.rebuild("// wgsl");

    expect(device.createTexture).toHaveBeenCalledTimes(2);
    for (const [descriptor] of device.createTexture.mock.calls) {
      expect(descriptor.size).toEqual({ width: 640, height: 360 });
    }
  });

  it("preserves the old descriptor, views, and textures when the first resize allocation throws", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "BufferA",
      width: 320,
      height: 180,
      output: "texture",
      channels: [],
    });
    await pass.rebuild("// wgsl");
    const originalTextures = device.createTexture.mock.results.map((result) => result.value);
    const stableView = { label: "stable-original-view" };
    originalTextures[0].createView.mockReturnValue(stableView);
    const originalCurrentView = pass.getCurrentOutputView();
    device.createTexture.mockImplementationOnce(() => {
      throw new Error("first resize allocation failed");
    });

    expect(() => pass.resize(640, 360)).toThrow("first resize allocation failed");

    expect(pass.getCurrentOutputView()).toBe(originalCurrentView);
    expect(originalTextures.every((texture) => texture.destroy.mock.calls.length === 0)).toBe(true);
    const callsAfterFailure = device.createTexture.mock.calls.length;
    pass.resize(320, 180);
    expect(device.createTexture).toHaveBeenCalledTimes(callsAfterFailure);
  });

  it("destroys a partial resize allocation while preserving old resources when the second allocation throws", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "BufferA",
      width: 320,
      height: 180,
      output: "texture",
      channels: [],
    });
    await pass.rebuild("// wgsl");
    const originalTextures = device.createTexture.mock.results.map((result) => result.value);
    const stableView = { label: "stable-original-view" };
    originalTextures[0].createView.mockReturnValue(stableView);
    const originalCurrentView = pass.getCurrentOutputView();
    const partialTexture = {
      createView: vi.fn(() => ({ label: "partial-view" })),
      destroy: vi.fn(),
    };
    device.createTexture
      .mockImplementationOnce(() => partialTexture)
      .mockImplementationOnce(() => {
        throw new Error("second resize allocation failed");
      });

    expect(() => pass.resize(640, 360)).toThrow("second resize allocation failed");

    expect(partialTexture.destroy).toHaveBeenCalledTimes(1);
    expect(pass.getCurrentOutputView()).toBe(originalCurrentView);
    expect(originalTextures.every((texture) => texture.destroy.mock.calls.length === 0)).toBe(true);
    const callsAfterFailure = device.createTexture.mock.calls.length;
    pass.resize(320, 180);
    expect(device.createTexture).toHaveBeenCalledTimes(callsAfterFailure);
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
    expect(pass.getPipeline()).toBeNull();
    expect(pass.getBindGroup()).toBeNull();
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
    expect(pipelineDescriptor.layout).toBe(device.createPipelineLayout.mock.results[0].value);
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

  it("adds channel texture and sampler entries after the uniform binding", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 320,
      height: 180,
      output: "canvas",
      channels: [{ slot: 0, key: "iChannel0" }],
    });

    await pass.rebuild("// wgsl");
    pass.rebuildBindGroup([{ slot: 0, textureView: { label: "buffer-view" } as unknown as GPUTextureView }]);

    const entries = (device.createBindGroup as any).mock.calls.at(-1)[0].entries;
    expect(entries.map((entry: { binding: number }) => entry.binding)).toEqual([0, 1, 2]);
  });

  it("binds a lone slot-2 channel densely at bindings 1/2, not at its slot number", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 320,
      height: 180,
      output: "canvas",
      channels: [{ slot: 2, key: "iChannel2" }],
    });

    await pass.rebuild("// wgsl");
    const textureView = { label: "buffer-view" } as unknown as GPUTextureView;
    pass.rebuildBindGroup([{ slot: 2, textureView }]);

    const call = (device.createBindGroup as any).mock.calls.at(-1)[0];
    expect(call.entries).toEqual([
      { binding: 0, resource: { buffer: pass.getUniformBuffer() } },
      { binding: 1, resource: textureView },
      { binding: 2, resource: (device.createSampler as any).mock.results[0].value },
    ]);
  });

  it("rebuildBindGroup is a safe no-op before rebuild has ever run", () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 320,
      height: 180,
      output: "canvas",
      channels: [{ slot: 0, key: "iChannel0" }],
    });

    expect(() => pass.rebuildBindGroup([{ slot: 0, textureView: {} as GPUTextureView }])).not.toThrow();
    expect(device.createBindGroup).not.toHaveBeenCalled();
  });

  it("rebuilds the bind group with the sampler shared across multiple channel slots", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 320,
      height: 180,
      output: "canvas",
      channels: [
        { slot: 0, key: "iChannel0" },
        { slot: 1, key: "iChannel1" },
      ],
    });

    await pass.rebuild("// wgsl");
    const viewA = { label: "view-a" } as unknown as GPUTextureView;
    const viewB = { label: "view-b" } as unknown as GPUTextureView;
    // Pass resources out of slot order to verify rebuildBindGroup sorts by slot.
    pass.rebuildBindGroup([
      { slot: 1, textureView: viewB },
      { slot: 0, textureView: viewA },
    ]);

    const entries = (device.createBindGroup as any).mock.calls.at(-1)[0].entries;
    const sampler = (device.createSampler as any).mock.results[0].value;
    expect(entries).toEqual([
      { binding: 0, resource: { buffer: pass.getUniformBuffer() } },
      { binding: 1, resource: viewA },
      { binding: 2, resource: sampler },
      { binding: 3, resource: viewB },
      { binding: 4, resource: sampler },
    ]);
    // Both sampler entries are the SAME sampler instance created by rebuild().
    const samplerA = entries.find((entry: { binding: number }) => entry.binding === 2).resource;
    const samplerB = entries.find((entry: { binding: number }) => entry.binding === 4).resource;
    expect(samplerA).toBe(samplerB);
    expect(samplerA).toBe(sampler);
  });

  it("binds a channel's own sampler when provided, shared sampler otherwise", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 8,
      height: 8,
      output: "canvas",
      channels: [
        { slot: 0, key: "iChannel0" },
        { slot: 1, key: "iChannel1" },
      ],
    });

    await pass.rebuild("stub wgsl");
    const ownSampler = { own: true } as unknown as GPUSampler;
    const view0 = { v: 0 } as unknown as GPUTextureView;
    const view1 = { v: 1 } as unknown as GPUTextureView;
    pass.rebuildBindGroup([
      { slot: 1, textureView: view1 }, // buffer-style: shared sampler
      { slot: 0, textureView: view0, sampler: ownSampler }, // texture-style: own sampler
    ]);

    const entries = (device.createBindGroup as any).mock.calls.at(-1)[0].entries;
    // slot-sorted: bindings 1/2 are slot 0, bindings 3/4 are slot 1
    expect(entries[1]).toEqual({ binding: 1, resource: view0 });
    expect(entries[2]).toEqual({ binding: 2, resource: ownSampler });
    expect(entries[3]).toEqual({ binding: 3, resource: view1 });
    expect(entries[4].binding).toBe(4);
    expect(entries[4].resource).not.toBe(ownSampler); // shared linear sampler
  });

  describe("async pipeline creation", () => {
    it("prefers createRenderPipelineAsync when the device provides it", async () => {
      const device = fakeDevice();
      const asyncPipeline = { label: "async-pipeline" };
      (device as any).createRenderPipelineAsync = vi.fn(async () => asyncPipeline);

      const pass = new SlangPassPipeline(device, "bgra8unorm", {
        name: "Image",
        width: 800,
        height: 600,
        output: "canvas",
        channels: [],
      });
      const errors = await pass.rebuild("// wgsl");

      expect(errors).toEqual([]);
      expect((device as any).createRenderPipelineAsync).toHaveBeenCalledTimes(1);
      expect(device.createRenderPipeline).not.toHaveBeenCalled();
      expect(pass.getPipeline()).toBe(asyncPipeline);
    });

    it("maps an async creation rejection to a pass-prefixed error instead of throwing", async () => {
      const device = fakeDevice();
      (device as any).createRenderPipelineAsync = vi.fn(async () => {
        throw new Error("pipeline validation failed");
      });

      const pass = new SlangPassPipeline(device, "bgra8unorm", {
        name: "BufferA",
        width: 320,
        height: 180,
        output: "canvas",
        channels: [],
      });
      const errors = await pass.rebuild("// wgsl");

      expect(errors).toEqual(["BufferA: pipeline validation failed"]);
      expect(pass.getPipeline()).toBeNull();
      expect(device.createBuffer).not.toHaveBeenCalled(); // no resources built after failure
    });

    it("falls back to synchronous createRenderPipeline when async is unavailable", async () => {
      const device = fakeDevice(); // no createRenderPipelineAsync
      const pass = new SlangPassPipeline(device, "bgra8unorm", {
        name: "Image",
        width: 800,
        height: 600,
        output: "canvas",
        channels: [],
      });
      const errors = await pass.rebuild("// wgsl");

      expect(errors).toEqual([]);
      expect(device.createRenderPipeline).toHaveBeenCalledTimes(1);
      expect(pass.getPipeline()).not.toBeNull();
    });
  });
});
