import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShaderConfig, StorageBufferConfig } from "@shader-studio/types";
import { WebGPURenderingEngine } from "../../webgpu/WebGPURenderingEngine";
import { sharedSlangWgslCache } from "../../webgpu/SlangWgslCache";

interface FakeBuffer {
  id: number;
  descriptor: GPUBufferDescriptor;
  destroy: ReturnType<typeof vi.fn>;
}

const assets = { scriptUrl: "slang.js", wasmUrl: "slang.wasm" };
const IMAGE_SOURCE = "float4 mainImage(float2 c) { return float4(0); }";

function storageConfig(storage: Record<string, StorageBufferConfig>): ShaderConfig {
  return {
    version: "1",
    storage,
    passes: { Image: { inputs: {} } },
  };
}

function numberedStorage(count: number): Record<string, StorageBufferConfig> {
  return Object.fromEntries(Array.from({ length: count }, (_, index) => [
    `buffer${index}`,
    { count: 1, stride: 4, elementType: "uint" },
  ]));
}

function engineHarness(limits: Partial<GPUSupportedLimits> = {}) {
  let bufferId = 0;
  const device = {
    limits,
    createShaderModule: vi.fn(() => ({
      getCompilationInfo: vi.fn(async () => ({ messages: [] })),
    })),
    createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: vi.fn(() => ({})) })),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createBuffer: vi.fn((descriptor: GPUBufferDescriptor): FakeBuffer => ({
      id: bufferId++,
      descriptor,
      destroy: vi.fn(),
    })),
    createSampler: vi.fn(() => ({})),
    createBindGroup: vi.fn(() => ({})),
    createTexture: vi.fn(() => ({
      createView: vi.fn(() => ({})),
      destroy: vi.fn(),
    })),
    queue: {
      writeBuffer: vi.fn(),
      submit: vi.fn(),
    },
  };
  type CompilerResult =
    | { success: true; wgsl: string }
    | { success: false; errors: string[] };
  const compiler = {
    compile: vi.fn(async (): Promise<CompilerResult> => ({ success: true, wgsl: "// wgsl" })),
    dispose: vi.fn(),
  };
  const engine = new WebGPURenderingEngine(assets);
  (engine as unknown as { canvas: { width: number; height: number } }).canvas = {
    width: 320,
    height: 180,
  };
  (engine as unknown as { device: GPUDevice }).device = device as unknown as GPUDevice;
  (engine as unknown as { compiler: typeof compiler }).compiler = compiler;
  (engine as unknown as { format: GPUTextureFormat }).format = "bgra8unorm";
  return { engine, device, compiler };
}

function storageCreateCalls(device: ReturnType<typeof engineHarness>["device"]): GPUBufferDescriptor[] {
  const storageUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  return device.createBuffer.mock.calls
    .map(([descriptor]) => descriptor)
    .filter((descriptor) => descriptor.usage === storageUsage);
}

function createdStorageBuffers(device: ReturnType<typeof engineHarness>["device"]): FakeBuffer[] {
  const storageUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  return device.createBuffer.mock.results
    .map((result) => result.value as FakeBuffer)
    .filter((buffer) => buffer.descriptor.usage === storageUsage);
}

function installedStorageBuffers(engine: WebGPURenderingEngine): Map<string, GPUBuffer> {
  return (engine as unknown as { storageBuffers: Map<string, GPUBuffer> }).storageBuffers;
}

