import { describe, expect, it, vi } from "vitest";
import type { StorageBindingNode } from "../../types/PassGraph";
import {
  SlangComputePipeline,
  type SlangComputePipelineDescriptor,
} from "../../webgpu/SlangComputePipeline";
import { BUFFER_TEXTURE_FORMAT } from "../../webgpu/SlangPassPipeline";
import {
  DISPATCH_UNIFORM_SIZE,
  SHADERTOY_UNIFORM_SIZE,
  SLANG_ENTRY_COMPUTE,
} from "../../webgpu/SlangPrelude";

interface FakeBuffer {
  id: number;
  descriptor: GPUBufferDescriptor;
  destroy: ReturnType<typeof vi.fn>;
}

interface FakeTextureView {
  textureId: number;
  descriptor: GPUTextureViewDescriptor | undefined;
}

interface FakeTexture {
  id: number;
  descriptor: GPUTextureDescriptor;
  createView: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

type FakeDevice = GPUDevice & {
  createShaderModule: ReturnType<typeof vi.fn>;
  createComputePipeline: ReturnType<typeof vi.fn>;
  createComputePipelineAsync?: ReturnType<typeof vi.fn>;
  createBindGroupLayout: ReturnType<typeof vi.fn>;
  createPipelineLayout: ReturnType<typeof vi.fn>;
  createBuffer: ReturnType<typeof vi.fn>;
  createSampler: ReturnType<typeof vi.fn>;
  createTexture: ReturnType<typeof vi.fn>;
  createBindGroup: ReturnType<typeof vi.fn>;
  queue: GPUQueue & { writeBuffer: ReturnType<typeof vi.fn> };
};

function fakeDevice(
  compilationMessages: Array<{
    type: string;
    lineNum: number;
    linePos: number;
    message: string;
  }> = [],
  getCompilationInfo?: ReturnType<typeof vi.fn>,
): FakeDevice {
  let bufferId = 0;
  let textureId = 0;
  const pipeline = { label: "compute-pipeline" };
  return {
    createShaderModule: vi.fn(() => ({
      label: "shader-module",
      getCompilationInfo: getCompilationInfo ?? vi.fn(async () => ({ messages: compilationMessages })),
    })),
    createComputePipeline: vi.fn(() => pipeline),
    createBindGroupLayout: vi.fn(() => ({ label: "bind-group-layout" })),
    createPipelineLayout: vi.fn(() => ({ label: "pipeline-layout" })),
    createBuffer: vi.fn((descriptor: GPUBufferDescriptor): FakeBuffer => ({
      id: bufferId++,
      descriptor,
      destroy: vi.fn(),
    })),
    createSampler: vi.fn(() => ({ label: "linear-sampler" })),
    createTexture: vi.fn((descriptor: GPUTextureDescriptor): FakeTexture => {
      const id = textureId++;
      return {
        id,
        descriptor,
        createView: vi.fn((viewDescriptor?: GPUTextureViewDescriptor): FakeTextureView => ({
          textureId: id,
          descriptor: viewDescriptor,
        })),
        destroy: vi.fn(),
      };
    }),
    createBindGroup: vi.fn((_descriptor: GPUBindGroupDescriptor) => ({
      label: `bind-group-${Math.random()}`,
    })),
    queue: {
      writeBuffer: vi.fn(),
    },
  } as unknown as FakeDevice;
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
  count: 64,
  stride: 32,
};

function descriptor(
  overrides: Partial<SlangComputePipelineDescriptor> = {},
): SlangComputePipelineDescriptor {
  return {
    name: "ComputeA",
    width: 320,
    height: 180,
    hasOutput: true,
    outputLayers: 1,
    workgroupSize: [8, 8, 1],
    dispatchCount: 1,
    channels: [],
    storage: [],
    ...overrides,
  };
}

function fakeChannel(slot: number, sampler?: GPUSampler) {
  return {
    slot,
    textureView: { slot } as unknown as GPUTextureView,
    sampler,
  };
}

function fakeStorageBuffer(name: string): GPUBuffer {
  return { name } as unknown as GPUBuffer;
}

function bindGroupEntries(device: FakeDevice, index: number): GPUBindGroupEntry[] {
  return device.createBindGroup.mock.calls[index][0].entries as GPUBindGroupEntry[];
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe("SlangComputePipeline", () => {
  it("rebuilds a compute pipeline with explicit layouts and output resources", async () => {
    const device = fakeDevice();
    const compute = new SlangComputePipeline(device, descriptor());

    const errors = await compute.rebuild("// exact wgsl");

    expect(errors).toEqual([]);
    expect(device.createShaderModule).toHaveBeenCalledWith({ code: "// exact wgsl" });
    expect(device.createPipelineLayout).toHaveBeenCalledWith({
      bindGroupLayouts: [device.createBindGroupLayout.mock.results[0].value],
    });
    expect(device.createComputePipeline).toHaveBeenCalledWith({
      layout: device.createPipelineLayout.mock.results[0].value,
      compute: {
        module: device.createShaderModule.mock.results[0].value,
        entryPoint: SLANG_ENTRY_COMPUTE,
      },
    });
    expect(compute.getPipeline()).toBe(device.createComputePipeline.mock.results[0].value);
    expect(device.createBuffer.mock.calls[0][0]).toEqual({
      size: SHADERTOY_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    expect(compute.getUniformBuffer()).toBe(device.createBuffer.mock.results[0].value);
    expect(device.createSampler).toHaveBeenCalledWith({ magFilter: "linear", minFilter: "linear" });
    expect(device.createTexture).toHaveBeenCalledTimes(2);
    for (const [textureDescriptor] of device.createTexture.mock.calls) {
      expect(textureDescriptor).toEqual({
        size: { width: 320, height: 180, depthOrArrayLayers: 1 },
        format: BUFFER_TEXTURE_FORMAT,
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      });
    }
    expect(compute.getBindGroup(0)).toBeNull();
  });

  it("prefers async pipeline creation and maps rejection to a pass-prefixed error", async () => {
    const device = fakeDevice();
    device.createComputePipelineAsync = vi.fn(async () => {
      throw new Error("pipeline validation failed");
    });
    const compute = new SlangComputePipeline(device, descriptor({ name: "Simulate" }));

    await expect(compute.rebuild("// wgsl")).resolves.toEqual([
      "Simulate: pipeline validation failed",
    ]);

    expect(device.createComputePipelineAsync).toHaveBeenCalledTimes(1);
    expect(device.createComputePipeline).not.toHaveBeenCalled();
    expect(device.createBuffer).not.toHaveBeenCalled();
    expect(compute.getPipeline()).toBeNull();
  });

  it("uses the async-created pipeline when available", async () => {
    const device = fakeDevice();
    const asyncPipeline = { label: "async-compute-pipeline" } as unknown as GPUComputePipeline;
    device.createComputePipelineAsync = vi.fn(async () => asyncPipeline);
    const compute = new SlangComputePipeline(device, descriptor());

    expect(await compute.rebuild("// wgsl")).toEqual([]);

    expect(device.createComputePipeline).not.toHaveBeenCalled();
    expect(compute.getPipeline()).toBe(asyncPipeline);
  });

  it("maps compilation errors and filters non-error messages", async () => {
    const device = fakeDevice([
      { type: "warning", lineNum: 2, linePos: 4, message: "unused" },
      { type: "error", lineNum: 9, linePos: 7, message: "bad compute expression" },
    ]);
    const compute = new SlangComputePipeline(device, descriptor({ name: "Dispatch" }));

    expect(await compute.rebuild("// wgsl")).toEqual([
      "Dispatch: WGSL L9:7 bad compute expression",
    ]);
  });

  it("creates and initializes one exact-size dispatch uniform per sub-dispatch", async () => {
    const device = fakeDevice();
    const compute = new SlangComputePipeline(device, descriptor({
      hasOutput: false,
      outputLayers: 0,
      dispatchCount: 3,
    }));

    await compute.rebuild("// wgsl");

    expect(device.createBuffer).toHaveBeenCalledTimes(4);
    const dispatchBuffers = device.createBuffer.mock.results.slice(1).map((result) => result.value);
    for (const buffer of dispatchBuffers) {
      expect(buffer.descriptor).toEqual({
        size: DISPATCH_UNIFORM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
    }
    expect(device.queue.writeBuffer).toHaveBeenCalledTimes(3);
    for (let index = 0; index < 3; index++) {
      const [buffer, offset, data] = device.queue.writeBuffer.mock.calls[index];
      expect(buffer).toBe(dispatchBuffers[index]);
      expect(offset).toBe(0);
      expect(data).toBeInstanceOf(Int32Array);
      expect(Array.from(data as Int32Array)).toEqual([index, 0, 0, 0]);
    }
  });

  it("mirrors the prelude's sorted channel, storage, output, and dispatch layout", async () => {
    const device = fakeDevice();
    const compute = new SlangComputePipeline(device, descriptor({
      outputLayers: 3,
      channels: [
        { slot: 7, key: "cube", kind: "cubemap" },
        { slot: 1, key: "image", kind: "texture" },
      ],
      storage: [storageB, storageA],
    }));

    await compute.rebuild("// wgsl");

    expect(device.createBindGroupLayout).toHaveBeenCalledWith({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "float", viewDimension: "2d" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          sampler: { type: "filtering" },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "float", viewDimension: "cube" },
        },
        {
          binding: 4,
          visibility: GPUShaderStage.COMPUTE,
          sampler: { type: "filtering" },
        },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        {
          binding: 7,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: {
            access: "write-only",
            format: BUFFER_TEXTURE_FORMAT,
            viewDimension: "2d-array",
          },
        },
        { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      ],
    });
  });

  it("places dispatch at the next binding when output is disabled", async () => {
    const device = fakeDevice();
    const compute = new SlangComputePipeline(device, descriptor({
      hasOutput: false,
      outputLayers: 0,
      channels: [{ slot: 2, key: "only" }],
      storage: [storageA],
    }));

    await compute.rebuild("// wgsl");

    const entries = device.createBindGroupLayout.mock.calls[0][0].entries;
    expect(entries.at(-1)).toEqual({
      binding: 4,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: "uniform" },
    });
    expect(entries.some((entry: GPUBindGroupLayoutEntry) => entry.storageTexture)).toBe(false);
  });

  it("uses a 2D storage texture layout for a single-layer output", async () => {
    const device = fakeDevice();
    const compute = new SlangComputePipeline(device, descriptor({ outputLayers: 1 }));

    await compute.rebuild("// wgsl");

    const entries = device.createBindGroupLayout.mock.calls[0][0].entries;
    expect(entries.at(-2)).toEqual({
      binding: 1,
      visibility: GPUShaderStage.COMPUTE,
      storageTexture: {
        access: "write-only",
        format: BUFFER_TEXTURE_FORMAT,
        viewDimension: "2d",
      },
    });
  });

  it("builds one positional bind group per sub-dispatch with named storage and current output", async () => {
    const device = fakeDevice();
    const compute = new SlangComputePipeline(device, descriptor({
      outputLayers: 2,
      dispatchCount: 2,
      channels: [
        { slot: 5, key: "late" },
        { slot: 1, key: "early" },
      ],
      storage: [storageB, storageA],
    }));
    const channelFive = fakeChannel(5);
    const ownSampler = { label: "own-sampler" } as unknown as GPUSampler;
    const channelOne = fakeChannel(1, ownSampler);
    const positions = fakeStorageBuffer("positions");
    const particles = fakeStorageBuffer("particles");

    await compute.rebuild("// wgsl");
    compute.rebuildBindGroups(
      [channelFive, channelOne],
      new Map([
        ["positions", positions],
        ["particles", particles],
      ]),
    );

    expect(device.createBindGroup).toHaveBeenCalledTimes(2);
    const sharedSampler = device.createSampler.mock.results[0].value;
    const dispatchBuffers = device.createBuffer.mock.results.slice(1).map((result) => result.value);
    for (let index = 0; index < 2; index++) {
      const entries = bindGroupEntries(device, index);
      expect(entries.slice(0, 7)).toEqual([
        { binding: 0, resource: { buffer: compute.getUniformBuffer() } },
        { binding: 1, resource: channelOne.textureView },
        { binding: 2, resource: ownSampler },
        { binding: 3, resource: channelFive.textureView },
        { binding: 4, resource: sharedSampler },
        { binding: 6, resource: { buffer: particles } },
        { binding: 5, resource: { buffer: positions } },
      ]);
      const outputView = entries[7].resource as unknown as FakeTextureView;
      expect(entries[7].binding).toBe(7);
      expect(outputView.textureId).toBe(0);
      expect(outputView.descriptor).toEqual({
        dimension: "2d-array",
        baseArrayLayer: 0,
        arrayLayerCount: 2,
      });
      expect(entries[8]).toEqual({
        binding: 8,
        resource: { buffer: dispatchBuffers[index] },
      });
      expect(compute.getBindGroup(index)).toBe(device.createBindGroup.mock.results[index].value);
    }
    expect(compute.getBindGroup(2)).toBeNull();
  });

  it("clears groups instead of creating invalid groups when a channel or storage buffer is missing", async () => {
    const device = fakeDevice();
    const compute = new SlangComputePipeline(device, descriptor({
      channels: [{ slot: 0, key: "input" }],
      storage: [storageA],
    }));
    const channel = fakeChannel(0);
    const positions = fakeStorageBuffer("positions");

    await compute.rebuild("// wgsl");
    compute.rebuildBindGroups([channel], new Map([["positions", positions]]));
    expect(compute.getBindGroup(0)).not.toBeNull();

    compute.rebuildBindGroups([], new Map([["positions", positions]]));
    expect(compute.getBindGroup(0)).toBeNull();
    expect(device.createBindGroup).toHaveBeenCalledTimes(1);

    compute.rebuildBindGroups([channel], new Map());
    expect(compute.getBindGroup(0)).toBeNull();
    expect(device.createBindGroup).toHaveBeenCalledTimes(1);
  });

  it("forms dispatch groups with zero channels, storage buffers, and output", async () => {
    const device = fakeDevice();
    const compute = new SlangComputePipeline(device, descriptor({
      hasOutput: false,
      outputLayers: 0,
      dispatchCount: 2,
    }));

    await compute.rebuild("// wgsl");
    compute.rebuildBindGroups([], new Map());

    expect(device.createBindGroup).toHaveBeenCalledTimes(2);
    const dispatchBuffers = device.createBuffer.mock.results.slice(1).map((result) => result.value);
    for (let index = 0; index < 2; index++) {
      expect(bindGroupEntries(device, index)).toEqual([
        { binding: 0, resource: { buffer: compute.getUniformBuffer() } },
        { binding: 1, resource: { buffer: dispatchBuffers[index] } },
      ]);
    }
  });

  it("creates full array output views and bounded single-layer sampler views", async () => {
    const device = fakeDevice();
    const compute = new SlangComputePipeline(device, descriptor({ outputLayers: 3 }));

    await compute.rebuild("// wgsl");

    expect(compute.getCurrentOutputView()).toEqual({
      textureId: 0,
      descriptor: { dimension: "2d-array", baseArrayLayer: 0, arrayLayerCount: 3 },
    });
    expect(compute.getLayerOutputView(2)).toEqual({
      textureId: 0,
      descriptor: { dimension: "2d", baseArrayLayer: 2, arrayLayerCount: 1 },
    });
    expect(compute.getPreviousLayerOutputView(1)).toEqual({
      textureId: 1,
      descriptor: { dimension: "2d", baseArrayLayer: 1, arrayLayerCount: 1 },
    });
    expect(compute.getLayerOutputView(-1)).toBeNull();
    expect(compute.getLayerOutputView(3)).toBeNull();
    expect(compute.getPreviousLayerOutputView(3)).toBeNull();
  });

  it("supports only layer zero for a plain 2D output", async () => {
    const device = fakeDevice();
    const compute = new SlangComputePipeline(device, descriptor({ outputLayers: 1 }));

    await compute.rebuild("// wgsl");

    expect(compute.getCurrentOutputView()).toEqual({
      textureId: 0,
      descriptor: { dimension: "2d" },
    });
    expect(compute.getLayerOutputView(0)).toEqual({
      textureId: 0,
      descriptor: { dimension: "2d", baseArrayLayer: 0, arrayLayerCount: 1 },
    });
    expect(compute.getPreviousLayerOutputView(0)).toEqual({
      textureId: 1,
      descriptor: { dimension: "2d", baseArrayLayer: 0, arrayLayerCount: 1 },
    });
    expect(compute.getLayerOutputView(1)).toBeNull();
  });

  it("swaps current and previous output textures deterministically", async () => {
    const device = fakeDevice();
    const compute = new SlangComputePipeline(device, descriptor({ outputLayers: 2 }));

    await compute.rebuild("// wgsl");
    const currentBefore = compute.getCurrentOutputView() as unknown as FakeTextureView;
    const previousBefore = compute.getPreviousLayerOutputView(0) as unknown as FakeTextureView;

    compute.swap();

    const currentAfter = compute.getCurrentOutputView() as unknown as FakeTextureView;
    const previousAfter = compute.getPreviousLayerOutputView(0) as unknown as FakeTextureView;
    expect([currentBefore.textureId, previousBefore.textureId]).toEqual([0, 1]);
    expect([currentAfter.textureId, previousAfter.textureId]).toEqual([1, 0]);
    expect(currentAfter.descriptor?.dimension).toBe("2d-array");
    expect(previousAfter.descriptor).toEqual({
      dimension: "2d",
      baseArrayLayer: 0,
      arrayLayerCount: 1,
    });

    compute.rebuildBindGroups([], new Map());
    const outputEntry = bindGroupEntries(device, 0).find((entry) => entry.binding === 1)!;
    expect((outputEntry.resource as unknown as FakeTextureView).textureId).toBe(1);
  });

  it("recreates output textures and invalidates groups only when the size changes", async () => {
    const device = fakeDevice();
    const compute = new SlangComputePipeline(device, descriptor());

    await compute.rebuild("// wgsl");
    compute.rebuildBindGroups([], new Map());
    const originalGroup = compute.getBindGroup(0);
    const originalTextures = device.createTexture.mock.results.map((result) => result.value as FakeTexture);

    compute.resize(320, 180);
    expect(compute.getBindGroup(0)).toBe(originalGroup);
    expect(device.createTexture).toHaveBeenCalledTimes(2);

    compute.resize(640, 360);
    expect(compute.getBindGroup(0)).toBeNull();
    for (const texture of originalTextures) {
      expect(texture.destroy).toHaveBeenCalledTimes(1);
    }
    expect(device.createTexture).toHaveBeenCalledTimes(4);
    for (const [textureDescriptor] of device.createTexture.mock.calls.slice(2)) {
      expect(textureDescriptor.size).toEqual({ width: 640, height: 360, depthOrArrayLayers: 1 });
    }
    expect(device.createShaderModule).toHaveBeenCalledTimes(1);
    expect(device.createComputePipeline).toHaveBeenCalledTimes(1);
  });

  it("resizes an output-free pass without textures and preserves groups on a no-op", async () => {
    const device = fakeDevice();
    const compute = new SlangComputePipeline(device, descriptor({
      hasOutput: false,
      outputLayers: 0,
    }));

    await compute.rebuild("// wgsl");
    compute.rebuildBindGroups([], new Map());
    const group = compute.getBindGroup(0);

    compute.resize(320, 180);
    expect(compute.getBindGroup(0)).toBe(group);

    compute.resize(640, 360);
    expect(compute.getBindGroup(0)).toBeNull();
    expect(device.createTexture).not.toHaveBeenCalled();
    expect(device.createComputePipeline).toHaveBeenCalledTimes(1);
  });

  it("preserves the old descriptor, views, textures, and groups when the first resize allocation throws", async () => {
    const device = fakeDevice();
    const compute = new SlangComputePipeline(device, descriptor());
    await compute.rebuild("// wgsl");
    compute.rebuildBindGroups([], new Map());
    const originalGroup = compute.getBindGroup(0);
    const originalView = compute.getCurrentOutputView() as unknown as FakeTextureView;
    const originalTextures = device.createTexture.mock.results.map((result) => result.value as FakeTexture);
    device.createTexture.mockImplementationOnce(() => {
      throw new Error("first compute resize allocation failed");
    });

    expect(() => compute.resize(640, 360)).toThrow("first compute resize allocation failed");

    expect(compute.getBindGroup(0)).toBe(originalGroup);
    expect((compute.getCurrentOutputView() as unknown as FakeTextureView).textureId)
      .toBe(originalView.textureId);
    expect(originalTextures.every((texture) => texture.destroy.mock.calls.length === 0)).toBe(true);
    const callsAfterFailure = device.createTexture.mock.calls.length;
    compute.resize(320, 180);
    expect(device.createTexture).toHaveBeenCalledTimes(callsAfterFailure);
  });

  it("destroys a partial resize allocation while preserving compute resources when the second allocation throws", async () => {
    const device = fakeDevice();
    const compute = new SlangComputePipeline(device, descriptor());
    await compute.rebuild("// wgsl");
    compute.rebuildBindGroups([], new Map());
    const originalGroup = compute.getBindGroup(0);
    const originalView = compute.getCurrentOutputView() as unknown as FakeTextureView;
    const originalTextures = device.createTexture.mock.results.map((result) => result.value as FakeTexture);
    const partialTexture: FakeTexture = {
      id: 999,
      descriptor: {} as GPUTextureDescriptor,
      createView: vi.fn(() => ({ textureId: 999, descriptor: undefined })),
      destroy: vi.fn(),
    };
    device.createTexture
      .mockImplementationOnce(() => partialTexture)
      .mockImplementationOnce(() => {
        throw new Error("second compute resize allocation failed");
      });

    expect(() => compute.resize(640, 360)).toThrow("second compute resize allocation failed");

    expect(partialTexture.destroy).toHaveBeenCalledTimes(1);
    expect(compute.getBindGroup(0)).toBe(originalGroup);
    expect((compute.getCurrentOutputView() as unknown as FakeTextureView).textureId)
      .toBe(originalView.textureId);
    expect(originalTextures.every((texture) => texture.destroy.mock.calls.length === 0)).toBe(true);
    const callsAfterFailure = device.createTexture.mock.calls.length;
    compute.resize(320, 180);
    expect(device.createTexture).toHaveBeenCalledTimes(callsAfterFailure);
  });

  it("destroys old buffers and textures and resets groups on rebuild", async () => {
    const device = fakeDevice();
    const compute = new SlangComputePipeline(device, descriptor({ dispatchCount: 2 }));

    await compute.rebuild("// v1");
    compute.rebuildBindGroups([], new Map());
    const oldBuffers = device.createBuffer.mock.results.map((result) => result.value as FakeBuffer);
    const oldTextures = device.createTexture.mock.results.map((result) => result.value as FakeTexture);

    await compute.rebuild("// v2");

    for (const buffer of oldBuffers) {
      expect(buffer.destroy).toHaveBeenCalledTimes(1);
    }
    for (const texture of oldTextures) {
      expect(texture.destroy).toHaveBeenCalledTimes(1);
    }
    expect(compute.getBindGroup(0)).toBeNull();
    expect(compute.getUniformBuffer()).toBe(device.createBuffer.mock.results[3].value);
    expect(device.createTexture).toHaveBeenCalledTimes(4);
  });

  it("cleans old resources before an asynchronous rebuild failure", async () => {
    const device = fakeDevice();
    const compute = new SlangComputePipeline(device, descriptor());

    await compute.rebuild("// v1");
    const oldBuffers = device.createBuffer.mock.results.map((result) => result.value as FakeBuffer);
    const oldTextures = device.createTexture.mock.results.map((result) => result.value as FakeTexture);
    device.createComputePipelineAsync = vi.fn(async () => Promise.reject("rejected"));

    expect(await compute.rebuild("// invalid")).toEqual(["ComputeA: rejected"]);

    for (const buffer of oldBuffers) {
      expect(buffer.destroy).toHaveBeenCalledTimes(1);
    }
    for (const texture of oldTextures) {
      expect(texture.destroy).toHaveBeenCalledTimes(1);
    }
    expect(compute.getPipeline()).toBeNull();
    expect(compute.getUniformBuffer()).toBeNull();
    expect(compute.getCurrentOutputView()).toBeNull();
  });

  it("does not resurrect resources when disposed during an asynchronous rebuild", async () => {
    const device = fakeDevice();
    const pendingPipeline = deferred<GPUComputePipeline>();
    device.createComputePipelineAsync = vi.fn(() => pendingPipeline.promise);
    const compute = new SlangComputePipeline(device, descriptor());

    const rebuilding = compute.rebuild("// pending");
    compute.dispose();
    pendingPipeline.resolve({ label: "stale" } as unknown as GPUComputePipeline);
    await rebuilding;

    expect(compute.getPipeline()).toBeNull();
    expect(compute.getUniformBuffer()).toBeNull();
    expect(compute.getCurrentOutputView()).toBeNull();
    expect(device.createBuffer).not.toHaveBeenCalled();
    expect(device.createTexture).not.toHaveBeenCalled();
  });

  it("ignores an older asynchronous rebuild that completes after a newer one", async () => {
    const device = fakeDevice();
    const firstPipeline = deferred<GPUComputePipeline>();
    const secondPipeline = deferred<GPUComputePipeline>();
    device.createComputePipelineAsync = vi.fn()
      .mockReturnValueOnce(firstPipeline.promise)
      .mockReturnValueOnce(secondPipeline.promise);
    const compute = new SlangComputePipeline(device, descriptor());

    const firstRebuild = compute.rebuild("// first");
    const secondRebuild = compute.rebuild("// second");
    const currentPipeline = { label: "current" } as unknown as GPUComputePipeline;
    secondPipeline.resolve(currentPipeline);
    await secondRebuild;
    const currentUniform = compute.getUniformBuffer();

    firstPipeline.resolve({ label: "stale" } as unknown as GPUComputePipeline);
    await firstRebuild;

    expect(compute.getPipeline()).toBe(currentPipeline);
    expect(compute.getUniformBuffer()).toBe(currentUniform);
    expect(device.createBuffer).toHaveBeenCalledTimes(2);
    expect(device.createTexture).toHaveBeenCalledTimes(2);
  });

  it("ignores stale diagnostics when a newer rebuild completes during compilation info", async () => {
    const firstCompilationInfo = deferred<{
      messages: Array<{ type: string; lineNum: number; linePos: number; message: string }>;
    }>();
    const getCompilationInfo = vi.fn()
      .mockReturnValueOnce(firstCompilationInfo.promise)
      .mockResolvedValueOnce({ messages: [] });
    const device = fakeDevice([], getCompilationInfo);
    const compute = new SlangComputePipeline(device, descriptor());

    const firstRebuild = compute.rebuild("// first");
    const secondRebuild = compute.rebuild("// second");
    expect(await secondRebuild).toEqual([]);
    const currentPipeline = compute.getPipeline();
    const currentUniform = compute.getUniformBuffer();
    const currentOutput = compute.getCurrentOutputView() as unknown as FakeTextureView;

    firstCompilationInfo.resolve({
      messages: [{
        type: "error",
        lineNum: 4,
        linePos: 2,
        message: "obsolete diagnostic",
      }],
    });

    expect(await firstRebuild).toEqual([]);
    expect(compute.getPipeline()).toBe(currentPipeline);
    expect(compute.getUniformBuffer()).toBe(currentUniform);
    expect((compute.getCurrentOutputView() as unknown as FakeTextureView).textureId)
      .toBe(currentOutput.textureId);
  });

  it("ignores stale diagnostics when disposed during compilation info", async () => {
    const compilationInfo = deferred<{
      messages: Array<{ type: string; lineNum: number; linePos: number; message: string }>;
    }>();
    const device = fakeDevice([], vi.fn(() => compilationInfo.promise));
    const compute = new SlangComputePipeline(device, descriptor());

    const rebuilding = compute.rebuild("// pending diagnostics");
    const buffers = device.createBuffer.mock.results.map((result) => result.value as FakeBuffer);
    const textures = device.createTexture.mock.results.map((result) => result.value as FakeTexture);
    compute.dispose();
    compilationInfo.resolve({
      messages: [{
        type: "error",
        lineNum: 6,
        linePos: 3,
        message: "disposed diagnostic",
      }],
    });

    expect(await rebuilding).toEqual([]);
    expect(compute.getPipeline()).toBeNull();
    expect(compute.getUniformBuffer()).toBeNull();
    expect(compute.getCurrentOutputView()).toBeNull();
    for (const buffer of buffers) {
      expect(buffer.destroy).toHaveBeenCalledTimes(1);
    }
    for (const texture of textures) {
      expect(texture.destroy).toHaveBeenCalledTimes(1);
    }
  });

  it("dispose is idempotent and clears every public resource getter", async () => {
    const device = fakeDevice();
    const compute = new SlangComputePipeline(device, descriptor({ dispatchCount: 2 }));

    expect(compute.getPipeline()).toBeNull();
    expect(compute.getUniformBuffer()).toBeNull();
    expect(compute.getCurrentOutputView()).toBeNull();
    expect(compute.getLayerOutputView(0)).toBeNull();
    expect(compute.getPreviousLayerOutputView(0)).toBeNull();
    expect(compute.getBindGroup(0)).toBeNull();

    await compute.rebuild("// wgsl");
    compute.rebuildBindGroups([], new Map());
    const buffers = device.createBuffer.mock.results.map((result) => result.value as FakeBuffer);
    const textures = device.createTexture.mock.results.map((result) => result.value as FakeTexture);

    compute.dispose();
    compute.dispose();

    for (const buffer of buffers) {
      expect(buffer.destroy).toHaveBeenCalledTimes(1);
    }
    for (const texture of textures) {
      expect(texture.destroy).toHaveBeenCalledTimes(1);
    }
    expect(compute.getPipeline()).toBeNull();
    expect(compute.getUniformBuffer()).toBeNull();
    expect(compute.getCurrentOutputView()).toBeNull();
    expect(compute.getPreviousLayerOutputView(0)).toBeNull();
    expect(compute.getBindGroup(0)).toBeNull();
  });
});
