import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShaderConfig, StorageBufferConfig } from "@shader-studio/types";
import { WebGPURenderingEngine } from "../../webgpu/WebGPURenderingEngine";
import { SlangComputePipeline } from "../../webgpu/SlangComputePipeline";
import { sharedSlangWgslCache } from "../../webgpu/SlangWgslCache";
import { ResourceManager } from "../../resources/ResourceManager";

interface FakeBuffer {
  descriptor: GPUBufferDescriptor;
  destroy: ReturnType<typeof vi.fn>;
}

interface FakeTexture {
  descriptor: GPUTextureDescriptor;
  createView: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

type CompileResult =
  | { success: true; wgsl: string }
  | { success: false; errors: string[] };

const IMAGE_SOURCE = "float4 mainImage(float2 c) { return float4(0); }";
const COMPUTE_SOURCE = "void computeMain(uint3 tid) {}";

function computeConfig(options: {
  sampled?: boolean;
  outputLayers?: number;
  workgroupSize?: [number, number, number];
  dispatchCount?: number;
  storage?: Record<string, StorageBufferConfig>;
  additionalPasses?: ShaderConfig["passes"];
} = {}): ShaderConfig {
  const outputLayers = options.outputLayers ?? 1;
  return {
    version: "1",
    storage: options.storage,
    passes: {
      ComputeSim: {
        path: "compute.slang",
        outputLayers,
        workgroupSize: options.workgroupSize,
        dispatchCount: options.dispatchCount,
      },
      ...options.additionalPasses,
      Image: {
        inputs: options.sampled
          ? { iChannel0: { type: "buffer", source: "ComputeSim", layer: 0 } }
          : {},
      },
    },
  };
}

function harness() {
  const buffers: FakeBuffer[] = [];
  const textures: FakeTexture[] = [];
  const device = {
    limits: {},
    createShaderModule: vi.fn(() => ({
      getCompilationInfo: vi.fn(async () => ({ messages: [] })),
    })),
    createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: vi.fn(() => ({})) })),
    createComputePipeline: vi.fn(() => ({ label: "compute-pipeline" })),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createBuffer: vi.fn((descriptor: GPUBufferDescriptor) => {
      const buffer = { descriptor, destroy: vi.fn() };
      buffers.push(buffer);
      return buffer;
    }),
    createSampler: vi.fn(() => ({})),
    createBindGroup: vi.fn(() => ({})),
    createTexture: vi.fn((descriptor: GPUTextureDescriptor) => {
      const texture = {
        descriptor,
        createView: vi.fn(() => ({})),
        destroy: vi.fn(),
      };
      textures.push(texture);
      return texture;
    }),
    queue: {
      writeBuffer: vi.fn(),
      writeTexture: vi.fn(),
      copyExternalImageToTexture: vi.fn(),
      submit: vi.fn(),
    },
  };
  const compiler = {
    compile: vi.fn(async (_source: string, options: { passName?: string }): Promise<CompileResult> => ({
      success: true,
      wgsl: `// ${options.passName ?? "pass"}`,
    })),
    dispose: vi.fn(),
  };
  const engine = new WebGPURenderingEngine({ scriptUrl: "slang.js", wasmUrl: "slang.wasm" });
  (engine as unknown as { canvas: { width: number; height: number } }).canvas = {
    width: 320,
    height: 180,
  };
  (engine as unknown as { device: GPUDevice }).device = device as unknown as GPUDevice;
  (engine as unknown as { compiler: typeof compiler }).compiler = compiler;
  (engine as unknown as { format: GPUTextureFormat }).format = "bgra8unorm";
  return { engine, device, compiler, buffers, textures };
}

function storageBuffers(buffers: FakeBuffer[]): FakeBuffer[] {
  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  return buffers.filter(({ descriptor }) => descriptor.usage === usage);
}

function dispatchBuffers(buffers: FakeBuffer[]): FakeBuffer[] {
  return buffers.filter(({ descriptor }) => descriptor.size === 16);
}