describe("WebGPURenderingEngine storage buffers", () => {
  beforeEach(() => {
    sharedSlangWgslCache.clear();
  });

  it("allocates declared storage before compiling passes", async () => {
    const { engine, device, compiler } = engineHarness();

    const result = await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      storageConfig({ a: { count: 4, stride: 16, elementType: "float4" } }),
      "/image.slang",
    );

    expect(result?.success).toBe(true);
    expect(storageCreateCalls(device)).toEqual([{
      size: 64,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }]);
    expect(device.createBuffer.mock.invocationCallOrder[0]).toBeLessThan(
      compiler.compile.mock.invocationCallOrder[0],
    );
  });

  it("reuses the exact storage buffer for an identical recompile", async () => {
    const { engine, device } = engineHarness();
    const config = storageConfig({ a: { count: 4, stride: 16, elementType: "float4" } });

    await engine.compileShaderPipeline(IMAGE_SOURCE, config, "/image.slang");
    const firstBuffer = createdStorageBuffers(device)[0];
    await engine.compileShaderPipeline(IMAGE_SOURCE, config, "/image.slang");

    expect(createdStorageBuffers(device)).toEqual([firstBuffer]);
    expect(firstBuffer.destroy).not.toHaveBeenCalled();
  });

  it.each([
    ["count", { count: 8, stride: 16, elementType: "float4" }],
    ["stride", { count: 4, stride: 32, elementType: "float4" }],
    ["element type at the same byte size", { count: 4, stride: 16, elementType: "uint4" }],
  ] as const)("recreates storage when its %s changes", async (_change, declaration) => {
    const { engine, device } = engineHarness();

    await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      storageConfig({ a: { count: 4, stride: 16, elementType: "float4" } }),
      "/image.slang",
    );
    const firstBuffer = createdStorageBuffers(device)[0];
    await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      storageConfig({ a: declaration }),
      "/image.slang",
    );

    expect(createdStorageBuffers(device)).toHaveLength(2);
    expect(createdStorageBuffers(device)[1]).not.toBe(firstBuffer);
    expect(firstBuffer.destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys storage removed from the next configuration", async () => {
    const { engine, device } = engineHarness();

    await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      storageConfig({ a: { count: 4, stride: 16, elementType: "float4" } }),
      "/image.slang",
    );
    const firstBuffer = createdStorageBuffers(device)[0];
    await engine.compileShaderPipeline(IMAGE_SOURCE, storageConfig({}), "/image.slang");

    expect(createdStorageBuffers(device)).toEqual([firstBuffer]);
    expect(firstBuffer.destroy).toHaveBeenCalledTimes(1);
    expect((engine as unknown as { storageBuffers: Map<string, GPUBuffer> }).storageBuffers.size).toBe(0);
  });

  it("creates and records multiple buffers in configuration declaration order", async () => {
    const { engine, device } = engineHarness();

    await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      storageConfig({
        positions: { count: 4, stride: 16, elementType: "float4" },
        counters: { count: 3, stride: 4, elementType: "uint" },
        particles: { count: 2, stride: 32, elementType: "Particle" },
      }),
      "/image.slang",
    );

    expect(storageCreateCalls(device).map(({ size }) => size)).toEqual([64, 12, 64]);
    expect([
      ...(engine as unknown as { storageKeys: Map<string, string> }).storageKeys.keys(),
    ]).toEqual(["positions", "counters", "particles"]);
  });

  it("rejects storage count above the granted device limit before pass compilation", async () => {
    const { engine, device, compiler } = engineHarness({
      maxStorageBuffersPerShaderStage: 8,
      maxStorageBufferBindingSize: 128 * 1024 * 1024,
    });

    const result = await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      storageConfig(numberedStorage(9)),
      "/image.slang",
    );

    expect(result?.success).toBe(false);
    expect(result?.errors?.join("\n")).toMatch(/9.*limit.*8/i);
    expect(result?.errors?.join("\n")).toContain("maxStorageBuffersPerShaderStage");
    expect(result?.errors?.join("\n")).toMatch(/pack.*struct/i);
    expect(compiler.compile).not.toHaveBeenCalled();
    expect(storageCreateCalls(device)).toEqual([]);
    expect((engine as unknown as { storageBuffers: Map<string, GPUBuffer> }).storageBuffers.size).toBe(0);
  });

  it("keeps the graph baseline warning non-fatal when the device grants more buffers", async () => {
    const { engine, device } = engineHarness({
      maxStorageBuffersPerShaderStage: 16,
      maxStorageBufferBindingSize: 128 * 1024 * 1024,
    });

    const result = await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      storageConfig(numberedStorage(9)),
      "/image.slang",
    );

    expect(result?.success).toBe(true);
    expect(result?.warnings?.join("\n")).toMatch(/baseline 8/i);
    expect(createdStorageBuffers(device)).toHaveLength(9);
  });

  it("uses the baseline count limit when the granted limit is unavailable", async () => {
    const { engine } = engineHarness();

    const result = await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      storageConfig(numberedStorage(9)),
      "/image.slang",
    );

    expect(result?.success).toBe(false);
    expect(result?.errors?.join("\n")).toMatch(/9.*limit.*8/i);
  });

  it.each([1, 2, 3])(
    "rejects an effective storage byte size of %i before allocation or compilation",
    async (byteSize) => {
      const { engine, device, compiler } = engineHarness();
      await engine.compileShaderPipeline(
        IMAGE_SOURCE,
        storageConfig({ installed: { count: 1, stride: 4, elementType: "uint" } }),
        "/image.slang",
      );
      const installed = createdStorageBuffers(device)[0];
      compiler.compile.mockClear();

      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(1); }",
        storageConfig({ misaligned: { count: 1, stride: byteSize, elementType: "uint" } }),
        "/image.slang",
      );

      expect(result?.success).toBe(false);
      expect(result?.errors?.join("\n")).toMatch(
        new RegExp(`misaligned.*${byteSize}.*multiple of 4`, "i"),
      );
      expect(compiler.compile).not.toHaveBeenCalled();
      expect(createdStorageBuffers(device)).toEqual([installed]);
      expect(installedStorageBuffers(engine).get("installed")).toBe(installed);
      expect(installed.destroy).not.toHaveBeenCalled();
    },
  );

  it("accepts an effective storage byte size of exactly 4", async () => {
    const { engine, device, compiler } = engineHarness();

    const result = await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      storageConfig({ boundary: { count: 1, stride: 4, elementType: "uint" } }),
      "/image.slang",
    );

    expect(result?.success).toBe(true);
    expect(storageCreateCalls(device)).toEqual([{
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }]);
    expect(compiler.compile).toHaveBeenCalledTimes(1);
  });

  it("rejects an individual buffer above the granted binding-size limit", async () => {
    const { engine, device, compiler } = engineHarness({
      maxStorageBuffersPerShaderStage: 8,
      maxStorageBufferBindingSize: 64,
    });

    const result = await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      storageConfig({ particles: { count: 5, stride: 16, elementType: "float4" } }),
      "/image.slang",
    );

    expect(result?.success).toBe(false);
    expect(result?.errors?.join("\n")).toMatch(/particles.*80.*64/i);
    expect(result?.errors?.join("\n")).toContain("maxStorageBufferBindingSize");
    expect(result?.errors?.join("\n")).toMatch(/pack|reduc/i);
    expect(compiler.compile).not.toHaveBeenCalled();
    expect(storageCreateCalls(device)).toEqual([]);
  });

  it("accepts an individual buffer exactly at the granted binding-size limit", async () => {
    const { engine, device } = engineHarness({
      maxStorageBuffersPerShaderStage: 8,
      maxStorageBufferBindingSize: 64,
    });

    const result = await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      storageConfig({ particles: { count: 4, stride: 16, elementType: "float4" } }),
      "/image.slang",
    );

    expect(result?.success).toBe(true);
    expect(storageCreateCalls(device)[0].size).toBe(64);
  });

  it("uses the WebGPU 128 MiB floor when the granted binding-size limit is unavailable", async () => {
    const { engine } = engineHarness({ maxStorageBuffersPerShaderStage: 8 });
    const requiredBytes = 128 * 1024 * 1024 + 4;

    const result = await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      storageConfig({ huge: { count: 1, stride: requiredBytes, elementType: "uint" } }),
      "/image.slang",
    );

    expect(result?.success).toBe(false);
    expect(result?.errors?.join("\n")).toMatch(
      new RegExp(`huge.*${requiredBytes}.*${128 * 1024 * 1024}`, "i"),
    );
  });

  it("leaves existing storage untouched when count-limit validation fails", async () => {
    const { engine, device } = engineHarness({
      maxStorageBuffersPerShaderStage: 8,
      maxStorageBufferBindingSize: 128 * 1024 * 1024,
    });
    await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      storageConfig({ a: { count: 4, stride: 16, elementType: "float4" } }),
      "/image.slang",
    );
    const firstBuffer = createdStorageBuffers(device)[0];

    const result = await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      storageConfig(numberedStorage(9)),
      "/image.slang",
    );

    expect(result?.success).toBe(false);
    expect(createdStorageBuffers(device)).toEqual([firstBuffer]);
    expect(firstBuffer.destroy).not.toHaveBeenCalled();
    expect([
      ...(engine as unknown as { storageBuffers: Map<string, GPUBuffer> }).storageBuffers.keys(),
    ]).toEqual(["a"]);
  });

  it("leaves existing storage untouched when binding-size validation fails", async () => {
    const { engine, device } = engineHarness({
      maxStorageBuffersPerShaderStage: 8,
      maxStorageBufferBindingSize: 64,
    });
    await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      storageConfig({ a: { count: 4, stride: 16, elementType: "float4" } }),
      "/image.slang",
    );
    const firstBuffer = createdStorageBuffers(device)[0];

    const result = await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      storageConfig({ a: { count: 5, stride: 16, elementType: "float4" } }),
      "/image.slang",
    );

    expect(result?.success).toBe(false);
    expect(createdStorageBuffers(device)).toEqual([firstBuffer]);
    expect(firstBuffer.destroy).not.toHaveBeenCalled();
  });

  it("re-zeroes storage on reset by recreating the same GPU descriptors", async () => {
    const { engine, device } = engineHarness();
    const config = storageConfig({ a: { count: 4, stride: 16, elementType: "float4" } });
    await engine.compileShaderPipeline(IMAGE_SOURCE, config, "/image.slang");
    const firstBuffer = createdStorageBuffers(device)[0];

    engine.resetTime();

    const buffersAfterReset = createdStorageBuffers(device);
    expect(buffersAfterReset).toHaveLength(2);
    expect(buffersAfterReset[1].descriptor).toEqual(firstBuffer.descriptor);
    expect(firstBuffer.destroy).toHaveBeenCalledTimes(1);
    expect(device.queue.writeBuffer).not.toHaveBeenCalledWith(
      buffersAfterReset[1],
      0,
      expect.anything(),
    );

    await engine.compileShaderPipeline(IMAGE_SOURCE, config, "/image.slang");
    expect(createdStorageBuffers(device)).toHaveLength(2);
    expect(buffersAfterReset[1].destroy).not.toHaveBeenCalled();
  });

  it("re-zeroes retained storage layout after a valid shader file switch", async () => {
    const { engine, device } = engineHarness();
    const config = storageConfig({ a: { count: 4, stride: 16, elementType: "float4" } });
    await engine.compileShaderPipeline(IMAGE_SOURCE, config, "/first.slang");
    const firstBuffer = createdStorageBuffers(device)[0];

    const result = await engine.compileShaderPipeline(IMAGE_SOURCE, config, "/second.slang");

    expect(result?.success).toBe(true);
    expect(createdStorageBuffers(device)).toHaveLength(2);
    expect(firstBuffer.destroy).toHaveBeenCalledTimes(1);
    engine.resetTime();
    expect(createdStorageBuffers(device)).toHaveLength(3);
    expect(createdStorageBuffers(device)[1].destroy).toHaveBeenCalledTimes(1);
  });

  it("supersedes an identical-layout compile pending during reset and keeps the reset buffer", async () => {
    const { engine, device, compiler } = engineHarness();
    const config = storageConfig({ a: { count: 4, stride: 16, elementType: "float4" } });
    await engine.compileShaderPipeline(IMAGE_SOURCE, config, "/image.slang");
    const installedA = createdStorageBuffers(device)[0];
    let resolvePending!: (result: { success: true; wgsl: string }) => void;
    compiler.compile.mockImplementationOnce(() => new Promise((resolve) => {
      resolvePending = resolve;
    }));

    const pending = engine.compileShaderPipeline(
      "float4 mainImage(float2 c) { return float4(1); }",
      config,
      "/image.slang",
    );
    await vi.waitFor(() => expect(compiler.compile).toHaveBeenCalledTimes(2));

    engine.resetTime();
    const resetBuffer = createdStorageBuffers(device)[1];
    expect(installedA.destroy).toHaveBeenCalledTimes(1);
    expect(installedStorageBuffers(engine).get("a")).toBe(resetBuffer);
    expect(resetBuffer.destroy).not.toHaveBeenCalled();

    resolvePending({ success: true, wgsl: "// pending" });
    const staleResult = await pending;

    expect(staleResult).toEqual({
      success: false,
      errors: ["Superseded by a newer compile"],
      superseded: true,
    });
    expect(installedStorageBuffers(engine).get("a")).toBe(resetBuffer);
    expect(resetBuffer.destroy).not.toHaveBeenCalled();

    const reused = await engine.compileShaderPipeline(
      "float4 mainImage(float2 c) { return float4(1); }",
      config,
      "/image.slang",
    );
    expect(reused?.success).toBe(true);
    expect(createdStorageBuffers(device)).toHaveLength(2);
    expect(installedStorageBuffers(engine).get("a")).toBe(resetBuffer);
    expect(resetBuffer.destroy).not.toHaveBeenCalled();
  });

  it("reset discards owned staging while a partially reused compile awaits pipeline diagnostics", async () => {
    const { engine, device } = engineHarness();
    const configA = storageConfig({
      shared: { count: 4, stride: 16, elementType: "float4" },
      changed: { count: 4, stride: 16, elementType: "float4" },
    });
    const configB = storageConfig({
      shared: { count: 4, stride: 16, elementType: "float4" },
      changed: { count: 8, stride: 16, elementType: "float4" },
    });
    await engine.compileShaderPipeline(IMAGE_SOURCE, configA, "/image.slang");
    const [installedShared, installedChanged] = createdStorageBuffers(device);
    let resolvePipelineInfo!: (result: { messages: [] }) => void;
    device.createShaderModule.mockImplementationOnce(() => ({
      getCompilationInfo: vi.fn(() => new Promise((resolve) => {
        resolvePipelineInfo = resolve;
      })),
    }));

    const pending = engine.compileShaderPipeline(
      "float4 mainImage(float2 c) { return float4(2); }",
      configB,
      "/image.slang",
    );
    await vi.waitFor(() => expect(resolvePipelineInfo).toBeTypeOf("function"));
    const stagedChanged = createdStorageBuffers(device)[2];

    engine.resetTime();
    const resetShared = createdStorageBuffers(device)[3];
    const resetChanged = createdStorageBuffers(device)[4];
    expect(stagedChanged.destroy).toHaveBeenCalledTimes(1);
    expect(installedShared.destroy).toHaveBeenCalledTimes(1);
    expect(installedChanged.destroy).toHaveBeenCalledTimes(1);
    expect(installedStorageBuffers(engine)).toEqual(new Map([
      ["shared", resetShared],
      ["changed", resetChanged],
    ]));

    resolvePipelineInfo({ messages: [] });
    const staleResult = await pending;

    expect(staleResult).toEqual({
      success: false,
      errors: ["Superseded by a newer compile"],
      superseded: true,
    });
    expect(stagedChanged.destroy).toHaveBeenCalledTimes(1);
    expect(resetShared.destroy).not.toHaveBeenCalled();
    expect(resetChanged.destroy).not.toHaveBeenCalled();

    const reused = await engine.compileShaderPipeline(IMAGE_SOURCE, configA, "/image.slang");
    expect(reused?.success).toBe(true);
    expect(createdStorageBuffers(device)).toHaveLength(5);
    expect(installedStorageBuffers(engine)).toEqual(new Map([
      ["shared", resetShared],
      ["changed", resetChanged],
    ]));
  });

  it("does not mutate existing storage when pass-graph validation fails", async () => {
    const { engine, device, compiler } = engineHarness();
    await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      storageConfig({ a: { count: 4, stride: 16, elementType: "float4" } }),
      "/image.slang",
    );
    const firstBuffer = createdStorageBuffers(device)[0];
    compiler.compile.mockClear();

    const result = await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      {
        version: "1",
        storage: { b: { count: 2, stride: 4, elementType: "uint" } },
        passes: {
          Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA" } } },
          BufferA: { path: "missing.slang", inputs: {} },
        },
      },
      "/broken.slang",
      {},
    );

    expect(result?.success).toBe(false);
    expect(result?.errors?.join("\n")).toMatch(/BufferA/);
    expect(createdStorageBuffers(device)).toEqual([firstBuffer]);
    expect(firstBuffer.destroy).not.toHaveBeenCalled();
    expect(compiler.compile).not.toHaveBeenCalled();
    expect([
      ...(engine as unknown as { storageBuffers: Map<string, GPUBuffer> }).storageBuffers.keys(),
    ]).toEqual(["a"]);
  });

  it("discards staged storage before retrying after a compiler error", async () => {
    const { engine, device, compiler } = engineHarness();
    compiler.compile
      .mockResolvedValueOnce({ success: false, errors: ["bad shader"] })
      .mockResolvedValueOnce({ success: true, wgsl: "// wgsl" });
    const config = storageConfig({ a: { count: 4, stride: 16, elementType: "float4" } });

    const failed = await engine.compileShaderPipeline(IMAGE_SOURCE, config, "/image.slang");
    const failedBuffer = createdStorageBuffers(device)[0];
    const retried = await engine.compileShaderPipeline(IMAGE_SOURCE, config, "/image.slang");

    expect(failed?.success).toBe(false);
    expect(retried?.success).toBe(true);
    expect(createdStorageBuffers(device)).toHaveLength(2);
    expect(failedBuffer.destroy).toHaveBeenCalledTimes(1);
    expect(createdStorageBuffers(device)[1].destroy).not.toHaveBeenCalled();
    expect(compiler.compile).toHaveBeenCalledTimes(2);
  });

  it("discards staged storage before retrying after a pipeline error", async () => {
    const { engine, device } = engineHarness();
    device.createRenderPipeline.mockImplementationOnce(() => {
      throw new Error("pipeline failed");
    });
    const config = storageConfig({ a: { count: 4, stride: 16, elementType: "float4" } });

    const failed = await engine.compileShaderPipeline(IMAGE_SOURCE, config, "/image.slang");
    const failedBuffer = createdStorageBuffers(device)[0];
    const retried = await engine.compileShaderPipeline(IMAGE_SOURCE, config, "/image.slang");

    expect(failed?.success).toBe(false);
    expect(retried?.success).toBe(true);
    expect(createdStorageBuffers(device)).toHaveLength(2);
    expect(failedBuffer.destroy).toHaveBeenCalledTimes(1);
    expect(createdStorageBuffers(device)[1].destroy).not.toHaveBeenCalled();
  });

  it("keeps changed storage staged until its compile installs successfully", async () => {
    const { engine, device, compiler } = engineHarness();
    const configA = storageConfig({ a: { count: 4, stride: 16, elementType: "float4" } });
    const configB = storageConfig({ a: { count: 8, stride: 16, elementType: "float4" } });
    await engine.compileShaderPipeline(IMAGE_SOURCE, configA, "/image.slang");
    const bufferA = createdStorageBuffers(device)[0];
    let resolveB!: (result: { success: true; wgsl: string }) => void;
    compiler.compile.mockImplementationOnce(() => new Promise((resolve) => {
      resolveB = resolve;
    }));

    const pendingB = engine.compileShaderPipeline(
      "float4 mainImage(float2 c) { return float4(1); }",
      configB,
      "/image.slang",
    );
    await vi.waitFor(() => expect(compiler.compile).toHaveBeenCalledTimes(2));
    const bufferB = createdStorageBuffers(device)[1];

    expect(installedStorageBuffers(engine).get("a")).toBe(bufferA);
    expect(bufferA.destroy).not.toHaveBeenCalled();
    expect(bufferB.destroy).not.toHaveBeenCalled();

    resolveB({ success: true, wgsl: "// changed B" });
    const resultB = await pendingB;

    expect(resultB?.success).toBe(true);
    expect(installedStorageBuffers(engine).get("a")).toBe(bufferB);
    expect(bufferA.destroy).toHaveBeenCalledTimes(1);
    expect(bufferB.destroy).not.toHaveBeenCalled();
  });

  it("preserves installed storage and discards a changed stage on compiler failure", async () => {
    const { engine, device, compiler } = engineHarness();
    const configA = storageConfig({ a: { count: 4, stride: 16, elementType: "float4" } });
    const configB = storageConfig({ a: { count: 8, stride: 16, elementType: "float4" } });
    await engine.compileShaderPipeline(IMAGE_SOURCE, configA, "/image.slang");
    const bufferA = createdStorageBuffers(device)[0];
    compiler.compile.mockResolvedValueOnce({ success: false, errors: ["bad B"] });

    const failedB = await engine.compileShaderPipeline(
      "float4 mainImage(float2 c) { return float4(1); }",
      configB,
      "/image.slang",
    );
    const failedBufferB = createdStorageBuffers(device)[1];

    expect(failedB?.success).toBe(false);
    expect(installedStorageBuffers(engine).get("a")).toBe(bufferA);
    expect(bufferA.destroy).not.toHaveBeenCalled();
    expect(failedBufferB.destroy).toHaveBeenCalledTimes(1);

    const retriedB = await engine.compileShaderPipeline(
      "float4 mainImage(float2 c) { return float4(1); }",
      configB,
      "/image.slang",
    );
    const installedBufferB = createdStorageBuffers(device)[2];
    expect(retriedB?.success).toBe(true);
    expect(installedStorageBuffers(engine).get("a")).toBe(installedBufferB);
    expect(bufferA.destroy).toHaveBeenCalledTimes(1);
    expect(installedBufferB.destroy).not.toHaveBeenCalled();
  });

  it("preserves installed storage and discards a changed stage on pipeline failure", async () => {
    const { engine, device } = engineHarness();
    const configA = storageConfig({ a: { count: 4, stride: 16, elementType: "float4" } });
    const configB = storageConfig({ a: { count: 8, stride: 16, elementType: "float4" } });
    await engine.compileShaderPipeline(IMAGE_SOURCE, configA, "/image.slang");
    const bufferA = createdStorageBuffers(device)[0];
    device.createRenderPipeline.mockImplementationOnce(() => {
      throw new Error("pipeline B failed");
    });

    const failedB = await engine.compileShaderPipeline(
      "float4 mainImage(float2 c) { return float4(1); }",
      configB,
      "/image.slang",
    );
    const failedBufferB = createdStorageBuffers(device)[1];

    expect(failedB?.success).toBe(false);
    expect(installedStorageBuffers(engine).get("a")).toBe(bufferA);
    expect(bufferA.destroy).not.toHaveBeenCalled();
    expect(failedBufferB.destroy).toHaveBeenCalledTimes(1);

    const retriedB = await engine.compileShaderPipeline(
      "float4 mainImage(float2 c) { return float4(1); }",
      configB,
      "/image.slang",
    );
    const installedBufferB = createdStorageBuffers(device)[2];
    expect(retriedB?.success).toBe(true);
    expect(installedStorageBuffers(engine).get("a")).toBe(installedBufferB);
    expect(bufferA.destroy).toHaveBeenCalledTimes(1);
    expect(installedBufferB.destroy).not.toHaveBeenCalled();
  });

  it("discards changed staged storage when resource loading throws", async () => {
    const { engine, device } = engineHarness();
    const configA = storageConfig({ a: { count: 4, stride: 16, elementType: "float4" } });
    await engine.compileShaderPipeline(IMAGE_SOURCE, configA, "/image.slang");
    const bufferA = createdStorageBuffers(device)[0];
    (engine as unknown as { resourceManager: unknown }).resourceManager = {
      loadImageTexture: vi.fn(async () => {
        throw new Error("texture load failed");
      }),
    };

    await expect(engine.compileShaderPipeline(
      "float4 mainImage(float2 c) { return float4(1); }",
      {
        version: "1",
        storage: { a: { count: 8, stride: 16, elementType: "float4" } },
        passes: {
          Image: { inputs: { iChannel0: { type: "texture", path: "missing.png" } } },
        },
      },
      "/image.slang",
    )).rejects.toThrow("texture load failed");
    const failedBufferB = createdStorageBuffers(device)[1];

    expect(installedStorageBuffers(engine).get("a")).toBe(bufferA);
    expect(bufferA.destroy).not.toHaveBeenCalled();
    expect(failedBufferB.destroy).toHaveBeenCalledTimes(1);
  });

  it("promptly discards pending changed storage when a newer graph failure is issued", async () => {
    const { engine, device, compiler } = engineHarness();
    const configA = storageConfig({ a: { count: 4, stride: 16, elementType: "float4" } });
    const configB = storageConfig({ a: { count: 8, stride: 16, elementType: "float4" } });
    await engine.compileShaderPipeline(IMAGE_SOURCE, configA, "/image.slang");
    const bufferA = createdStorageBuffers(device)[0];
    let resolveB!: (result: { success: true; wgsl: string }) => void;
    compiler.compile.mockImplementationOnce(() => new Promise((resolve) => {
      resolveB = resolve;
    }));

    const pendingB = engine.compileShaderPipeline(
      "float4 mainImage(float2 c) { return float4(1); }",
      configB,
      "/image.slang",
    );
    await vi.waitFor(() => expect(compiler.compile).toHaveBeenCalledTimes(2));
    const bufferB = createdStorageBuffers(device)[1];

    const failedCPromise = engine.compileShaderPipeline(
      IMAGE_SOURCE,
      {
        version: "1",
        storage: { a: { count: 2, stride: 4, elementType: "uint" } },
        passes: {
          Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA" } } },
          BufferA: { path: "missing.slang", inputs: {} },
        },
      },
      "/image.slang",
    );
    expect(bufferB.destroy).toHaveBeenCalledTimes(1);
    expect(installedStorageBuffers(engine).get("a")).toBe(bufferA);
    expect(bufferA.destroy).not.toHaveBeenCalled();

    const failedC = await failedCPromise;
    resolveB({ success: true, wgsl: "// changed B" });
    const supersededB = await pendingB;

    expect(failedC?.success).toBe(false);
    expect(supersededB).toEqual({
      success: false,
      errors: ["Superseded by a newer compile"],
      superseded: true,
    });
    expect(installedStorageBuffers(engine).get("a")).toBe(bufferA);
    expect(bufferA.destroy).not.toHaveBeenCalled();
    expect(bufferB.destroy).toHaveBeenCalledTimes(1);

    const reusedA = await engine.compileShaderPipeline(IMAGE_SOURCE, configA, "/image.slang");
    expect(reusedA?.success).toBe(true);
    expect(createdStorageBuffers(device)).toHaveLength(2);
    expect(installedStorageBuffers(engine).get("a")).toBe(bufferA);
    expect(bufferA.destroy).not.toHaveBeenCalled();
  });

  it("does not stage storage when superseded while awaiting initialization", async () => {
    const { engine, device, compiler } = engineHarness();
    let resolveReady!: () => void;
    (engine as unknown as { ready: Promise<void> }).ready = new Promise((resolve) => {
      resolveReady = resolve;
    });

    const pendingB = engine.compileShaderPipeline(
      IMAGE_SOURCE,
      storageConfig({ stagedTooLate: { count: 4, stride: 16, elementType: "float4" } }),
      "/image.slang",
    );
    const pendingC = engine.compileShaderPipeline(
      IMAGE_SOURCE,
      {
        version: "1",
        passes: {
          Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA" } } },
          BufferA: { path: "missing.slang", inputs: {} },
        },
      },
      "/image.slang",
    );

    expect(storageCreateCalls(device)).toEqual([]);
    resolveReady();
    const [supersededB, failedC] = await Promise.all([pendingB, pendingC]);

    expect(supersededB).toEqual({
      success: false,
      errors: ["Superseded by a newer compile"],
      superseded: true,
    });
    expect(failedC?.success).toBe(false);
    expect(storageCreateCalls(device)).toEqual([]);
    expect(compiler.compile).not.toHaveBeenCalled();
  });

  it("cleans installed and staged storage when disposed during a pending compile", async () => {
    const { engine, device, compiler } = engineHarness();
    const configA = storageConfig({ a: { count: 4, stride: 16, elementType: "float4" } });
    const configB = storageConfig({ a: { count: 8, stride: 16, elementType: "float4" } });
    await engine.compileShaderPipeline(IMAGE_SOURCE, configA, "/image.slang");
    const bufferA = createdStorageBuffers(device)[0];
    let resolveB!: (result: { success: true; wgsl: string }) => void;
    compiler.compile.mockImplementationOnce(() => new Promise((resolve) => {
      resolveB = resolve;
    }));

    const pendingB = engine.compileShaderPipeline(
      "float4 mainImage(float2 c) { return float4(1); }",
      configB,
      "/image.slang",
    );
    await vi.waitFor(() => expect(compiler.compile).toHaveBeenCalledTimes(2));
    const bufferB = createdStorageBuffers(device)[1];
    expect(installedStorageBuffers(engine).get("a")).toBe(bufferA);

    engine.dispose();
    expect(bufferA.destroy).toHaveBeenCalledTimes(1);
    expect(bufferB.destroy).toHaveBeenCalledTimes(1);
    expect(installedStorageBuffers(engine).size).toBe(0);

    resolveB({ success: true, wgsl: "// changed B" });
    const staleB = await pendingB;
    engine.dispose();

    expect(staleB).toEqual({
      success: false,
      errors: ["Superseded by a newer compile"],
      superseded: true,
    });
    expect(bufferA.destroy).toHaveBeenCalledTimes(1);
    expect(bufferB.destroy).toHaveBeenCalledTimes(1);
    expect(installedStorageBuffers(engine).size).toBe(0);
  });

  it("destroys and clears all storage exactly once on repeated disposal", async () => {
    const { engine, device } = engineHarness();
    await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      storageConfig({
        a: { count: 4, stride: 16, elementType: "float4" },
        b: { count: 2, stride: 4, elementType: "uint" },
      }),
      "/image.slang",
    );
    const buffers = createdStorageBuffers(device);

    engine.dispose();
    engine.dispose();

    for (const buffer of buffers) {
      expect(buffer.destroy).toHaveBeenCalledTimes(1);
    }
    expect((engine as unknown as { storageBuffers: Map<string, GPUBuffer> }).storageBuffers.size).toBe(0);
    expect((engine as unknown as { storageKeys: Map<string, string> }).storageKeys.size).toBe(0);
    expect((engine as unknown as { storageLayouts: Map<string, unknown> }).storageLayouts.size).toBe(0);
  });
});
