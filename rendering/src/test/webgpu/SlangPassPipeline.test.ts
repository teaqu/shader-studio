import { describe, expect, it, vi } from "vitest";
import type { StorageBindingNode } from "../../types/PassGraph";
import { SlangPassPipeline } from "../../webgpu/SlangPassPipeline";
import { SLANG_ENTRY_FRAGMENT, SLANG_ENTRY_VERTEX } from "../../webgpu/SlangPrelude";

function fakeDevice(compilationMessages: Array<{ type: string; lineNum: number; linePos: number; message: string }> = []) {
  const pipeline = {
    getBindGroupLayout: vi.fn(() => ({})),
  };
  const encoder = {
    copyTextureToTexture: vi.fn(),
    finish: vi.fn(() => ({ label: "copy-command" })),
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
    createCommandEncoder: vi.fn(() => encoder),
    queue: { submit: vi.fn() },
    pushErrorScope: vi.fn(),
    popErrorScope: vi.fn(async () => null),
  } as unknown as GPUDevice & {
    createShaderModule: ReturnType<typeof vi.fn>;
    createRenderPipeline: ReturnType<typeof vi.fn>;
    createBindGroupLayout: ReturnType<typeof vi.fn>;
    createPipelineLayout: ReturnType<typeof vi.fn>;
    createBuffer: ReturnType<typeof vi.fn>;
    createSampler: ReturnType<typeof vi.fn>;
    createTexture: ReturnType<typeof vi.fn>;
    createBindGroup: ReturnType<typeof vi.fn>;
    createCommandEncoder: ReturnType<typeof vi.fn>;
    queue: { submit: ReturnType<typeof vi.fn> };
    pushErrorScope: ReturnType<typeof vi.fn>;
    popErrorScope: ReturnType<typeof vi.fn>;
  };
}

const storageA: StorageBindingNode = {
  name: "positions",
  binding: 0,
  elementType: "float4",
  builtin: true,
  count: 64,
  stride: 16,
};

const storageB: StorageBindingNode = {
  name: "particles",
  binding: 1,
  elementType: "Particle",
  builtin: false,
  count: 32,
  stride: 32,
};

