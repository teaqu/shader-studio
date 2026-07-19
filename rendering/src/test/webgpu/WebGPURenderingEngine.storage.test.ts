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

  it("reuses synced storage when retrying after a compiler error", async () => {
    const { engine, device, compiler } = engineHarness();
    compiler.compile
      .mockResolvedValueOnce({ success: false, errors: ["bad shader"] })
      .mockResolvedValueOnce({ success: true, wgsl: "// wgsl" });
    const config = storageConfig({ a: { count: 4, stride: 16, elementType: "float4" } });

    const failed = await engine.compileShaderPipeline(IMAGE_SOURCE, config, "/image.slang");
    const retried = await engine.compileShaderPipeline(IMAGE_SOURCE, config, "/image.slang");

    expect(failed?.success).toBe(false);
    expect(retried?.success).toBe(true);
    expect(createdStorageBuffers(device)).toHaveLength(1);
    expect(createdStorageBuffers(device)[0].destroy).not.toHaveBeenCalled();
    expect(compiler.compile).toHaveBeenCalledTimes(2);
  });

  it("reuses synced storage when retrying after a pipeline error", async () => {
    const { engine, device } = engineHarness();
    device.createRenderPipeline.mockImplementationOnce(() => {
      throw new Error("pipeline failed");
    });
    const config = storageConfig({ a: { count: 4, stride: 16, elementType: "float4" } });

    const failed = await engine.compileShaderPipeline(IMAGE_SOURCE, config, "/image.slang");
    const retried = await engine.compileShaderPipeline(IMAGE_SOURCE, config, "/image.slang");

    expect(failed?.success).toBe(false);
    expect(retried?.success).toBe(true);
    expect(createdStorageBuffers(device)).toHaveLength(1);
    expect(createdStorageBuffers(device)[0].destroy).not.toHaveBeenCalled();
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