function uniformBuffers(buffers: FakeBuffer[]): FakeBuffer[] {
  const usage = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
  return buffers.filter(({ descriptor }) => descriptor.size === 48 && descriptor.usage === usage);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe("WebGPURenderingEngine compute compilation", () => {
  beforeEach(() => {
    sharedSlangWgslCache.clear();
  });

  it("builds ComputeSim as a compute pipeline while Image remains a render pipeline", async () => {
    const { engine, device, compiler } = harness();

    const result = await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig(),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );

    expect(result?.success).toBe(true);
    expect(engine.getPasses().map(({ name, kind }) => [name, kind])).toEqual([
      ["ComputeSim", "compute"],
      ["Image", "render"],
    ]);
    expect(device.createComputePipeline).toHaveBeenCalledTimes(1);
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(1);
    expect(compiler.compile).toHaveBeenNthCalledWith(1, COMPUTE_SOURCE, {
      passName: "ComputeSim",
      commonCode: "",
      channels: [],
      storage: [],
      passKind: "compute",
      workgroupSize: [8, 8, 1],
      outputLayers: 1,
      hasOutput: false,
    });
    expect(compiler.compile).toHaveBeenNthCalledWith(2, IMAGE_SOURCE, {
      passName: "Image",
      commonCode: "",
      channels: [],
      storage: [],
      passKind: "render",
      workgroupSize: [8, 8, 1],
      outputLayers: 1,
      hasOutput: false,
    });
  });

  it("passes sampled layered output through compiler options and GPU texture layout", async () => {
    const { engine, device, compiler, textures } = harness();

    const result = await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({ sampled: true, outputLayers: 3, workgroupSize: [4, 2, 1] }),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );

    expect(result?.success).toBe(true);
    expect(compiler.compile).toHaveBeenCalledWith(COMPUTE_SOURCE, expect.objectContaining({
      passKind: "compute",
      workgroupSize: [4, 2, 1],
      outputLayers: 3,
      hasOutput: true,
    }));
    expect(textures).toHaveLength(2);
    for (const texture of textures) {
      expect(texture.descriptor).toEqual({
        size: { width: 320, height: 180, depthOrArrayLayers: 3 },
        format: "rgba16float",
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      });
    }
    expect(device.createBindGroupLayout).toHaveBeenCalledWith({
      entries: expect.arrayContaining([
        expect.objectContaining({
          storageTexture: expect.objectContaining({ viewDimension: "2d-array" }),
        }),
      ]),
    });
  });

  it("does not allocate output textures for an unsampled compute pass", async () => {
    const { engine, device, textures } = harness();

    await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({ outputLayers: 3 }),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );

    expect(device.createComputePipeline).toHaveBeenCalledTimes(1);
    expect(textures).toEqual([]);
    const computeLayout = device.createBindGroupLayout.mock.calls[0][0];
    expect(computeLayout.entries.some((entry: GPUBindGroupLayoutEntry) => entry.storageTexture)).toBe(false);
  });

  it.each([
    ["workgroup size", computeConfig({ workgroupSize: [4, 4, 1] })],
    ["output layers", computeConfig({ outputLayers: 2 })],
    ["dispatch count", computeConfig({ dispatchCount: 2 })],
    ["output state", computeConfig({ sampled: true })],
  ])("rebuilds the compute pipeline when %s changes", async (_label, changedConfig) => {
    const { engine, device, compiler } = harness();
    await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig(),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );

    const result = await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      changedConfig,
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );

    expect(result?.success).toBe(true);
    expect(device.createComputePipeline).toHaveBeenCalledTimes(2);
    expect(compiler.compile.mock.calls.filter(([, options]) =>
      options.passName === "ComputeSim")).toHaveLength(2);
  });

  it.each<[string, Record<string, StorageBufferConfig>]>([
    ["name", { renamed: { count: 4, stride: 16, elementType: "float4" } }],
    ["element type", { particles: { count: 4, stride: 16, elementType: "uint4" } }],
    ["count", { particles: { count: 8, stride: 16, elementType: "float4" } }],
    ["stride", { particles: { count: 4, stride: 32, elementType: "float4" } }],
  ])(
    "rebuilds the compute pipeline when storage %s changes",
    async (_label, storage) => {
      const { engine, device, compiler } = harness();
      await engine.compileShaderPipeline(
        IMAGE_SOURCE,
        computeConfig({
          storage: { particles: { count: 4, stride: 16, elementType: "float4" } },
        }),
        "/shader.slang",
        { ComputeSim: COMPUTE_SOURCE },
      );

      const result = await engine.compileShaderPipeline(
        IMAGE_SOURCE,
        computeConfig({ storage }),
        "/shader.slang",
        { ComputeSim: COMPUTE_SOURCE },
      );

      expect(result?.success).toBe(true);
      expect(device.createComputePipeline).toHaveBeenCalledTimes(2);
      expect(compiler.compile.mock.calls.filter(([, options]) =>
        options.passName === "ComputeSim")).toHaveLength(2);
    },
  );

  it("reuses an identical compute pipeline and resizes it without recompiling", async () => {
    const { engine, device, compiler, textures } = harness();
    const config = computeConfig({ sampled: true });
    await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      config,
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    const initialTextures = [...textures];

    (engine as unknown as { canvas: { width: number; height: number } }).canvas = {
      width: 640,
      height: 360,
    };
    const result = await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      config,
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );

    expect(result?.success).toBe(true);
    expect(device.createComputePipeline).toHaveBeenCalledTimes(1);
    expect(compiler.compile).toHaveBeenCalledTimes(2);
    expect(initialTextures.every((texture) => texture.destroy.mock.calls.length === 1)).toBe(true);
    expect(textures.slice(2).map(({ descriptor }) => descriptor.size)).toEqual([
      { width: 640, height: 360, depthOrArrayLayers: 1 },
      { width: 640, height: 360, depthOrArrayLayers: 1 },
    ]);
  });

  it("passes storage to render compilation as read-only wrapper input", async () => {
    const { engine, compiler } = harness();
    const storage = { particles: { count: 4, stride: 16, elementType: "float4" } };

    await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      { version: "1", storage, passes: { Image: { inputs: {} } } },
      "/shader.slang",
    );

    expect(compiler.compile).toHaveBeenCalledWith(IMAGE_SOURCE, expect.objectContaining({
      passKind: "render",
      storage: [{
        name: "particles",
        binding: 0,
        elementType: "float4",
        builtin: true,
        count: 4,
        stride: 16,
      }],
    }));
  });

  it("keeps the installed path live while a different-path compile is pending and after it fails", async () => {
    const { engine, compiler, buffers, textures } = harness();
    const config = computeConfig({
      sampled: true,
      storage: { particles: { count: 4, stride: 16, elementType: "float4" } },
    });
    await engine.compileShaderPipeline(IMAGE_SOURCE, config, "/a.slang", {
      ComputeSim: COMPUTE_SOURCE,
    });
    const installedTextures = [...textures];
    const installedDispatch = dispatchBuffers(buffers)[0];
    const installedStorage = storageBuffers(buffers)[0];
    const blocked = deferred<CompileResult>();
    compiler.compile.mockImplementationOnce(() => blocked.promise);

    const pending = engine.compileShaderPipeline(IMAGE_SOURCE, config, "/b.slang", {
      ComputeSim: "compute B",
    });
    await vi.waitFor(() => expect(compiler.compile).toHaveBeenCalledWith(
      "compute B",
      expect.objectContaining({ passName: "ComputeSim" }),
    ));

    expect(engine.getPasses()[0].source).toBe(COMPUTE_SOURCE);
    expect(installedTextures.every(({ destroy }) => destroy.mock.calls.length === 0)).toBe(true);
    expect(installedDispatch.destroy).not.toHaveBeenCalled();
    expect(installedStorage.destroy).not.toHaveBeenCalled();
    expect((engine as unknown as { shaderPath: string }).shaderPath).toBe("/a.slang");

    blocked.resolve({ success: false, errors: ["broken B"] });
    const result = await pending;

    expect(result).toMatchObject({ success: false, errors: ["ComputeSim: broken B"] });
    expect(engine.getPasses()[0].source).toBe(COMPUTE_SOURCE);
    expect(installedTextures.every(({ destroy }) => destroy.mock.calls.length === 0)).toBe(true);
    expect(installedDispatch.destroy).not.toHaveBeenCalled();
    expect(installedStorage.destroy).not.toHaveBeenCalled();
    expect(storageBuffers(buffers)[1].destroy).toHaveBeenCalledTimes(1);
    expect((engine as unknown as { shaderPath: string }).shaderPath).toBe("/a.slang");
  });

  it("keeps the installed path live when a pending path switch is superseded by a failure", async () => {
    const { engine, compiler, buffers, textures } = harness();
    const config = computeConfig({
      sampled: true,
      storage: { particles: { count: 4, stride: 16, elementType: "float4" } },
    });
    await engine.compileShaderPipeline(IMAGE_SOURCE, config, "/a.slang", {
      ComputeSim: COMPUTE_SOURCE,
    });
    const installedTextures = [...textures];
    const installedDispatch = dispatchBuffers(buffers)[0];
    const installedStorage = storageBuffers(buffers)[0];
    const blocked = deferred<CompileResult>();
    compiler.compile.mockImplementationOnce(() => blocked.promise);

    const pendingB = engine.compileShaderPipeline(IMAGE_SOURCE, config, "/b.slang", {
      ComputeSim: "compute B",
    });
    await vi.waitFor(() => expect(compiler.compile).toHaveBeenCalledWith(
      "compute B",
      expect.objectContaining({ passName: "ComputeSim" }),
    ));
    const failedC = await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      { version: "1" } as ShaderConfig,
      "/c.slang",
    );
    blocked.resolve({ success: true, wgsl: "// stale B" });
    const staleB = await pendingB;

    expect(failedC?.success).toBe(false);
    expect(staleB).toEqual({
      success: false,
      errors: ["Superseded by a newer compile"],
      superseded: true,
    });
    expect(engine.getPasses()[0].source).toBe(COMPUTE_SOURCE);
    expect(installedTextures.every(({ destroy }) => destroy.mock.calls.length === 0)).toBe(true);
    expect(installedDispatch.destroy).not.toHaveBeenCalled();
    expect(installedStorage.destroy).not.toHaveBeenCalled();
    expect((engine as unknown as { shaderPath: string }).shaderPath).toBe("/a.slang");
  });

  it("commits a successful path switch with fresh pipelines, storage, and session state", async () => {
    const { engine, compiler, device, buffers, textures } = harness();
    const config = computeConfig({
      sampled: true,
      storage: { particles: { count: 4, stride: 16, elementType: "float4" } },
    });
    await engine.compileShaderPipeline(IMAGE_SOURCE, config, "/a.slang", {
      ComputeSim: COMPUTE_SOURCE,
    });
    const installedTextures = [...textures];
    const installedDispatch = dispatchBuffers(buffers)[0];
    const installedStorage = storageBuffers(buffers)[0];
    const cleanupResources = vi.fn();
    (engine as unknown as { resourceManager: { cleanup: typeof cleanupResources; dispose: typeof cleanupResources } })
      .resourceManager = { cleanup: cleanupResources, dispose: cleanupResources };
    const cleanupTime = vi.spyOn(engine.getTimeManager(), "cleanup");
    const blocked = deferred<CompileResult>();
    compiler.compile.mockImplementationOnce(() => blocked.promise);

    const pending = engine.compileShaderPipeline(IMAGE_SOURCE, config, "/b.slang", {
      ComputeSim: "compute B",
    });
    await vi.waitFor(() => expect(compiler.compile).toHaveBeenCalledWith(
      "compute B",
      expect.objectContaining({ passName: "ComputeSim" }),
    ));
    const stagedStorage = storageBuffers(buffers)[1];
    expect(installedTextures.every(({ destroy }) => destroy.mock.calls.length === 0)).toBe(true);
    expect(installedDispatch.destroy).not.toHaveBeenCalled();
    expect(installedStorage.destroy).not.toHaveBeenCalled();
    expect(stagedStorage).not.toBe(installedStorage);
    expect(cleanupResources).not.toHaveBeenCalled();
    expect(cleanupTime).not.toHaveBeenCalled();
    expect((engine as unknown as { shaderPath: string }).shaderPath).toBe("/a.slang");

    blocked.resolve({ success: true, wgsl: "// compute B" });
    const result = await pending;

    expect(result?.success).toBe(true);
    expect(device.createComputePipeline).toHaveBeenCalledTimes(2);
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(2);
    expect(installedTextures.every(({ destroy }) => destroy.mock.calls.length === 1)).toBe(true);
    expect(installedDispatch.destroy).toHaveBeenCalledTimes(1);
    expect(installedStorage.destroy).toHaveBeenCalledTimes(1);
    expect(stagedStorage.destroy).not.toHaveBeenCalled();
    expect(cleanupResources).toHaveBeenCalledTimes(1);
    expect(cleanupTime).toHaveBeenCalledTimes(1);
    expect((engine as unknown as { shaderPath: string }).shaderPath).toBe("/b.slang");
  });

  it("releases staged storage when path-session resource construction throws", async () => {
    const { engine, device, buffers, textures } = harness();
    const installedConfig = computeConfig({
      sampled: true,
      storage: { particles: { count: 4, stride: 16, elementType: "float4" } },
    });
    await engine.compileShaderPipeline(IMAGE_SOURCE, installedConfig, "/a.slang", {
      ComputeSim: COMPUTE_SOURCE,
    });
    const installedStorage = storageBuffers(buffers)[0];
    const installedPasses = engine.getPasses();
    const installedTextureCount = textures.length;
    const installedResourceManager = { dispose: vi.fn() };
    (engine as unknown as { resourceManager: typeof installedResourceManager })
      .resourceManager = installedResourceManager;
    device.queue.writeTexture.mockImplementationOnce(() => {
      throw new Error("default texture allocation failed");
    });

    const pending = engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({
        sampled: true,
        storage: { particles: { count: 8, stride: 16, elementType: "float4" } },
      }),
      "/b.slang",
      { ComputeSim: "compute B" },
    );
    const stagedStorage = storageBuffers(buffers)[1];

    await expect(pending).rejects.toThrow("default texture allocation failed");
    const partialCandidateTexture = textures[installedTextureCount];
    expect(stagedStorage.destroy).toHaveBeenCalledTimes(1);
    expect(partialCandidateTexture.destroy).toHaveBeenCalledTimes(1);
    expect(installedStorage.destroy).not.toHaveBeenCalled();
    expect(installedResourceManager.dispose).not.toHaveBeenCalled();
    expect(engine.getPasses()).toBe(installedPasses);
    expect(textures.slice(0, installedTextureCount)
      .every(({ destroy }) => destroy.mock.calls.length === 0)).toBe(true);
    expect((engine as unknown as { shaderPath: string }).shaderPath).toBe("/a.slang");
  });

  it("releases staged storage and candidate resources when path-session media setup throws", async () => {
    const { engine, buffers, textures } = harness();
    const installedConfig = computeConfig({
      sampled: true,
      storage: { particles: { count: 4, stride: 16, elementType: "float4" } },
    });
    await engine.compileShaderPipeline(IMAGE_SOURCE, installedConfig, "/a.slang", {
      ComputeSim: COMPUTE_SOURCE,
    });
    const installedStorage = storageBuffers(buffers)[0];
    const installedPasses = engine.getPasses();
    const installedTextureCount = textures.length;
    const installedResourceManager = { dispose: vi.fn() };
    (engine as unknown as { resourceManager: typeof installedResourceManager })
      .resourceManager = installedResourceManager;
    const setupSpy = vi.spyOn(ResourceManager.prototype, "setGlobalAudioState")
      .mockImplementationOnce(() => {
        throw new Error("media setup failed");
      });

    try {
      const pending = engine.compileShaderPipeline(
        IMAGE_SOURCE,
        computeConfig({
          sampled: true,
          storage: { particles: { count: 8, stride: 16, elementType: "float4" } },
        }),
        "/b.slang",
        { ComputeSim: "compute B" },
      );
      const stagedStorage = storageBuffers(buffers)[1];

      await expect(pending).rejects.toThrow("media setup failed");
      const candidateDefaultTexture = textures[installedTextureCount];
      expect(stagedStorage.destroy).toHaveBeenCalledTimes(1);
      expect(candidateDefaultTexture.destroy).toHaveBeenCalledTimes(1);
      expect(installedStorage.destroy).not.toHaveBeenCalled();
      expect(installedResourceManager.dispose).not.toHaveBeenCalled();
      expect(engine.getPasses()).toBe(installedPasses);
      expect((engine as unknown as { shaderPath: string }).shaderPath).toBe("/a.slang");
    } finally {
      setupSpy.mockRestore();
    }
  });

  it("preserves installed compute and storage state across compiler and WGSL failures", async () => {
    const { engine, device, compiler, buffers, textures } = harness();
    const installedConfig = computeConfig({
      sampled: true,
      storage: { particles: { count: 4, stride: 16, elementType: "float4" } },
    });
    await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      installedConfig,
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    const installedTextures = [...textures];
    const installedStorage = storageBuffers(buffers)[0];

    compiler.compile.mockImplementationOnce(async () => ({
      success: false,
      errors: ["ComputeSim: syntax error"],
    }));
    const compilerFailure = await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({
        sampled: true,
        storage: { particles: { count: 8, stride: 16, elementType: "float4" } },
      }),
      "/shader.slang",
      { ComputeSim: "compiler broken" },
    );
    const compilerFailureStorage = storageBuffers(buffers)[1];

    expect(compilerFailure).toMatchObject({
      success: false,
      errors: ["ComputeSim: syntax error"],
    });
    expect(engine.getPasses()[0].source).toBe(COMPUTE_SOURCE);
    expect(installedTextures.every(({ destroy }) => destroy.mock.calls.length === 0)).toBe(true);
    expect(installedStorage.destroy).not.toHaveBeenCalled();
    expect(compilerFailureStorage.destroy).toHaveBeenCalledTimes(1);

    device.createShaderModule.mockImplementationOnce(() => ({
      getCompilationInfo: vi.fn(async () => ({
        messages: [{ type: "error", lineNum: 7, linePos: 3, message: "invalid WGSL" }],
      })),
    }));
    const texturesBeforeWgslFailure = textures.length;
    const wgslFailure = await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({
        sampled: true,
        storage: { particles: { count: 8, stride: 16, elementType: "float4" } },
      }),
      "/shader.slang",
      { ComputeSim: "wgsl broken" },
    );
    const failedCandidateTextures = textures.slice(texturesBeforeWgslFailure);
    const wgslFailureStorage = storageBuffers(buffers)[2];

    expect(wgslFailure).toMatchObject({
      success: false,
      errors: ["ComputeSim: WGSL L7:3 invalid WGSL"],
    });
    expect(installedTextures.every(({ destroy }) => destroy.mock.calls.length === 0)).toBe(true);
    expect(failedCandidateTextures).toHaveLength(2);
    expect(failedCandidateTextures.every(({ destroy }) => destroy.mock.calls.length === 1)).toBe(true);
    expect(installedStorage.destroy).not.toHaveBeenCalled();
    expect(wgslFailureStorage.destroy).toHaveBeenCalledTimes(1);
  });

  it("reports a thrown compute pipeline error with the pass name exactly once", async () => {
    const { engine, device } = harness();
    device.createComputePipeline.mockImplementationOnce(() => {
      throw new Error("ComputeSim: pipeline validation failed");
    });

    const result = await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig(),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );

    expect(result).toMatchObject({
      success: false,
      errors: ["ComputeSim: pipeline validation failed"],
    });
  });

  it("disposes a removed compute pipeline and does not destroy it again on engine disposal", async () => {
    const { engine, buffers, textures } = harness();
    await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({ sampled: true }),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    const computeTextures = [...textures];
    const computeDispatch = dispatchBuffers(buffers)[0];

    const result = await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      { version: "1", passes: { Image: { inputs: {} } } },
      "/shader.slang",
    );

    expect(result?.success).toBe(true);
    expect(engine.getPasses().map(({ name }) => name)).toEqual(["Image"]);
    expect(computeTextures.every(({ destroy }) => destroy.mock.calls.length === 1)).toBe(true);
    expect(computeDispatch.destroy).toHaveBeenCalledTimes(1);

    engine.dispose();
    engine.dispose();
    expect(computeTextures.every(({ destroy }) => destroy.mock.calls.length === 1)).toBe(true);
    expect(computeDispatch.destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys a live compute pipeline exactly once when the engine is disposed repeatedly", async () => {
    const { engine, buffers } = harness();
    await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig(),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    const computeDispatch = dispatchBuffers(buffers)[0];

    engine.dispose();
    engine.dispose();

    expect(computeDispatch.destroy).toHaveBeenCalledTimes(1);
  });

  it("builds multiple compute nodes in graph order and caches them independently", async () => {
    const { engine, device, compiler } = harness();
    const config: ShaderConfig = {
      version: "1",
      passes: {
        ComputeFirst: { path: "first.slang" },
        ComputeSecond: { path: "second.slang" },
        Image: { inputs: {} },
      },
    };

    await engine.compileShaderPipeline(IMAGE_SOURCE, config, "/shader.slang", {
      ComputeFirst: "void computeMain(uint3 tid) { int first = 1; }",
      ComputeSecond: "void computeMain(uint3 tid) { int second = 2; }",
    });

    expect(compiler.compile.mock.calls.map(([source]) => source)).toEqual([
      "void computeMain(uint3 tid) { int first = 1; }",
      "void computeMain(uint3 tid) { int second = 2; }",
      IMAGE_SOURCE,
    ]);
    expect(device.createComputePipeline).toHaveBeenCalledTimes(2);

    compiler.compile.mockClear();
    await engine.compileShaderPipeline(IMAGE_SOURCE, config, "/shader.slang", {
      ComputeFirst: "void computeMain(uint3 tid) { int first = 1; }",
      ComputeSecond: "void computeMain(uint3 tid) { int second = 3; }",
    });

    expect(compiler.compile).toHaveBeenCalledTimes(1);
    expect(compiler.compile).toHaveBeenCalledWith(
      "void computeMain(uint3 tid) { int second = 3; }",
      expect.objectContaining({ passName: "ComputeSecond", passKind: "compute" }),
    );
    expect(device.createComputePipeline).toHaveBeenCalledTimes(3);
  });

  it("keeps the newest compute candidate and storage when an older compile resolves late", async () => {
    const { engine, compiler, buffers, textures } = harness();
    const baselineConfig = computeConfig({
      sampled: true,
      storage: { particles: { count: 4, stride: 16, elementType: "float4" } },
    });
    await engine.compileShaderPipeline(IMAGE_SOURCE, baselineConfig, "/shader.slang", {
      ComputeSim: COMPUTE_SOURCE,
    });
    const baselineTextures = [...textures];
    const baselineStorage = storageBuffers(buffers)[0];

    const blocked = deferred<CompileResult>();
    compiler.compile.mockImplementation((source: string, options: { passName?: string }) => {
      if (source === "compute B") {
        return blocked.promise;
      }
      return Promise.resolve({ success: true, wgsl: `// ${options.passName ?? "pass"}` });
    });
    const pendingB = engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({
        sampled: true,
        storage: { particles: { count: 8, stride: 16, elementType: "float4" } },
      }),
      "/shader.slang",
      { ComputeSim: "compute B" },
    );
    await vi.waitFor(() => expect(storageBuffers(buffers)).toHaveLength(2));
    const stagedBStorage = storageBuffers(buffers)[1];

    const resultC = await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({
        sampled: true,
        storage: { particles: { count: 12, stride: 16, elementType: "float4" } },
      }),
      "/shader.slang",
      { ComputeSim: "compute C" },
    );
    const winnerTextures = textures.slice(2, 4);
    const winnerStorage = storageBuffers(buffers)[2];

    expect(resultC?.success).toBe(true);
    expect(stagedBStorage.destroy).toHaveBeenCalledTimes(1);
    expect(baselineStorage.destroy).toHaveBeenCalledTimes(1);
    expect(winnerStorage.destroy).not.toHaveBeenCalled();
    expect(baselineTextures.every(({ destroy }) => destroy.mock.calls.length === 1)).toBe(true);
    expect(winnerTextures.every(({ destroy }) => destroy.mock.calls.length === 0)).toBe(true);

    blocked.resolve({ success: true, wgsl: "// compute B" });
    const staleB = await pendingB;
    const staleTextures = textures.slice(4, 6);

    expect(staleB).toEqual({
      success: false,
      errors: ["Superseded by a newer compile"],
      superseded: true,
    });
    expect(staleTextures.every(({ destroy }) => destroy.mock.calls.length === 1)).toBe(true);
    expect(winnerTextures.every(({ destroy }) => destroy.mock.calls.length === 0)).toBe(true);
    expect(winnerStorage.destroy).not.toHaveBeenCalled();
    expect(stagedBStorage.destroy).toHaveBeenCalledTimes(1);

    await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({
        sampled: true,
        storage: { particles: { count: 12, stride: 16, elementType: "float4" } },
      }),
      "/shader.slang",
      { ComputeSim: "compute C" },
    );
    expect(storageBuffers(buffers)).toHaveLength(3);
    expect(winnerStorage.destroy).not.toHaveBeenCalled();
  });

  it("never disposes a reused predecessor from a stale generation after its replacement installs", async () => {
    const { engine, compiler } = harness();
    const config: ShaderConfig = {
      version: "1",
      passes: {
        ComputeStable: { path: "stable.slang" },
        ComputeBlocked: { path: "blocked.slang" },
        Image: { inputs: { iChannel0: { type: "buffer", source: "ComputeStable" } } },
      },
    };
    await engine.compileShaderPipeline(IMAGE_SOURCE, config, "/shader.slang", {
      ComputeStable: "stable baseline",
      ComputeBlocked: "blocked baseline",
    });
    const installed = (engine as unknown as {
      computePipelines: Map<string, SlangComputePipeline>;
    }).computePipelines;
    const predecessor = installed.get("ComputeStable")!;
    const predecessorDispose = vi.spyOn(predecessor, "dispose");
    const blockedA = deferred<CompileResult>();
    compiler.compile.mockImplementation((source: string, options: { passName?: string }) => {
      if (source === "blocked A") {
        return blockedA.promise;
      }
      return Promise.resolve({ success: true, wgsl: `// ${options.passName ?? "pass"}` });
    });

    const pendingA = engine.compileShaderPipeline(IMAGE_SOURCE, config, "/shader.slang", {
      ComputeStable: "stable baseline",
      ComputeBlocked: "blocked A",
    });
    await vi.waitFor(() => expect(compiler.compile).toHaveBeenCalledWith(
      "blocked A",
      expect.objectContaining({ passName: "ComputeBlocked" }),
    ));
    const resultB = await engine.compileShaderPipeline(IMAGE_SOURCE, config, "/shader.slang", {
      ComputeStable: "stable B",
      ComputeBlocked: "blocked B",
    });
    const winner = (engine as unknown as {
      computePipelines: Map<string, SlangComputePipeline>;
    }).computePipelines.get("ComputeStable")!;
    const winnerDispose = vi.spyOn(winner, "dispose");

    expect(resultB?.success).toBe(true);
    expect(winner).not.toBe(predecessor);
    expect(predecessorDispose).toHaveBeenCalledTimes(1);
    expect(winnerDispose).not.toHaveBeenCalled();

    blockedA.resolve({ success: true, wgsl: "// blocked A" });
    const staleA = await pendingA;

    expect(staleA).toEqual({
      success: false,
      errors: ["Superseded by a newer compile"],
      superseded: true,
    });
    expect(predecessorDispose).toHaveBeenCalledTimes(1);
    expect(winnerDispose).not.toHaveBeenCalled();
  });

  it("discards a pending compute candidate and staged storage when resetTime supersedes it", async () => {
    const { engine, compiler, buffers, textures } = harness();
    const blocked = deferred<CompileResult>();
    compiler.compile.mockImplementationOnce(() => blocked.promise);

    const pending = engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({
        sampled: true,
        storage: { particles: { count: 4, stride: 16, elementType: "float4" } },
      }),
      "/shader.slang",
      { ComputeSim: "pending compute" },
    );
    await vi.waitFor(() => expect(storageBuffers(buffers)).toHaveLength(1));
    const stagedStorage = storageBuffers(buffers)[0];

    engine.resetTime();
    expect(stagedStorage.destroy).toHaveBeenCalledTimes(1);
    blocked.resolve({ success: true, wgsl: "// pending compute" });
    const result = await pending;

    expect(result).toEqual({
      success: false,
      errors: ["Superseded by a newer compile"],
      superseded: true,
    });
    expect(engine.getPasses()).toEqual([]);
    expect(textures).toEqual([]);
    expect(stagedStorage.destroy).toHaveBeenCalledTimes(1);
  });

  it("immediately disposes an allocated compute candidate when resetTime supersedes diagnostics", async () => {
    const { engine, device, buffers, textures } = harness();
    const diagnostics = deferred<{ messages: [] }>();
    device.createShaderModule.mockImplementationOnce(() => ({
      getCompilationInfo: vi.fn(() => diagnostics.promise),
    }));

    const pending = engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({
        sampled: true,
        storage: { particles: { count: 4, stride: 16, elementType: "float4" } },
      }),
      "/shader.slang",
      { ComputeSim: "pending diagnostics" },
    );
    await vi.waitFor(() => expect(textures).toHaveLength(2));
    const candidateTextures = [...textures];
    const candidateDispatch = dispatchBuffers(buffers)[0];
    const stagedStorage = storageBuffers(buffers)[0];

    engine.resetTime();

    expect(candidateTextures.every(({ destroy }) => destroy.mock.calls.length === 1)).toBe(true);
    expect(candidateDispatch.destroy).toHaveBeenCalledTimes(1);
    expect(stagedStorage.destroy).toHaveBeenCalledTimes(1);

    diagnostics.resolve({ messages: [] });
    const result = await pending;
    expect(result).toEqual({
      success: false,
      errors: ["Superseded by a newer compile"],
      superseded: true,
    });
    expect(candidateTextures.every(({ destroy }) => destroy.mock.calls.length === 1)).toBe(true);
    expect(candidateDispatch.destroy).toHaveBeenCalledTimes(1);
  });

  it("immediately disposes an allocated compute candidate when the engine is disposed", async () => {
    const { engine, device, buffers, textures } = harness();
    const diagnostics = deferred<{ messages: [] }>();
    device.createShaderModule.mockImplementationOnce(() => ({
      getCompilationInfo: vi.fn(() => diagnostics.promise),
    }));

    const pending = engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({
        sampled: true,
        storage: { particles: { count: 4, stride: 16, elementType: "float4" } },
      }),
      "/shader.slang",
      { ComputeSim: "pending diagnostics" },
    );
    await vi.waitFor(() => expect(textures).toHaveLength(2));
    const candidateTextures = [...textures];
    const candidateDispatch = dispatchBuffers(buffers)[0];
    const stagedStorage = storageBuffers(buffers)[0];

    engine.dispose();

    expect(candidateTextures.every(({ destroy }) => destroy.mock.calls.length === 1)).toBe(true);
    expect(candidateDispatch.destroy).toHaveBeenCalledTimes(1);
    expect(stagedStorage.destroy).toHaveBeenCalledTimes(1);

    diagnostics.resolve({ messages: [] });
    const result = await pending;
    expect(result).toEqual({
      success: false,
      errors: ["Superseded by a newer compile"],
      superseded: true,
    });
    expect(candidateTextures.every(({ destroy }) => destroy.mock.calls.length === 1)).toBe(true);
    expect(candidateDispatch.destroy).toHaveBeenCalledTimes(1);
  });

  it("immediately disposes an allocated compute candidate when a newer generation starts", async () => {
    const { engine, device, buffers, textures } = harness();
    const diagnostics = deferred<{ messages: [] }>();
    device.createShaderModule.mockImplementationOnce(() => ({
      getCompilationInfo: vi.fn(() => diagnostics.promise),
    }));

    const pendingA = engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({ sampled: true }),
      "/shader.slang",
      { ComputeSim: "pending diagnostics A" },
    );
    await vi.waitFor(() => expect(textures).toHaveLength(2));
    const candidateTextures = [...textures];
    const candidateDispatch = dispatchBuffers(buffers)[0];

    const failedB = await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      { version: "1" } as ShaderConfig,
      "/shader.slang",
    );

    expect(failedB?.success).toBe(false);
    expect(candidateTextures.every(({ destroy }) => destroy.mock.calls.length === 1)).toBe(true);
    expect(candidateDispatch.destroy).toHaveBeenCalledTimes(1);

    diagnostics.resolve({ messages: [] });
    const staleA = await pendingA;
    expect(staleA).toEqual({
      success: false,
      errors: ["Superseded by a newer compile"],
      superseded: true,
    });
    expect(candidateTextures.every(({ destroy }) => destroy.mock.calls.length === 1)).toBe(true);
    expect(candidateDispatch.destroy).toHaveBeenCalledTimes(1);
  });

  it("does not let a disposed render candidate resurrect after async pipeline creation", async () => {
    const { engine, device, buffers } = harness();
    const pendingPipeline = deferred<GPURenderPipeline>();
    const createRenderPipelineAsync = vi.fn(() => pendingPipeline.promise);
    (device as unknown as { createRenderPipelineAsync: typeof createRenderPipelineAsync })
      .createRenderPipelineAsync = createRenderPipelineAsync;

    const pending = engine.compileShaderPipeline(
      IMAGE_SOURCE,
      { version: "1", passes: { Image: { inputs: {} } } },
      "/shader.slang",
    );
    await vi.waitFor(() => expect(createRenderPipelineAsync).toHaveBeenCalledTimes(1));

    engine.resetTime();
    pendingPipeline.resolve({ label: "late render pipeline" } as unknown as GPURenderPipeline);
    const result = await pending;

    expect(result).toEqual({
      success: false,
      errors: ["Superseded by a newer compile"],
      superseded: true,
    });
    expect(uniformBuffers(buffers)).toEqual([]);
  });

  it("immediately disposes an allocated render candidate while diagnostics are pending", async () => {
    const { engine, device, buffers } = harness();
    const diagnostics = deferred<{ messages: [] }>();
    device.createShaderModule.mockImplementationOnce(() => ({
      getCompilationInfo: vi.fn(() => diagnostics.promise),
    }));

    const pending = engine.compileShaderPipeline(
      IMAGE_SOURCE,
      { version: "1", passes: { Image: { inputs: {} } } },
      "/shader.slang",
    );
    await vi.waitFor(() => expect(uniformBuffers(buffers)).toHaveLength(1));
    const candidateUniform = uniformBuffers(buffers)[0];

    engine.resetTime();

    expect(candidateUniform.destroy).toHaveBeenCalledTimes(1);
    diagnostics.resolve({ messages: [] });
    const result = await pending;

    expect(result).toEqual({
      success: false,
      errors: ["Superseded by a newer compile"],
      superseded: true,
    });
    expect(candidateUniform.destroy).toHaveBeenCalledTimes(1);
  });

  it("disposes staged storage without resurrecting compute resources when disposed mid-rebuild", async () => {
    const { engine, device, compiler, buffers, textures } = harness();
    const blockedPipeline = deferred<GPUComputePipeline>();
    const createComputePipelineAsync = vi.fn(() => blockedPipeline.promise);
    (device as unknown as { createComputePipelineAsync: typeof createComputePipelineAsync })
      .createComputePipelineAsync = createComputePipelineAsync;

    const pending = engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({
        sampled: true,
        storage: { particles: { count: 4, stride: 16, elementType: "float4" } },
      }),
      "/shader.slang",
      { ComputeSim: "pending pipeline" },
    );
    await vi.waitFor(() => expect(createComputePipelineAsync).toHaveBeenCalledTimes(1));
    const stagedStorage = storageBuffers(buffers)[0];

    engine.dispose();
    expect(compiler.dispose).toHaveBeenCalledTimes(1);
    expect(stagedStorage.destroy).toHaveBeenCalledTimes(1);
    blockedPipeline.resolve({ label: "late compute pipeline" } as unknown as GPUComputePipeline);
    const result = await pending;

    expect(result).toEqual({
      success: false,
      errors: ["Superseded by a newer compile"],
      superseded: true,
    });
    expect(textures).toEqual([]);
    expect(dispatchBuffers(buffers)).toEqual([]);
    expect(stagedStorage.destroy).toHaveBeenCalledTimes(1);
  });
});