describe("SlangPassPipeline", () => {
  it("creates a canvas pipeline without ping-pong textures", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 800,
      height: 600,
      output: "canvas",
      storage: [],
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
      storage: [],
      channels: [],
    });

    await pass.rebuild("// wgsl");
    const before = pass.getCurrentOutputView();

    pass.swap();

    expect(device.createTexture).toHaveBeenCalledTimes(2);
    expect(before).not.toBe(pass.getCurrentOutputView());
  });

  it("precreates stable current and previous buffer views across reads and swaps", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "BufferA",
      width: 320,
      height: 180,
      output: "texture",
      storage: [],
      channels: [],
    });

    await pass.rebuild("// wgsl");

    const textures = device.createTexture.mock.results.map((result) => result.value);
    expect(textures.map((texture) => texture.createView.mock.calls.length)).toEqual([1, 1]);
    const current = pass.getCurrentOutputView();
    const previous = pass.getPreviousOutputView();
    expect(pass.getCurrentOutputView()).toBe(current);
    expect(pass.getPreviousOutputView()).toBe(previous);

    pass.swap();

    expect(pass.getCurrentOutputView()).toBe(previous);
    expect(pass.getPreviousOutputView()).toBe(current);
    expect(textures.map((texture) => texture.createView.mock.calls.length)).toEqual([1, 1]);
  });

  it("replaces cached buffer views only after a successful resize", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "BufferA",
      width: 320,
      height: 180,
      output: "texture",
      storage: [],
      channels: [],
    });
    await pass.rebuild("// wgsl");
    const originalCurrent = pass.getCurrentOutputView();

    pass.resize(640, 360);

    const nextTextures = device.createTexture.mock.results.slice(2).map((result) => result.value);
    expect(pass.getCurrentOutputView()).not.toBe(originalCurrent);
    expect(nextTextures.map((texture) => texture.createView.mock.calls.length)).toEqual([1, 1]);
    expect(pass.getCurrentOutputView()).toBe(pass.getCurrentOutputView());
  });

  it("uses a negotiated rgba32float format for buffer targets", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "BufferA",
      width: 320,
      height: 180,
      output: "texture",
      channels: [],
    }, "rgba32float");

    await pass.rebuild("// wgsl");

    expect(device.createTexture).toHaveBeenCalledTimes(2);
    expect(device.createTexture).toHaveBeenCalledWith(expect.objectContaining({
      format: "rgba32float",
    }));
    const pipelineDescriptor = device.createRenderPipeline.mock.calls[0][0];
    expect(pipelineDescriptor.fragment.targets).toEqual([{ format: "rgba32float" }]);
  });

  it("returns null getters before rebuild has ever run", () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 800,
      height: 600,
      output: "canvas",
      storage: [],
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
      storage: [],
      channels: [],
    });

    await pass.rebuild("// wgsl");

    expect(pass.getPipeline()).toBe(device.createRenderPipeline.mock.results[0].value);
    expect(pass.getBindGroup()).toBe(device.createBindGroup.mock.results[0].value);
    expect(pass.getUniformBuffer()).toBe(device.createBuffer.mock.results[0].value);
  });

  it("allocates the descriptor's dynamically extended custom-uniform size", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 800,
      height: 600,
      output: "canvas",
      channels: [],
      uniformBufferSize: 224,
    } as any);

    await pass.rebuild("// wgsl");

    expect(device.createBuffer).toHaveBeenCalledWith(expect.objectContaining({ size: 224 }));
  });

  it("wires the bind group to binding 0 with the uniform buffer via the explicit layout", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 800,
      height: 600,
      output: "canvas",
      storage: [],
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
      storage: [],
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

  it("places read-only render storage at its exact binding after slot-sorted channel pairs", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 320,
      height: 180,
      output: "canvas",
      channels: [{ slot: 3, key: "iChannel3" }],
      storage: [storageA, storageB],
    });

    await pass.rebuild("// wgsl");

    const entries = device.createBindGroupLayout.mock.calls[0][0].entries;
    expect(entries.map((entry: GPUBindGroupLayoutEntry) => entry.binding)).toEqual([0, 1, 2, 3, 4]);
    expect(entries.slice(3)).toEqual([
      {
        binding: 3,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 4,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "read-only-storage" },
      },
    ]);
  });

  it("keeps direct atomic storage bindings read-only in render pipelines", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 320,
      height: 180,
      output: "canvas",
      channels: [],
      storage: [{
        ...storageA,
        name: "counters",
        elementType: "Atomic<uint>",
        stride: 4,
      }],
    });

    await pass.rebuild("// wgsl");

    expect(device.createBindGroupLayout.mock.calls[0][0].entries.at(-1)).toEqual({
      binding: 1,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: { type: "read-only-storage" },
    });
  });

  it("uses each storage node binding instead of its descriptor-array index", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 320,
      height: 180,
      output: "canvas",
      channels: [{ slot: 0, key: "iChannel0" }],
      storage: [{ ...storageA, binding: 2 }],
    });

    await pass.rebuild("// wgsl");
    const positions = { label: "positions" } as unknown as GPUBuffer;
    pass.rebuildBindGroup(
      [{ slot: 0, textureView: { label: "view" } as unknown as GPUTextureView }],
      new Map([[storageA.name, positions]]),
    );

    expect(device.createBindGroupLayout.mock.calls[0][0].entries.at(-1)!.binding).toBe(5);
    expect(device.createBindGroup.mock.calls[0][0].entries.at(-1)).toEqual({
      binding: 5,
      resource: { buffer: positions },
    });
  });

  it("defers a storage-only bind group until storage buffers are provided", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 320,
      height: 180,
      output: "canvas",
      channels: [],
      storage: [storageA],
    });

    await pass.rebuild("// wgsl");

    expect(device.createBindGroupLayout.mock.calls[0][0].entries.map(
      (entry: GPUBindGroupLayoutEntry) => entry.binding,
    )).toEqual([0, 1]);
    expect(device.createBindGroup).not.toHaveBeenCalled();
    expect(pass.getBindGroup()).toBeNull();
  });

  it("binds slot-sorted channels before storage buffers resolved by node name", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 320,
      height: 180,
      output: "canvas",
      channels: [
        { slot: 3, key: "iChannel3" },
        { slot: 0, key: "iChannel0" },
      ],
      storage: [storageA, storageB],
    });
    await pass.rebuild("// wgsl");
    const view0 = { label: "view-0" } as unknown as GPUTextureView;
    const view3 = { label: "view-3" } as unknown as GPUTextureView;
    const positions = { label: "positions" } as unknown as GPUBuffer;
    const particles = { label: "particles" } as unknown as GPUBuffer;

    pass.rebuildBindGroup(
      [
        { slot: 3, textureView: view3 },
        { slot: 0, textureView: view0 },
      ],
      new Map([
        [storageB.name, particles],
        [storageA.name, positions],
      ]),
    );

    const sampler = device.createSampler.mock.results[0].value;
    expect(device.createBindGroup.mock.calls[0][0].entries).toEqual([
      { binding: 0, resource: { buffer: pass.getUniformBuffer() } },
      { binding: 1, resource: view0 },
      { binding: 2, resource: sampler },
      { binding: 3, resource: view3 },
      { binding: 4, resource: sampler },
      { binding: 5, resource: { buffer: positions } },
      { binding: 6, resource: { buffer: particles } },
    ]);
  });

  it("clears a prior bind group when storage is absent and recovers without partial creation", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 320,
      height: 180,
      output: "canvas",
      channels: [],
      storage: [storageA, storageB],
    });
    await pass.rebuild("// wgsl");
    const positions = { label: "positions" } as unknown as GPUBuffer;
    const particles = { label: "particles" } as unknown as GPUBuffer;
    const complete = new Map([
      [storageA.name, positions],
      [storageB.name, particles],
    ]);
    pass.rebuildBindGroup([], complete);
    expect(pass.getBindGroup()).not.toBeNull();
    expect(device.createBindGroup).toHaveBeenCalledTimes(1);

    pass.rebuildBindGroup([], new Map([[storageA.name, positions]]));
    expect(pass.getBindGroup()).toBeNull();
    expect(device.createBindGroup).toHaveBeenCalledTimes(1);

    pass.rebuildBindGroup([], undefined);
    expect(pass.getBindGroup()).toBeNull();
    expect(device.createBindGroup).toHaveBeenCalledTimes(1);

    pass.rebuildBindGroup([], complete);
    expect(pass.getBindGroup()).not.toBeNull();
    expect(device.createBindGroup).toHaveBeenCalledTimes(2);
  });

  it("reuses an unchanged bind group and rebuilds when a storage buffer identity changes", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 320,
      height: 180,
      output: "canvas",
      channels: [],
      storage: [storageA],
    });
    await pass.rebuild("// wgsl");
    const firstBuffer = { label: "positions-1" } as unknown as GPUBuffer;
    const firstResources = new Map([[storageA.name, firstBuffer]]);

    pass.rebuildBindGroup([], firstResources);
    const firstBindGroup = pass.getBindGroup();
    pass.rebuildBindGroup([], firstResources);

    expect(pass.getBindGroup()).toBe(firstBindGroup);
    expect(device.createBindGroup).toHaveBeenCalledTimes(1);

    const replacement = { label: "positions-2" } as unknown as GPUBuffer;
    pass.rebuildBindGroup([], new Map([[storageA.name, replacement]]));

    expect(pass.getBindGroup()).not.toBe(firstBindGroup);
    expect(device.createBindGroup).toHaveBeenCalledTimes(2);
    expect(device.createBindGroup.mock.calls.at(-1)![0].entries).toContainEqual({
      binding: 1,
      resource: { buffer: replacement },
    });
  });

  it("uses cube texture layout entries for cubemap channels", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 320,
      height: 180,
      output: "canvas",
      storage: [],
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
      storage: [],
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
      storage: [],
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
      storage: [],
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
      storage: [],
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
      storage: [],
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
      storage: [],
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
      storage: [],
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
      storage: [],
      channels: [],
    });

    await pass.rebuild("// wgsl");
    const [textureA, textureB] = device.createTexture.mock.results.map((r) => r.value);
    const currentBeforeSwap = pass.getCurrentOutputView();
    const previousBeforeSwap = pass.getPreviousOutputView();
    expect(previousBeforeSwap).not.toBe(currentBeforeSwap);
    expect(previousBeforeSwap).toBe(textureB.createView.mock.results[0].value);

    pass.swap();

    expect(pass.getCurrentOutputView()).toBe(textureB.createView.mock.results[0].value);
    expect(pass.getPreviousOutputView()).toBe(textureA.createView.mock.results[0].value);
    expect(textureA.createView).toHaveBeenCalledTimes(1);
    expect(textureB.createView).toHaveBeenCalledTimes(1);
  });

  it("destroys the previous ping-pong textures when rebuild runs again", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "BufferA",
      width: 320,
      height: 180,
      output: "texture",
      storage: [],
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

  it("destroys a partial output allocation when the second rebuild texture throws", async () => {
    const device = fakeDevice();
    const partialTexture = {
      createView: vi.fn(() => ({ label: "partial-view" })),
      destroy: vi.fn(),
    };
    device.createTexture
      .mockImplementationOnce(() => partialTexture)
      .mockImplementationOnce(() => {
        throw new Error("second render rebuild allocation failed");
      });
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "BufferA",
      width: 320,
      height: 180,
      output: "texture",
      storage: [],
      channels: [],
    });

    await expect(pass.rebuild("// wgsl"))
      .rejects.toThrow("second render rebuild allocation failed");

    expect(partialTexture.destroy).toHaveBeenCalledTimes(1);
    expect(pass.getCurrentOutputView()).toBeNull();
  });

  it("dispose() destroys ping-pong textures and clears the output view", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "BufferA",
      width: 320,
      height: 180,
      output: "texture",
      storage: [],
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

  it("resetOutputTextures clears feedback without rebuilding the shader pipeline", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "BufferA",
      width: 320,
      height: 180,
      output: "texture",
      channels: [],
    });
    await pass.rebuild("// wgsl");
    const oldTextures = device.createTexture.mock.results.map((result) => result.value);

    (pass as unknown as { resetOutputTextures(): void }).resetOutputTextures();

    expect(device.createTexture).toHaveBeenCalledTimes(4);
    for (const texture of oldTextures) {
      expect(texture.destroy).toHaveBeenCalledTimes(1);
    }
    expect(device.createShaderModule).toHaveBeenCalledTimes(1);
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(1);
  });

  it("dispose() is a safe no-op for a canvas pass with no textures", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 800,
      height: 600,
      output: "canvas",
      storage: [],
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
      storage: [],
      channels: [],
    });

    await pass.rebuild("// wgsl");
    pass.updateDescriptor({
      name: "BufferA",
      width: 640,
      height: 360,
      output: "texture",
      storage: [],
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
      storage: [],
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
    const encoder = device.createCommandEncoder.mock.results[0].value;
    expect(encoder.copyTextureToTexture).toHaveBeenCalledTimes(2);
    expect(encoder.copyTextureToTexture).toHaveBeenNthCalledWith(
      1,
      { texture: firstTextures[0], origin: { x: 0, y: 0 } },
      { texture: device.createTexture.mock.results[2].value, origin: { x: 0, y: 180 } },
      { width: 320, height: 180, depthOrArrayLayers: 1 },
    );
    expect(encoder.copyTextureToTexture).toHaveBeenNthCalledWith(
      2,
      { texture: firstTextures[1], origin: { x: 0, y: 0 } },
      { texture: device.createTexture.mock.results[3].value, origin: { x: 0, y: 180 } },
      { width: 320, height: 180, depthOrArrayLayers: 1 },
    );
    expect(device.queue.submit).toHaveBeenCalledWith([{ label: "copy-command" }]);
    // No shader/pipeline recompilation happened.
    expect(device.createShaderModule).toHaveBeenCalledTimes(1);
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(1);
  });

  it("resize() keeps the bottom-left region when shrinking feedback textures", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "BufferA",
      width: 640,
      height: 360,
      output: "texture",
      channels: [],
    });
    await pass.rebuild("// wgsl");
    const firstTextures = device.createTexture.mock.results.map((result) => result.value);

    pass.resize(320, 180);

    const encoder = device.createCommandEncoder.mock.results[0].value;
    expect(encoder.copyTextureToTexture).toHaveBeenNthCalledWith(
      1,
      { texture: firstTextures[0], origin: { x: 0, y: 180 } },
      { texture: device.createTexture.mock.results[2].value, origin: { x: 0, y: 0 } },
      { width: 320, height: 180, depthOrArrayLayers: 1 },
    );
    expect(encoder.copyTextureToTexture).toHaveBeenNthCalledWith(
      2,
      { texture: firstTextures[1], origin: { x: 0, y: 180 } },
      { texture: device.createTexture.mock.results[3].value, origin: { x: 0, y: 0 } },
      { width: 320, height: 180, depthOrArrayLayers: 1 },
    );
  });

  it("encodeResize() records migration without submitting or destroying textures early", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "BufferA",
      width: 320,
      height: 180,
      output: "texture",
      channels: [],
    });
    await pass.rebuild("// wgsl");
    const oldTextures = device.createTexture.mock.results.map((result) => result.value);
    const encoder = device.createCommandEncoder();

    const finishResize = pass.encodeResize(640, 360, encoder);

    expect(encoder.copyTextureToTexture).toHaveBeenCalledTimes(2);
    expect(device.queue.submit).not.toHaveBeenCalled();
    for (const texture of oldTextures) {
      expect(texture.destroy).not.toHaveBeenCalled();
    }

    finishResize?.();
    for (const texture of oldTextures) {
      expect(texture.destroy).toHaveBeenCalledTimes(1);
    }
  });

  it("resize() with an unchanged size does not recreate textures", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "BufferA",
      width: 320,
      height: 180,
      output: "texture",
      storage: [],
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
      storage: [],
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
      storage: [],
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
      storage: [],
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
      storage: [],
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

  it("preserves cached render views when resized output view creation throws", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "BufferA",
      width: 320,
      height: 180,
      output: "texture",
      storage: [],
      channels: [],
    });
    await pass.rebuild("// wgsl");
    const originalView = pass.getCurrentOutputView();
    const originalTextures = device.createTexture.mock.results.map((result) => result.value);
    const failingTexture = {
      createView: vi.fn(() => {
        throw new Error("render resize view failed");
      }),
      destroy: vi.fn(),
    };
    const siblingTexture = {
      createView: vi.fn(() => ({ label: "sibling-view" })),
      destroy: vi.fn(),
    };
    device.createTexture
      .mockImplementationOnce(() => failingTexture)
      .mockImplementationOnce(() => siblingTexture);

    expect(() => pass.resize(640, 360)).toThrow("render resize view failed");

    expect(failingTexture.destroy).toHaveBeenCalledTimes(1);
    expect(siblingTexture.destroy).toHaveBeenCalledTimes(1);
    expect(originalTextures.every((texture) => texture.destroy.mock.calls.length === 0)).toBe(true);
    expect(pass.getCurrentOutputView()).toBe(originalView);
  });

  it("destroys the uniform buffer on dispose()", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 800,
      height: 600,
      output: "canvas",
      storage: [],
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
      storage: [],
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
      storage: [],
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
      storage: [],
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
      storage: [],
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
      storage: [],
      channels: [],
    });

    const errors = await pass.rebuild("// wgsl");

    expect(errors).toEqual(["Image: WGSL L10:5 undeclared identifier 'foo'"]);
  });

  it("returns WGSL diagnostics when asynchronous pipeline creation rejects an invalid module", async () => {
    const device = fakeDevice([
      { type: "error", lineNum: 42, linePos: 7, message: "invalid texture sample" },
    ]);
    device.createRenderPipelineAsync = vi.fn(async () => {
      throw new Error("[Invalid ShaderModule (unlabeled)] is invalid.");
    });
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 800,
      height: 600,
      output: "canvas",
      storage: [],
      channels: [],
    });

    await expect(pass.rebuild("// invalid wgsl")).resolves.toEqual([
      "Image: WGSL L42:7 invalid texture sample",
    ]);
  });

  it("returns an empty error list when compilation has no messages", async () => {
    const device = fakeDevice();
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 800,
      height: 600,
      output: "canvas",
      storage: [],
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
      storage: [],
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
      storage: [],
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
      storage: [],
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
      storage: [],
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
      storage: [],
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
        storage: [],
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
        storage: [],
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
        storage: [],
        channels: [],
      });
      const errors = await pass.rebuild("// wgsl");

      expect(errors).toEqual([]);
      expect(device.createRenderPipeline).toHaveBeenCalledTimes(1);
      expect(pass.getPipeline()).not.toBeNull();
    });
  });
});
