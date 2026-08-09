import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BufferResolution,
  ComputeDispatch,
  ConfigInput,
  ShaderConfig,
  StorageBufferConfig,
} from "@shader-studio/types";
import { WebGPURenderingEngine } from "../../webgpu/WebGPURenderingEngine";
import { SlangComputePipeline } from "../../webgpu/SlangComputePipeline";
import { sharedSlangWgslCache } from "../../webgpu/SlangWgslCache";
import { VideoTextureManager } from "../../resources/VideoTextureManager";
import { WebGPUTextureBackend } from "../../webgpu/WebGPUTextureBackend";
import { SHADERTOY_UNIFORM_SIZE } from "../../webgpu/SlangPrelude";

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

type ComputeFailureMethod = "setPipeline" | "setBindGroup" | "dispatchWorkgroups" | "end";

const IMAGE_SOURCE = "float4 mainImage(float2 c) { return float4(0); }";
function computeSource(label: string): string {
  return `[shader("compute")] [numthreads(8, 8, 1)] void computeMainEntry(uint3 tid : SV_DispatchThreadID) { /* ${label} */ }`;
}

const COMPUTE_SOURCE = computeSource("default");
const NATIVE_COMPUTE_SOURCE = '[shader("compute")] [numthreads(8, 8, 1)] void computeMain(uint3 tid : SV_DispatchThreadID) {}';

function computeConfig(options: {
  sampled?: boolean;
  outputLayers?: number;
  dispatch?: ComputeDispatch;
  dispatchCount?: number;
  dispatchOnce?: boolean;
  resolution?: BufferResolution;
  inputs?: Record<string, ConfigInput>;
  storage?: Record<string, StorageBufferConfig>;
  additionalPasses?: ShaderConfig["passes"];
} = {}): ShaderConfig {
  const outputLayers = options.outputLayers ?? 1;
  return {
    version: "1",
    storage: options.storage,
    passes: {
      ComputeSim: { type: 'compute',
        path: "compute.slang",
        outputLayers,
        dispatch: options.dispatch,
        dispatchCount: options.dispatchCount,
        dispatchOnce: options.dispatchOnce,
        resolution: options.resolution,
        inputs: options.inputs,
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
  const commandEvents: Array<{ type: string; value?: unknown }> = [];
  const computePasses: Array<{
    setPipeline: ReturnType<typeof vi.fn>;
    setBindGroup: ReturnType<typeof vi.fn>;
    dispatchWorkgroups: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  }> = [];
  const computeFailure: {
    method: ComputeFailureMethod | null;
    pass: number;
    call: number;
    error: Error;
    endError: Error | null;
  } = {
    method: null,
    pass: 1,
    call: 1,
    error: new Error("compute encoder operation failed"),
    endError: null,
  };
  const renderFailure: {
    method: "setPipeline" | "draw" | null;
    pass: number;
    error: Error;
  } = {
    method: null,
    pass: 1,
    error: new Error("render encoder operation failed"),
  };
  let finishFailure: Error | null = null;
  let submitFailure: Error | null = null;
  let renderPassCount = 0;
  let bindGroupId = 0;
  let computePipelineId = 0;
  const device = {
    limits: { maxComputeWorkgroupsPerDimension: 65_535 },
    createShaderModule: vi.fn(() => ({
      getCompilationInfo: vi.fn(async () => ({ messages: [] })),
    })),
    createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: vi.fn(() => ({})) })),
    createComputePipeline: vi.fn(() => ({ label: `compute-pipeline-${computePipelineId++}` })),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createBuffer: vi.fn((descriptor: GPUBufferDescriptor) => {
      const buffer = { descriptor, destroy: vi.fn() };
      buffers.push(buffer);
      return buffer;
    }),
    createSampler: vi.fn(() => ({})),
    createBindGroup: vi.fn((descriptor: GPUBindGroupDescriptor) => ({
      id: bindGroupId++,
      descriptor,
    })),
    createTexture: vi.fn((descriptor: GPUTextureDescriptor) => {
      const textureId = textures.length;
      const texture = {
        descriptor,
        createView: vi.fn((viewDescriptor?: GPUTextureViewDescriptor) => ({
          textureId,
          descriptor: viewDescriptor,
        })),
        destroy: vi.fn(),
      };
      textures.push(texture);
      return texture;
    }),
    createCommandEncoder: vi.fn(() => ({
      beginComputePass: vi.fn(() => {
        commandEvents.push({ type: "beginComputePass" });
        const passNumber = computePasses.length + 1;
        const calls: Record<ComputeFailureMethod, number> = {
          setPipeline: 0,
          setBindGroup: 0,
          dispatchWorkgroups: 0,
          end: 0,
        };
        const failIfConfigured = (method: ComputeFailureMethod) => {
          calls[method]++;
          if (
            computeFailure.method === method &&
            computeFailure.pass === passNumber &&
            computeFailure.call === calls[method]
          ) {
            computeFailure.method = null;
            throw computeFailure.error;
          }
        };
        const computePass = {
          setPipeline: vi.fn((pipeline: GPUComputePipeline) => {
            commandEvents.push({ type: "compute.setPipeline", value: pipeline });
            failIfConfigured("setPipeline");
          }),
          setBindGroup: vi.fn((_index: number, bindGroup: GPUBindGroup) => {
            commandEvents.push({ type: "compute.setBindGroup", value: bindGroup });
            failIfConfigured("setBindGroup");
          }),
          dispatchWorkgroups: vi.fn((x: number, y: number, z: number) => {
            commandEvents.push({ type: "dispatchWorkgroups", value: [x, y, z] });
            failIfConfigured("dispatchWorkgroups");
          }),
          end: vi.fn(() => {
            commandEvents.push({ type: "endComputePass" });
            if (computeFailure.endError) {
              const error = computeFailure.endError;
              computeFailure.endError = null;
              throw error;
            }
            failIfConfigured("end");
          }),
        };
        computePasses.push(computePass);
        return computePass;
      }),
      beginRenderPass: vi.fn(() => {
        commandEvents.push({ type: "beginRenderPass" });
        const passNumber = ++renderPassCount;
        const failIfConfigured = (method: "setPipeline" | "draw") => {
          if (renderFailure.method === method && renderFailure.pass === passNumber) {
            renderFailure.method = null;
            throw renderFailure.error;
          }
        };
        return {
          setPipeline: vi.fn((pipeline: GPURenderPipeline) => {
            commandEvents.push({ type: "render.setPipeline", value: pipeline });
            failIfConfigured("setPipeline");
          }),
          setBindGroup: vi.fn((_index: number, bindGroup: GPUBindGroup) => {
            commandEvents.push({ type: "render.setBindGroup", value: bindGroup });
          }),
          draw: vi.fn(() => {
            commandEvents.push({ type: "draw" });
            failIfConfigured("draw");
          }),
          end: vi.fn(() => commandEvents.push({ type: "endRenderPass" })),
        };
      }),
      finish: vi.fn(() => {
        if (finishFailure) {
          const error = finishFailure;
          finishFailure = null;
          throw error;
        }
        const commandBuffer = { label: "frame-command-buffer" };
        commandEvents.push({ type: "finish", value: commandBuffer });
        return commandBuffer;
      }),
    })),
    queue: {
      writeBuffer: vi.fn(),
      writeTexture: vi.fn(),
      copyExternalImageToTexture: vi.fn(),
      submit: vi.fn((buffers: GPUCommandBuffer[]) => {
        if (submitFailure) {
          const error = submitFailure;
          submitFailure = null;
          throw error;
        }
        commandEvents.push({ type: "submit", value: buffers });
      }),
    },
    pushErrorScope: vi.fn(),
    popErrorScope: vi.fn(async () => null),
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
  return {
    engine,
    device,
    compiler,
    buffers,
    textures,
    commandEvents,
    computePasses,
    computeFailure,
    renderFailure,
    setFinishFailure(error: Error) {
      finishFailure = error;
    },
    setSubmitFailure(error: Error) {
      submitFailure = error;
    },
  };
}

function enableRendering(testHarness: ReturnType<typeof harness>): void {
  (testHarness.engine as unknown as { context: GPUCanvasContext }).context = {
    getCurrentTexture: vi.fn(() => ({
      createView: vi.fn(() => ({ label: "canvas-view" })),
    })),
  } as unknown as GPUCanvasContext;
  testHarness.commandEvents.length = 0;
  testHarness.device.createCommandEncoder.mockClear();
  testHarness.device.queue.writeBuffer.mockClear();
  testHarness.device.queue.submit.mockClear();
}

function storageBuffers(buffers: FakeBuffer[]): FakeBuffer[] {
  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
  return buffers.filter(({ descriptor }) => descriptor.usage === usage);
}

function dispatchBuffers(buffers: FakeBuffer[]): FakeBuffer[] {
  return buffers.filter(({ descriptor }) => descriptor.size === 16);
}

function uniformBuffers(buffers: FakeBuffer[]): FakeBuffer[] {
  const usage = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
  return buffers.filter(({ descriptor }) =>
    descriptor.size === SHADERTOY_UNIFORM_SIZE && descriptor.usage === usage);
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
      outputImageFormat: "rgba16f",
      hasOutput: false,
      entryPoint: "computeMainEntry",
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

  it("compiles a shared multi-entry source separately for each selected entry point", async () => {
    const { engine, compiler } = harness();
    const source = `
      [shader("compute")] [numthreads(8, 8, 1)]
      void clearSamples(uint3 id : SV_DispatchThreadID) {}
      [shader("compute")] [numthreads(8, 8, 1)]
      void animateSamples(uint3 id : SV_DispatchThreadID) {}
    `;
    const config: ShaderConfig = {
      version: "1",
      passes: {
        ComputeClear: { type: 'compute', path: "kernels.slang", entryPoint: "clearSamples" },
        ComputeAnimate: { type: 'compute', path: "kernels.slang", entryPoint: "animateSamples" },
        Image: { inputs: {} },
      },
    };

    const result = await engine.compileShaderPipeline(IMAGE_SOURCE, config, "/shader.slang", {
      ComputeClear: source,
      ComputeAnimate: source,
    });

    expect(result?.success).toBe(true);
    expect(compiler.compile.mock.calls
      .filter(([, options]) => options.passKind === "compute")
      .map(([, options]) => options.entryPoint))
      .toEqual(["clearSamples", "animateSamples"]);
  });

  it("uses the active device workgroup limits for a larger compute pipeline", async () => {
    const { engine, device, compiler } = harness();
    device.limits = {
      maxComputeWorkgroupsPerDimension: 65_535,
      maxComputeInvocationsPerWorkgroup: 1024,
      maxComputeWorkgroupSizeX: 1024,
      maxComputeWorkgroupSizeY: 1024,
      maxComputeWorkgroupSizeZ: 64,
    };

    const result = await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig(),
      "/shader.slang",
      {
        ComputeSim: `
          [shader("compute")]
          [numthreads(32, 32, 1)]
          void largeKernel(uint3 id : SV_DispatchThreadID) {}
        `,
      },
    );

    expect(result?.success).toBe(true);
    expect(compiler.compile).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      workgroupSize: [32, 32, 1],
      entryPoint: "largeKernel",
    }));
  });

  it("passes sampled layered output through compiler options and GPU texture layout", async () => {
    const { engine, device, compiler, textures } = harness();

    const result = await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({ sampled: true, outputLayers: 3 }),
      "/shader.slang",
      { ComputeSim: NATIVE_COMPUTE_SOURCE },
    );

    expect(result?.success).toBe(true);
    expect(compiler.compile).toHaveBeenCalledWith(NATIVE_COMPUTE_SOURCE, expect.objectContaining({
      passKind: "compute",
      workgroupSize: [8, 8, 1],
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

  it("encodes texel compute work before rendering in one command submission", async () => {
    const testHarness = harness();
    const { engine, device, commandEvents } = testHarness;
    const result = await engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({ sampled: true, resolution: { width: 100, height: 50 } }),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    expect(result?.success).toBe(true);
    enableRendering(testHarness);

    engine.render(1000);

    expect(commandEvents.filter(({ type }) =>
      type === "beginComputePass" || type === "dispatchWorkgroups" ||
      type === "beginRenderPass" || type === "draw")).toEqual([
      { type: "beginComputePass" },
      { type: "dispatchWorkgroups", value: [13, 7, 1] },
      { type: "beginRenderPass" },
      { type: "draw" },
    ]);
    expect(device.createCommandEncoder).toHaveBeenCalledTimes(1);
    expect(device.queue.submit).toHaveBeenCalledTimes(1);
    expect(device.queue.submit).toHaveBeenCalledWith([{ label: "frame-command-buffer" }]);
  });

  it.each([
    {
      label: "rounds a one-dimensional count up by the shader workgroup size",
      dispatch: { count: 100 } as ComputeDispatch,
      expected: [13, 1, 1],
    },
    {
      label: "uses explicit workgroup dimensions literally",
      dispatch: { x: 2, y: 3, z: 4 } as ComputeDispatch,
      expected: [2, 3, 4],
    },
  ])("$label", async ({ dispatch, expected }) => {
    const testHarness = harness();
    const result = await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({ dispatch }),
      "/shader.slang",
      { ComputeSim: NATIVE_COMPUTE_SOURCE },
    );
    expect(result?.success).toBe(true);
    enableRendering(testHarness);

    testHarness.engine.render(1000);

    expect(testHarness.commandEvents.filter(({ type }) => type === "dispatchWorkgroups"))
      .toEqual([{ type: "dispatchWorkgroups", value: expected }]);
  });

  it("covers an installed storage buffer using its element count", async () => {
    const testHarness = harness();
    const result = await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({
        dispatch: { cover: "particles" },
        storage: { particles: { count: 100, stride: 4, elementType: "float" } },
      }),
      "/shader.slang",
      { ComputeSim: NATIVE_COMPUTE_SOURCE },
    );
    expect(result?.success).toBe(true);
    enableRendering(testHarness);

    testHarness.engine.render(1000);

    expect(testHarness.commandEvents.filter(({ type }) => type === "dispatchWorkgroups"))
      .toEqual([{ type: "dispatchWorkgroups", value: [13, 1, 1] }]);
  });

  it.each([
    {
      label: "texel x",
      options: { resolution: { width: 41, height: 8 } },
      axis: "x",
      expectedCount: 6,
    },
    {
      label: "count x",
      options: { dispatch: { count: 321 } },
      axis: "x",
      expectedCount: 41,
    },
    {
      label: "storage x",
      options: {
        dispatch: { cover: "particles" },
        storage: { particles: { count: 41, stride: 4, elementType: "float" } },
      },
      axis: "x",
      expectedCount: 6,
    },
    {
      label: "literal y",
      options: { dispatch: { x: 5, y: 6, z: 5 } },
      axis: "y",
      expectedCount: 6,
    },
    {
      label: "literal z",
      options: { dispatch: { x: 5, y: 5, z: 6 } },
      axis: "z",
      expectedCount: 6,
    },
  ] as const)("rejects static $label dispatch above the device axis limit", async ({ options, axis, expectedCount }) => {
    const testHarness = harness();
    testHarness.device.limits.maxComputeWorkgroupsPerDimension = 5;

    const result = await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig(options),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );

    expect(result).toMatchObject({
      success: false,
      errors: [`ComputeSim: dispatch ${axis} count ${expectedCount} exceeds device limit 5`],
    });
    expect(testHarness.device.createComputePipeline).not.toHaveBeenCalled();
  });

  it("accepts static dispatch counts equal to the device axis limit", async () => {
    const testHarness = harness();
    testHarness.device.limits.maxComputeWorkgroupsPerDimension = 5;

    const result = await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({ dispatch: { x: 5, y: 5, z: 5 } }),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );

    expect(result?.success).toBe(true);
  });

  it("uses the WebGPU 65535 dispatch-axis fallback when the device omits its limit", async () => {
    const testHarness = harness();
    delete (testHarness.device.limits as { maxComputeWorkgroupsPerDimension?: number })
      .maxComputeWorkgroupsPerDimension;

    const result = await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({ dispatch: { x: 65_536, y: 1, z: 1 } }),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );

    expect(result).toMatchObject({
      success: false,
      errors: ["ComputeSim: dispatch x count 65536 exceeds device limit 65535"],
    });
  });

  it("skips a dynamic cover-channel dispatch over the device limit without consuming once", async () => {
    const testHarness = harness();
    testHarness.device.limits.maxComputeWorkgroupsPerDimension = 4;
    const path = "/dynamic.png";
    await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({
        sampled: true,
        dispatchOnce: true,
        dispatch: { cover: "iChannel0" },
        inputs: { iChannel0: { type: "texture", path } },
      }),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    const handle = {
      view: { label: "dynamic-view" },
      sampler: { label: "dynamic-sampler" },
      width: 33,
      height: 16,
    };
    const resourceManager = {
      getImageTextureCache: vi.fn(() => ({ [path]: handle })),
      getDefaultTexture: vi.fn(() => null),
    };
    (testHarness.engine as unknown as { resourceManager: typeof resourceManager })
      .resourceManager = resourceManager;
    const compute = (testHarness.engine as unknown as {
      computePipelines: Map<string, SlangComputePipeline>;
    }).computePipelines.get("ComputeSim")!;
    const swap = vi.spyOn(compute, "swap");
    enableRendering(testHarness);

    testHarness.engine.render(1000);
    expect(testHarness.commandEvents.some(({ type }) => type === "beginComputePass")).toBe(false);
    expect(swap).not.toHaveBeenCalled();

    handle.width = 32;
    testHarness.engine.render(1016);
    testHarness.engine.render(1032);
    expect(testHarness.commandEvents.filter(({ type }) => type === "dispatchWorkgroups"))
      .toEqual([{ type: "dispatchWorkgroups", value: [4, 2, 1] }]);
    expect(swap).toHaveBeenCalledTimes(1);
  });

  it.each(["texture", "video"] as const)(
    "re-resolves cover-channel %s dimensions from the live texture handle every frame",
    async (kind) => {
      const testHarness = harness();
      const path = kind === "texture" ? "/source.png" : "/source.mp4";
      const result = await testHarness.engine.compileShaderPipeline(
        IMAGE_SOURCE,
        computeConfig({
          dispatch: { cover: "iChannel0" },
          inputs: { iChannel0: { type: kind, path } },
        }),
        "/shader.slang",
        { ComputeSim: COMPUTE_SOURCE },
      );
      expect(result?.success).toBe(true);
      const handle = {
        view: { label: `${kind}-view` },
        sampler: { label: `${kind}-sampler` },
        width: 77,
        height: 45,
      };
      const resourceManager = {
        getImageTextureCache: vi.fn(() => kind === "texture" ? { [path]: handle } : {}),
        getVideoTexture: vi.fn(() => kind === "video" ? handle : null),
        getDefaultTexture: vi.fn(() => null),
      };
      (testHarness.engine as unknown as { resourceManager: typeof resourceManager })
        .resourceManager = resourceManager;
      enableRendering(testHarness);

      testHarness.engine.render(1000);
      handle.width = 129;
      handle.height = 65;
      testHarness.engine.render(1016);
      handle.width = -9;
      testHarness.engine.render(1032);

      expect(testHarness.commandEvents.filter(({ type }) => type === "dispatchWorkgroups"))
        .toEqual([
          { type: "dispatchWorkgroups", value: [10, 6, 1] },
          { type: "dispatchWorkgroups", value: [17, 9, 1] },
        ]);
    },
  );

  it("tracks real video resizes through the manager and backend for cover dispatch and binding", async () => {
    const testHarness = harness();
    const path = "/live-source.mp4";
    const result = await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({
        dispatch: { cover: "iChannel0" },
        inputs: { iChannel0: { type: "video", path } },
      }),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    expect(result?.success).toBe(true);

    const listeners = new Map<string, EventListener>();
    const video = {
      videoWidth: 77,
      videoHeight: 45,
      readyState: 4,
      HAVE_CURRENT_DATA: 2,
      loop: false,
      playsInline: false,
      preload: "",
      autoplay: false,
      muted: false,
      volume: 1,
      src: "",
      error: null,
      style: {} as CSSStyleDeclaration,
      parentNode: null,
      pause: vi.fn(),
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        listeners.set(type, listener);
      }),
      removeEventListener: vi.fn(),
      setAttribute: vi.fn(),
    } as unknown as HTMLVideoElement & { videoWidth: number; videoHeight: number };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage: vi.fn() })),
    } as unknown as HTMLCanvasElement;
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation(
      (tagName: string) => {
        if (tagName === "video") {
          return video;
        }
        if (tagName === "canvas") {
          return canvas;
        }
        return originalCreateElement(tagName);
      },
    );
    const appendChildSpy = vi.spyOn(document.body, "appendChild").mockImplementation(
      (node) => node,
    );
    let updateFrame: FrameRequestCallback | undefined;
    const requestFrameSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation(
      (callback) => {
        updateFrame = callback;
        return 7;
      },
    );
    const cancelFrameSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const manager = new VideoTextureManager(
      new WebGPUTextureBackend(testHarness.device as unknown as GPUDevice),
    );

    try {
      const load = manager.loadVideoTexture(path);
      listeners.get("canplay")?.(new Event("canplay"));
      const liveHandle = await load;
      const originalTexture = liveHandle.texture as unknown as {
        destroy: ReturnType<typeof vi.fn>;
      };
      const originalView = liveHandle.view;
      const resourceManager = {
        getVideoTexture: vi.fn(() => manager.getVideoTexture(path) ?? null),
        getDefaultTexture: vi.fn(() => null),
      };
      (testHarness.engine as unknown as { resourceManager: typeof resourceManager })
        .resourceManager = resourceManager;
      enableRendering(testHarness);

      testHarness.engine.render(1000);
      video.videoWidth = 129;
      video.videoHeight = 65;
      updateFrame?.(16);
      testHarness.engine.render(1016);

      const resizedHandle = manager.getVideoTexture(path)!;
      expect(resizedHandle).toBe(liveHandle);
      expect(resizedHandle).toMatchObject({ width: 129, height: 65 });
      expect(resizedHandle.texture).not.toBe(originalTexture);
      expect(resizedHandle.view).not.toBe(originalView);
      expect(originalTexture.destroy).toHaveBeenCalledTimes(1);
      expect(testHarness.commandEvents.filter(({ type }) => type === "dispatchWorkgroups"))
        .toEqual([
          { type: "dispatchWorkgroups", value: [10, 6, 1] },
          { type: "dispatchWorkgroups", value: [17, 9, 1] },
        ]);
      const latestComputeBindGroup = testHarness.commandEvents
        .filter(({ type }) => type === "compute.setBindGroup")
        .at(-1)?.value as { descriptor: GPUBindGroupDescriptor };
      expect(latestComputeBindGroup.descriptor.entries)
        .toContainEqual({ binding: 1, resource: resizedHandle.view });

      const resizedTexture = resizedHandle.texture as unknown as {
        destroy: ReturnType<typeof vi.fn>;
      };
      let detachedCandidate: FakeTexture | undefined;
      testHarness.device.createTexture.mockImplementationOnce((descriptor) => {
        manager.cleanup();
        const textureId = testHarness.textures.length;
        detachedCandidate = {
          descriptor,
          createView: vi.fn((viewDescriptor?: GPUTextureViewDescriptor) => ({
            textureId,
            descriptor: viewDescriptor,
          })),
          destroy: vi.fn(),
        };
        testHarness.textures.push(detachedCandidate);
        return detachedCandidate;
      });
      video.videoWidth = 200;
      video.videoHeight = 100;
      updateFrame?.(32);

      expect(manager.getVideoTexture(path)).toBeUndefined();
      expect(resizedTexture.destroy).toHaveBeenCalled();
      expect(detachedCandidate?.destroy).toHaveBeenCalledTimes(1);
      expect(requestFrameSpy).toHaveBeenCalledTimes(2);
    } finally {
      manager.cleanup();
      createElementSpy.mockRestore();
      appendChildSpy.mockRestore();
      requestFrameSpy.mockRestore();
      cancelFrameSpy.mockRestore();
    }
  });

  it("samples the current compute layer in Image and swaps it to previous only after submit", async () => {
    const testHarness = harness();
    const result = await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({
        sampled: true,
        outputLayers: 2,
        inputs: {
          iChannel0: { type: "buffer", source: "ComputeSim", layer: 1 },
        },
      }),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    expect(result?.success).toBe(true);
    const computePipeline = (testHarness.engine as unknown as {
      computePipelines: Map<string, SlangComputePipeline>;
    }).computePipelines.get("ComputeSim")!;
    const swap = vi.spyOn(computePipeline, "swap");
    enableRendering(testHarness);
    testHarness.device.createBindGroup.mockClear();

    testHarness.engine.render(1000);
    const firstComputeEntries = testHarness.device.createBindGroup.mock.calls[0][0].entries;
    const firstImageEntries = testHarness.device.createBindGroup.mock.calls[1][0].entries;

    expect(firstComputeEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        binding: 1,
        resource: {
          textureId: 1,
          descriptor: { dimension: "2d", baseArrayLayer: 1, arrayLayerCount: 1 },
        },
      }),
      expect.objectContaining({
        binding: 3,
        resource: {
          textureId: 0,
          descriptor: { dimension: "2d-array", baseArrayLayer: 0, arrayLayerCount: 2 },
        },
      }),
    ]));
    expect(firstImageEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        binding: 1,
        resource: {
          textureId: 0,
          descriptor: { dimension: "2d", baseArrayLayer: 0, arrayLayerCount: 1 },
        },
      }),
    ]));
    expect(swap).toHaveBeenCalledTimes(1);
    expect(testHarness.device.queue.submit.mock.invocationCallOrder[0])
      .toBeLessThan(swap.mock.invocationCallOrder[0]);

    testHarness.engine.render(1016);
    const secondComputeEntries = testHarness.device.createBindGroup.mock.calls[2][0].entries;
    const secondImageEntries = testHarness.device.createBindGroup.mock.calls[3][0].entries;
    expect(secondComputeEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({ binding: 1, resource: expect.objectContaining({ textureId: 0 }) }),
      expect.objectContaining({ binding: 3, resource: expect.objectContaining({ textureId: 1 }) }),
    ]));
    expect(secondImageEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({ binding: 1, resource: expect.objectContaining({ textureId: 1 }) }),
    ]));
  });

  it("runs dispatchOnce only after resetTime re-arms it", async () => {
    const testHarness = harness();
    const result = await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({ dispatchOnce: true }),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    expect(result?.success).toBe(true);
    enableRendering(testHarness);

    testHarness.engine.render(1000);
    testHarness.engine.render(1016);
    expect(testHarness.commandEvents.filter(({ type }) => type === "dispatchWorkgroups"))
      .toHaveLength(1);

    testHarness.engine.resetTime();
    testHarness.engine.render(2000);
    expect(testHarness.commandEvents.filter(({ type }) => type === "dispatchWorkgroups"))
      .toHaveLength(2);
  });

  it("uses one compute scope and a distinct bind group for every subdispatch", async () => {
    const testHarness = harness();
    const result = await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({ dispatchCount: 3 }),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    expect(result?.success).toBe(true);
    enableRendering(testHarness);

    testHarness.engine.render(1000);

    const computeEvents = testHarness.commandEvents.filter(({ type }) =>
      type === "beginComputePass" || type === "compute.setBindGroup" ||
      type === "dispatchWorkgroups" || type === "endComputePass");
    expect(computeEvents.map(({ type }) => type)).toEqual([
      "beginComputePass",
      "compute.setBindGroup", "dispatchWorkgroups",
      "compute.setBindGroup", "dispatchWorkgroups",
      "compute.setBindGroup", "dispatchWorkgroups",
      "endComputePass",
    ]);
    const bindGroups = computeEvents
      .filter(({ type }) => type === "compute.setBindGroup")
      .map(({ value }) => value);
    expect(new Set(bindGroups)).toHaveLength(3);
    const dispatchResources = bindGroups.map((bindGroup) => {
      const descriptor = (bindGroup as { descriptor: GPUBindGroupDescriptor }).descriptor;
      return descriptor.entries.at(-1)?.resource;
    });
    expect(new Set(dispatchResources)).toHaveLength(3);
  });

  it("re-arms dispatchOnce only when a compile successfully publishes", async () => {
    const testHarness = harness();
    const config = computeConfig({ dispatchOnce: true });
    await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      config,
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    enableRendering(testHarness);
    testHarness.engine.render(1000);

    // A failed recompile of the SAME shader must not consume dispatchOnce
    testHarness.compiler.compile.mockImplementationOnce(async () => ({
      success: false,
      errors: ["expected failure"],
    }));
    const failed = await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      config,
      "/shader.slang",
      { ComputeSim: `${COMPUTE_SOURCE} // broken` },
    );
    expect(failed?.success).toBe(false);
    testHarness.engine.render(1016);
    expect(testHarness.commandEvents.filter(({ type }) => type === "dispatchWorkgroups"))
      .toHaveLength(1);

    // A successful recompile of the SAME shader must also preserve dispatchOnce
    // (debug recompiles, buffer edits, etc. must not reset compute state)
    const sameShader = await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      config,
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    expect(sameShader?.success).toBe(true);
    testHarness.engine.render(1032);
    expect(testHarness.commandEvents.filter(({ type }) => type === "dispatchWorkgroups"))
      .toHaveLength(1);

    // A DIFFERENT shader must clear dispatchOnce so its init pass fires
    const newShader = await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      config,
      "/other.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    expect(newShader?.success).toBe(true);
    testHarness.engine.render(1048);
    expect(testHarness.commandEvents.filter(({ type }) => type === "dispatchWorkgroups"))
      .toHaveLength(2);
  });

  it("preserves storage buffers across same-shader recompile but reallocates on session change", async () => {
    const testHarness = harness();
    const config = computeConfig({ dispatchOnce: true });
    // First compile
    await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE, config, "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    const firstStorage = [...storageBuffers(testHarness.buffers)];

    // Same-shader recompile must reuse storage buffers (dispatchOnce preserved)
    await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE, config, "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    const sameShaderStorage = storageBuffers(testHarness.buffers);
    expect(sameShaderStorage).toHaveLength(firstStorage.length);
    for (let i = 0; i < firstStorage.length; i++) {
      expect(sameShaderStorage[i]).toBe(firstStorage[i]);
    }

    // Different-shader compile must reallocate storage (session changed)
    await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE, config, "/other.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    const newShaderStorage = storageBuffers(testHarness.buffers);
    expect(newShaderStorage).toHaveLength(firstStorage.length);
    for (let i = 0; i < firstStorage.length; i++) {
      expect(newShaderStorage[i]).not.toBe(firstStorage[i]);
    }
  });

  it("does not re-arm dispatchOnce when a pending compile is superseded", async () => {
    const testHarness = harness();
    const config = computeConfig({ dispatchOnce: true });
    await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      config,
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    enableRendering(testHarness);
    testHarness.engine.render(1000);
    const blocked = deferred<CompileResult>();
    testHarness.compiler.compile.mockImplementationOnce(() => blocked.promise);

    const pending = testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      config,
      "/shader.slang",
      { ComputeSim: `${COMPUTE_SOURCE} // pending` },
    );
    await vi.waitFor(() => expect(testHarness.compiler.compile).toHaveBeenCalledWith(
      `${COMPUTE_SOURCE} // pending`,
      expect.objectContaining({ passName: "ComputeSim" }),
    ));
    const supersedingFailure = await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      { version: "1" } as ShaderConfig,
      "/shader.slang",
    );
    expect(supersedingFailure?.success).toBe(false);
    blocked.resolve({ success: true, wgsl: "// stale compute" });
    await expect(pending).resolves.toMatchObject({ success: false, superseded: true });

    testHarness.engine.render(1016);
    expect(testHarness.commandEvents.filter(({ type }) => type === "dispatchWorkgroups"))
      .toHaveLength(1);
  });

  it("does not consume dispatchOnce when a required channel is unavailable", async () => {
    const testHarness = harness();
    const path = "/late.png";
    const result = await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({
        dispatchOnce: true,
        dispatch: { cover: "iChannel0" },
        inputs: { iChannel0: { type: "texture", path } },
      }),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    expect(result?.success).toBe(true);
    const handle = {
      view: { label: "late-view" },
      sampler: { label: "late-sampler" },
      width: 32,
      height: 16,
    };
    const resourceManager = {
      getImageTextureCache: vi.fn(() => ({} as Record<string, typeof handle>)),
      getDefaultTexture: vi.fn(() => null),
    };
    (testHarness.engine as unknown as { resourceManager: typeof resourceManager })
      .resourceManager = resourceManager;
    enableRendering(testHarness);

    testHarness.engine.render(1000);
    expect(testHarness.commandEvents.some(({ type }) => type === "beginComputePass")).toBe(false);
    expect(testHarness.commandEvents.some(({ type }) => type === "beginRenderPass")).toBe(true);

    resourceManager.getImageTextureCache.mockReturnValue({ [path]: handle });
    testHarness.engine.render(1016);
    testHarness.engine.render(1032);
    expect(testHarness.commandEvents.filter(({ type }) => type === "dispatchWorkgroups"))
      .toHaveLength(1);
  });

  it("runs compute on frame zero but skips it and its swap after pausing", async () => {
    const testHarness = harness();
    await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({ sampled: true }),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    const computePipeline = (testHarness.engine as unknown as {
      computePipelines: Map<string, SlangComputePipeline>;
    }).computePipelines.get("ComputeSim")!;
    const swap = vi.spyOn(computePipeline, "swap");
    enableRendering(testHarness);

    testHarness.engine.render(1000);
    testHarness.engine.togglePause();
    testHarness.engine.render(1016);

    expect(testHarness.commandEvents.filter(({ type }) => type === "dispatchWorkgroups"))
      .toHaveLength(1);
    expect(swap).toHaveBeenCalledTimes(1);
    expect(testHarness.commandEvents.filter(({ type }) => type === "beginRenderPass"))
      .toHaveLength(2);
  });

  it("runs compute once when the engine is initially paused at frame zero", async () => {
    const testHarness = harness();
    await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig(),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    enableRendering(testHarness);
    testHarness.engine.togglePause();

    testHarness.engine.render(1000);
    testHarness.engine.render(1016);

    expect(testHarness.commandEvents.filter(({ type }) => type === "dispatchWorkgroups"))
      .toHaveLength(1);
    expect(testHarness.commandEvents.filter(({ type }) => type === "beginRenderPass"))
      .toHaveLength(2);
  });

  it("retries the initial paused frame after submit fails, then skips compute", async () => {
    const testHarness = harness();
    await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig(),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    enableRendering(testHarness);
    testHarness.engine.togglePause();
    const submitFailure = new Error("initial paused submit failed");
    testHarness.setSubmitFailure(submitFailure);

    expect(() => testHarness.engine.render(1000)).toThrow(submitFailure);
    expect(() => testHarness.engine.render(1016)).not.toThrow();
    testHarness.engine.render(1032);

    expect(testHarness.commandEvents.filter(({ type }) => type === "dispatchWorkgroups"))
      .toHaveLength(2);
    expect(testHarness.device.queue.submit).toHaveBeenCalledTimes(3);
  });

  it("re-arms the initial paused frame after resetTime", async () => {
    const testHarness = harness();
    await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig(),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    enableRendering(testHarness);
    testHarness.engine.togglePause();

    testHarness.engine.render(1000);
    testHarness.engine.render(1016);
    testHarness.engine.resetTime();
    testHarness.engine.render(2000);
    testHarness.engine.render(2016);

    expect(testHarness.commandEvents.filter(({ type }) => type === "dispatchWorkgroups"))
      .toHaveLength(2);
  });

  it("re-arms paused compute on successful publication but not failed compilation", async () => {
    const testHarness = harness();
    const config = computeConfig();
    await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      config,
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    enableRendering(testHarness);
    testHarness.engine.togglePause();
    testHarness.engine.render(1000);

    testHarness.compiler.compile.mockImplementationOnce(async () => ({
      success: false,
      errors: ["expected failure"],
    }));
    const failed = await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      config,
      "/shader.slang",
      { ComputeSim: `${COMPUTE_SOURCE} // broken` },
    );
    expect(failed?.success).toBe(false);
    testHarness.engine.render(1016);

    const successful = await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      config,
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    expect(successful?.success).toBe(true);
    testHarness.engine.render(1032);
    testHarness.engine.render(1048);

    expect(testHarness.commandEvents.filter(({ type }) => type === "dispatchWorkgroups"))
      .toHaveLength(2);
  });

  it.each([
    ["render", {
      version: "1",
      passes: {
        ComputeSim: { type: 'compute',
          path: "compute.slang",
          inputs: { iChannel0: { type: "buffer", source: "BufferA" } },
          dispatch: { cover: "iChannel0" },
        },
        BufferA: { path: "buffer.slang", resolution: { width: 65, height: 33 } },
        Image: { inputs: {} },
      },
    } satisfies ShaderConfig, { ComputeSim: COMPUTE_SOURCE, BufferA: "buffer source" }],
    ["compute", {
      version: "1",
      passes: {
        ComputeProducer: { type: 'compute', path: "producer.slang", resolution: { width: 65, height: 33 } },
        ComputeSim: { type: 'compute',
          path: "compute.slang",
          inputs: { iChannel0: { type: "buffer", source: "ComputeProducer" } },
          dispatch: { cover: "iChannel0" },
        },
        Image: { inputs: {} },
      },
    } satisfies ShaderConfig, {
      ComputeProducer: computeSource("producer"),
      ComputeSim: COMPUTE_SOURCE,
    }],
  ] as const)("covers the actual dimensions of a %s buffer source", async (
    _sourceKind,
    config,
    shaderBuffers,
  ) => {
    const testHarness = harness();
    const result = await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      config,
      "/shader.slang",
      shaderBuffers,
    );
    expect(result?.success).toBe(true);
    enableRendering(testHarness);

    testHarness.engine.render(1000);

    const dispatches = testHarness.commandEvents
      .filter(({ type }) => type === "dispatchWorkgroups")
      .map(({ value }) => value);
    expect(dispatches.at(-1)).toEqual([9, 5, 1]);
  });

  it("uploads compute uniforms at the pass resolution", async () => {
    const testHarness = harness();
    await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({ resolution: { width: 123, height: 47 } }),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    enableRendering(testHarness);

    testHarness.engine.render(1000);

    const payload = testHarness.device.queue.writeBuffer.mock.calls[0][2] as ArrayBuffer;
    expect(Array.from(new Float32Array(payload, 0, 2))).toEqual([123, 47]);
  });

  it("resizes compute output and uses the new texel dispatch without recompiling", async () => {
    const testHarness = harness();
    const config = computeConfig({ sampled: true, resolution: { scale: 0.5 } });
    await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      config,
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    const originalTextures = [...testHarness.textures];
    const compileCount = testHarness.compiler.compile.mock.calls.length;
    enableRendering(testHarness);

    testHarness.engine.render(1000);
    testHarness.engine.handleCanvasResize(640, 360);
    testHarness.engine.render(1016);

    expect(testHarness.commandEvents.filter(({ type }) => type === "dispatchWorkgroups"))
      .toEqual([
        { type: "dispatchWorkgroups", value: [20, 12, 1] },
        { type: "dispatchWorkgroups", value: [40, 23, 1] },
      ]);
    expect(originalTextures.every(({ destroy }) => destroy.mock.calls.length === 1)).toBe(true);
    expect(testHarness.compiler.compile).toHaveBeenCalledTimes(compileCount);
  });

  it("re-arms sampled dispatchOnce after resize replaces its output textures", async () => {
    const testHarness = harness();
    await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({ sampled: true, dispatchOnce: true, resolution: { scale: 0.5 } }),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    const compute = (testHarness.engine as unknown as {
      computePipelines: Map<string, SlangComputePipeline>;
    }).computePipelines.get("ComputeSim")!;
    const rebuildBindGroups = vi.spyOn(compute, "rebuildBindGroups");
    const swap = vi.spyOn(compute, "swap");
    enableRendering(testHarness);
    testHarness.device.createBindGroup.mockClear();

    testHarness.engine.render(1000);
    testHarness.engine.handleCanvasResize(640, 360);
    testHarness.engine.render(1016);

    expect(rebuildBindGroups).toHaveBeenCalledTimes(2);
    expect(swap).toHaveBeenCalledTimes(2);
    expect(testHarness.commandEvents.filter(({ type }) => type === "dispatchWorkgroups"))
      .toEqual([
        { type: "dispatchWorkgroups", value: [20, 12, 1] },
        { type: "dispatchWorkgroups", value: [40, 23, 1] },
      ]);
    const resizedImageEntries = testHarness.device.createBindGroup.mock.calls[3][0].entries;
    expect(resizedImageEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        binding: 1,
        resource: expect.objectContaining({ textureId: 2 }),
      }),
    ]));
  });

  it("re-arms an output-free texel dispatchOnce when its work dimensions resize", async () => {
    const testHarness = harness();
    await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({
        dispatchOnce: true,
        resolution: { scale: 0.5 },
        storage: { particles: { count: 16, stride: 4, elementType: "float" } },
      }),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    enableRendering(testHarness);

    testHarness.engine.render(1000);
    testHarness.engine.handleCanvasResize(640, 360);
    testHarness.engine.render(1016);

    expect(testHarness.commandEvents.filter(({ type }) => type === "dispatchWorkgroups"))
      .toEqual([
        { type: "dispatchWorkgroups", value: [20, 12, 1] },
        { type: "dispatchWorkgroups", value: [40, 23, 1] },
      ]);
  });

  it.each([
    { label: "count", dispatch: { count: 10 } as ComputeDispatch },
    { label: "literal", dispatch: { x: 2, y: 3, z: 1 } as ComputeDispatch },
  ])("re-arms a sampled $label dispatchOnce when resize replaces its output", async ({ dispatch }) => {
    const testHarness = harness();
    await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({
        sampled: true,
        dispatchOnce: true,
        dispatch,
        resolution: { scale: 0.5 },
      }),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    enableRendering(testHarness);

    testHarness.engine.render(1000);
    testHarness.engine.handleCanvasResize(640, 360);
    testHarness.engine.render(1016);

    expect(testHarness.commandEvents.filter(({ type }) => type === "dispatchWorkgroups"))
      .toHaveLength(2);
  });

  it("preserves dispatchOnce completion and output when resize allocation fails", async () => {
    const testHarness = harness();
    await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({ sampled: true, dispatchOnce: true, resolution: { scale: 0.5 } }),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    const compute = (testHarness.engine as unknown as {
      computePipelines: Map<string, SlangComputePipeline>;
    }).computePipelines.get("ComputeSim")!;
    const rebuildBindGroups = vi.spyOn(compute, "rebuildBindGroups");
    const swap = vi.spyOn(compute, "swap");
    const originalTextures = [...testHarness.textures];
    enableRendering(testHarness);
    testHarness.engine.render(1000);
    testHarness.device.createTexture.mockImplementationOnce(() => {
      throw new Error("resize allocation failed");
    });

    expect(() => testHarness.engine.handleCanvasResize(640, 360))
      .toThrow("resize allocation failed");
    expect(compute.getOutputSize()).toEqual({ width: 160, height: 90 });
    expect(testHarness.engine.getPasses().find(({ name }) => name === "ComputeSim"))
      .toMatchObject({ width: 160, height: 90 });
    expect(originalTextures.every(({ destroy }) => destroy.mock.calls.length === 0)).toBe(true);

    testHarness.engine.render(1016);
    expect(rebuildBindGroups).toHaveBeenCalledTimes(1);
    expect(swap).toHaveBeenCalledTimes(1);
  });

  it("encodes multiple compute nodes in graph order before buffer and Image draws", async () => {
    const testHarness = harness();
    const config: ShaderConfig = {
      version: "1",
      passes: {
        ComputeFirst: { type: 'compute', path: "first.slang" },
        ComputeSecond: { type: 'compute', path: "second.slang" },
        BufferA: { path: "buffer.slang" },
        Image: { inputs: {} },
      },
    };
    await testHarness.engine.compileShaderPipeline(IMAGE_SOURCE, config, "/shader.slang", {
      ComputeFirst: computeSource("first"),
      ComputeSecond: computeSource("second"),
      BufferA: "buffer render",
    });
    enableRendering(testHarness);

    testHarness.engine.render(1000);

    expect(testHarness.commandEvents.filter(({ type }) =>
      type === "compute.setPipeline" || type === "beginRenderPass" || type === "draw"))
      .toEqual([
        { type: "compute.setPipeline", value: { label: "compute-pipeline-0" } },
        { type: "compute.setPipeline", value: { label: "compute-pipeline-1" } },
        { type: "beginRenderPass" },
        { type: "draw" },
        { type: "beginRenderPass" },
        { type: "draw" },
      ]);
  });

  it.each([
    ["pipeline", "getPipeline"],
    ["uniform buffer", "getUniformBuffer"],
    ["bind group", "getBindGroup"],
  ] as const)("skips compute safely when its %s is unavailable", async (_label, method) => {
    const testHarness = harness();
    await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({ sampled: true }),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    const computePipeline = (testHarness.engine as unknown as {
      computePipelines: Map<string, SlangComputePipeline>;
    }).computePipelines.get("ComputeSim")!;
    vi.spyOn(computePipeline, method).mockReturnValue(null);
    const swap = vi.spyOn(computePipeline, "swap");
    enableRendering(testHarness);

    testHarness.engine.render(1000);

    expect(testHarness.commandEvents.some(({ type }) => type === "beginComputePass")).toBe(false);
    expect(testHarness.commandEvents.filter(({ type }) => type === "beginRenderPass"))
      .toHaveLength(1);
    expect(testHarness.device.queue.submit).toHaveBeenCalledTimes(1);
    expect(swap).not.toHaveBeenCalled();
  });

  it("uses the current view from an earlier compute source and previous view from a later source", async () => {
    const earlierHarness = harness();
    const earlierConfig: ShaderConfig = {
      version: "1",
      passes: {
        ComputeFirst: { type: 'compute', path: "first.slang", outputLayers: 2 },
        ComputeSecond: { type: 'compute',
          path: "second.slang",
          inputs: { iChannel0: { type: "buffer", source: "ComputeFirst", layer: 1 } },
          outputLayers: 2,
        },
        Image: { inputs: { iChannel0: { type: "buffer", source: "ComputeSecond", layer: 0 } } },
      },
    };
    await earlierHarness.engine.compileShaderPipeline(IMAGE_SOURCE, earlierConfig, "/earlier.slang", {
      ComputeFirst: computeSource("first"),
      ComputeSecond: computeSource("second"),
    });
    enableRendering(earlierHarness);
    earlierHarness.device.createBindGroup.mockClear();
    earlierHarness.engine.render(1000);
    const secondComputeEntries = earlierHarness.device.createBindGroup.mock.calls[1][0].entries;
    expect(secondComputeEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        binding: 1,
        resource: {
          textureId: 0,
          descriptor: { dimension: "2d", baseArrayLayer: 1, arrayLayerCount: 1 },
        },
      }),
    ]));

    const laterHarness = harness();
    const laterConfig: ShaderConfig = {
      version: "1",
      passes: {
        ComputeFirst: { type: 'compute',
          path: "first.slang",
          inputs: { iChannel0: { type: "buffer", source: "ComputeSecond", layer: 1 } },
        },
        ComputeSecond: { type: 'compute', path: "second.slang", outputLayers: 2 },
        Image: { inputs: { iChannel0: { type: "buffer", source: "ComputeFirst" } } },
      },
    };
    await laterHarness.engine.compileShaderPipeline(IMAGE_SOURCE, laterConfig, "/later.slang", {
      ComputeFirst: computeSource("first"),
      ComputeSecond: computeSource("second"),
    });
    enableRendering(laterHarness);
    laterHarness.device.createBindGroup.mockClear();
    laterHarness.engine.render(1000);
    const firstComputeEntries = laterHarness.device.createBindGroup.mock.calls[0][0].entries;
    expect(firstComputeEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        binding: 1,
        resource: {
          textureId: 3,
          descriptor: { dimension: "2d", baseArrayLayer: 1, arrayLayerCount: 1 },
        },
      }),
    ]));
  });

  it("does not swap dispatchOnce output again on later skipped frames", async () => {
    const testHarness = harness();
    await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({ sampled: true, dispatchOnce: true }),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    const computePipeline = (testHarness.engine as unknown as {
      computePipelines: Map<string, SlangComputePipeline>;
    }).computePipelines.get("ComputeSim")!;
    const swap = vi.spyOn(computePipeline, "swap");
    enableRendering(testHarness);

    testHarness.engine.render(1000);
    testHarness.engine.render(1016);
    testHarness.engine.render(1032);

    expect(swap).toHaveBeenCalledTimes(1);
  });

  it("keeps sampling the completed dispatchOnce output when the source skips a later frame", async () => {
    const testHarness = harness();
    await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({ sampled: true, dispatchOnce: true }),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    enableRendering(testHarness);
    testHarness.device.createBindGroup.mockClear();

    testHarness.engine.render(1000);
    testHarness.engine.render(1016);

    const imageBindGroups = testHarness.commandEvents
      .filter(({ type }) => type === "render.setBindGroup")
      .map(({ value }) => value as { descriptor: GPUBindGroupDescriptor });
    expect(imageBindGroups).toHaveLength(2);
    expect(imageBindGroups[1]).toBe(imageBindGroups[0]);
    expect(imageBindGroups[0].descriptor.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        binding: 1,
        resource: expect.objectContaining({ textureId: 0 }),
      }),
    ]));
  });

  it("gives a compute consumer the completed output when an earlier dispatchOnce source skips", async () => {
    const testHarness = harness();
    const config: ShaderConfig = {
      version: "1",
      passes: {
        ComputeSource: { type: 'compute', path: "source.slang", dispatchOnce: true },
        ComputeConsumer: { type: 'compute',
          path: "consumer.slang",
          inputs: { iChannel0: { type: "buffer", source: "ComputeSource" } },
        },
        Image: { inputs: { iChannel0: { type: "buffer", source: "ComputeConsumer" } } },
      },
    };
    await testHarness.engine.compileShaderPipeline(IMAGE_SOURCE, config, "/shader.slang", {
      ComputeSource: computeSource("source"),
      ComputeConsumer: computeSource("consumer"),
    });
    const consumer = (testHarness.engine as unknown as {
      computePipelines: Map<string, SlangComputePipeline>;
    }).computePipelines.get("ComputeConsumer")!;
    const rebuildBindGroups = vi.spyOn(consumer, "rebuildBindGroups");
    enableRendering(testHarness);

    testHarness.engine.render(1000);
    testHarness.engine.render(1016);

    expect(rebuildBindGroups.mock.calls[0][0][0].textureView)
      .toEqual(expect.objectContaining({ textureId: 0 }));
    expect(rebuildBindGroups.mock.calls[1][0][0].textureView)
      .toEqual(expect.objectContaining({ textureId: 0 }));
  });

  it.each([
    { method: "setPipeline", call: 1, dispatchCount: 1 },
    { method: "setBindGroup", call: 1, dispatchCount: 1 },
    { method: "setBindGroup", call: 2, dispatchCount: 2 },
    { method: "dispatchWorkgroups", call: 1, dispatchCount: 1 },
  ] as const)(
    "ends a begun compute scope when $method call $call throws",
    async ({ method, call, dispatchCount }) => {
      const testHarness = harness();
      await testHarness.engine.compileShaderPipeline(
        IMAGE_SOURCE,
        computeConfig({
          sampled: true,
          dispatchCount,
          dispatchOnce: dispatchCount === 1,
        }),
        "/shader.slang",
        { ComputeSim: COMPUTE_SOURCE },
      );
      const compute = (testHarness.engine as unknown as {
        computePipelines: Map<string, SlangComputePipeline>;
      }).computePipelines.get("ComputeSim")!;
      const swap = vi.spyOn(compute, "swap");
      enableRendering(testHarness);
      testHarness.computeFailure.method = method;
      testHarness.computeFailure.call = call;

      expect(() => testHarness.engine.render(1000)).toThrow(testHarness.computeFailure.error);

      expect(testHarness.computePasses[0].end).toHaveBeenCalledTimes(1);
      expect(swap).not.toHaveBeenCalled();

      expect(() => testHarness.engine.render(1016)).not.toThrow();
      expect(testHarness.computePasses[1].end).toHaveBeenCalledTimes(1);
      expect(swap).toHaveBeenCalledTimes(1);
      if (dispatchCount === 1) {
        testHarness.engine.render(1032);
        expect(testHarness.computePasses).toHaveLength(2);
        expect(swap).toHaveBeenCalledTimes(1);
      }
    },
  );

  it("does not consume dispatchOnce or swap when ending its compute scope throws", async () => {
    const testHarness = harness();
    await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({ sampled: true, dispatchOnce: true }),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    const compute = (testHarness.engine as unknown as {
      computePipelines: Map<string, SlangComputePipeline>;
    }).computePipelines.get("ComputeSim")!;
    const swap = vi.spyOn(compute, "swap");
    enableRendering(testHarness);
    testHarness.computeFailure.method = "end";

    expect(() => testHarness.engine.render(1000)).toThrow(testHarness.computeFailure.error);
    expect(testHarness.computePasses[0].end).toHaveBeenCalledTimes(1);
    expect(swap).not.toHaveBeenCalled();

    expect(() => testHarness.engine.render(1016)).not.toThrow();
    expect(testHarness.computePasses[1].end).toHaveBeenCalledTimes(1);
    expect(swap).toHaveBeenCalledTimes(1);
  });

  it("preserves the encoder operation error when closing the failed scope also throws", async () => {
    const testHarness = harness();
    await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig(),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    enableRendering(testHarness);
    const operationError = new Error("setPipeline failed");
    testHarness.computeFailure.method = "setPipeline";
    testHarness.computeFailure.error = operationError;
    testHarness.computeFailure.endError = new Error("end failed too");

    expect(() => testHarness.engine.render(1000)).toThrow(operationError);
    expect(testHarness.computePasses[0].end).toHaveBeenCalledTimes(1);
  });

  it.each([
    "later-compute",
    "render-setPipeline",
    "render-draw",
    "finish",
    "submit",
  ] as const)(
    "commits dispatchOnce and swaps only after submit succeeds past a %s failure",
    async (failurePoint) => {
      const testHarness = harness();
      const config: ShaderConfig = {
        version: "1",
        passes: {
          ComputeOnce: { type: 'compute', path: "once.slang", dispatchOnce: true },
          ...(failurePoint === "later-compute"
            ? { ComputeLater: { type: 'compute', path: "later.slang" } }
            : {}),
          Image: { inputs: { iChannel0: { type: "buffer", source: "ComputeOnce" } } },
        },
      };
      await testHarness.engine.compileShaderPipeline(IMAGE_SOURCE, config, "/shader.slang", {
        ComputeOnce: computeSource("once"),
        ...(failurePoint === "later-compute" ? { ComputeLater: computeSource("later") } : {}),
      });
      const once = (testHarness.engine as unknown as {
        computePipelines: Map<string, SlangComputePipeline>;
      }).computePipelines.get("ComputeOnce")!;
      const rebuildBindGroups = vi.spyOn(once, "rebuildBindGroups");
      const swap = vi.spyOn(once, "swap");
      enableRendering(testHarness);
      const failure = new Error(`${failurePoint} failed`);
      if (failurePoint === "later-compute") {
        testHarness.computeFailure.method = "setPipeline";
        testHarness.computeFailure.pass = 2;
        testHarness.computeFailure.error = failure;
      } else if (failurePoint === "render-setPipeline") {
        testHarness.renderFailure.method = "setPipeline";
        testHarness.renderFailure.error = failure;
      } else if (failurePoint === "render-draw") {
        testHarness.renderFailure.method = "draw";
        testHarness.renderFailure.error = failure;
      } else if (failurePoint === "finish") {
        testHarness.setFinishFailure(failure);
      } else {
        testHarness.setSubmitFailure(failure);
      }

      expect(() => testHarness.engine.render(1000)).toThrow(failure);
      expect(rebuildBindGroups).toHaveBeenCalledTimes(1);
      expect(swap).not.toHaveBeenCalled();

      expect(() => testHarness.engine.render(1016)).not.toThrow();
      expect(rebuildBindGroups).toHaveBeenCalledTimes(2);
      expect(swap).toHaveBeenCalledTimes(1);

      testHarness.engine.render(1032);
      expect(rebuildBindGroups).toHaveBeenCalledTimes(2);
      expect(swap).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps sampling the completed compute output while a paused frame skips the source", async () => {
    const testHarness = harness();
    await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({ sampled: true }),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    enableRendering(testHarness);
    testHarness.device.createBindGroup.mockClear();

    testHarness.engine.render(1000);
    testHarness.engine.togglePause();
    testHarness.engine.render(1016);

    const imageBindGroups = testHarness.commandEvents
      .filter(({ type }) => type === "render.setBindGroup")
      .map(({ value }) => value as { descriptor: GPUBindGroupDescriptor });
    expect(imageBindGroups).toHaveLength(2);
    expect(imageBindGroups[1]).toBe(imageBindGroups[0]);
    expect(imageBindGroups[1].descriptor.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        binding: 1,
        resource: expect.objectContaining({ textureId: 0 }),
      }),
    ]));
  });

  it("keeps sampling the completed output when a source channel becomes unavailable", async () => {
    const testHarness = harness();
    const path = "/transient.png";
    await testHarness.engine.compileShaderPipeline(
      IMAGE_SOURCE,
      computeConfig({
        sampled: true,
        inputs: { iChannel0: { type: "texture", path } },
      }),
      "/shader.slang",
      { ComputeSim: COMPUTE_SOURCE },
    );
    const handle = {
      view: { label: "transient-view" },
      sampler: { label: "transient-sampler" },
      width: 32,
      height: 16,
    };
    const resourceManager = {
      getImageTextureCache: vi.fn(() => ({ [path]: handle })),
      getDefaultTexture: vi.fn(() => null),
    };
    (testHarness.engine as unknown as { resourceManager: typeof resourceManager })
      .resourceManager = resourceManager;
    enableRendering(testHarness);
    testHarness.device.createBindGroup.mockClear();

    testHarness.engine.render(1000);
    resourceManager.getImageTextureCache.mockReturnValue({});
    testHarness.engine.render(1016);

    const imageBindGroups = testHarness.commandEvents
      .filter(({ type }) => type === "render.setBindGroup")
      .map(({ value }) => value as { descriptor: GPUBindGroupDescriptor });
    expect(imageBindGroups).toHaveLength(2);
    expect(imageBindGroups[1]).toBe(imageBindGroups[0]);
    expect(imageBindGroups[1].descriptor.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        binding: 1,
        resource: expect.objectContaining({ textureId: 0 }),
      }),
    ]));
  });

  it.each([
    ["output layers without an output", computeConfig({ outputLayers: 2 }), 1, 2],
    ["dispatch count", computeConfig({ dispatchCount: 2 }), 1, 2],
    ["output state", computeConfig({ sampled: true }), 2, 2],
  ])("updates the compute pipeline only when %s changes its effective configuration", async (
    _label,
    changedConfig,
    expectedComputeCompiles,
    expectedPipelineBuilds,
  ) => {
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
    expect(device.createComputePipeline).toHaveBeenCalledTimes(expectedPipelineBuilds);
    expect(compiler.compile.mock.calls.filter(([, options]) =>
      options.passName === "ComputeSim")).toHaveLength(expectedComputeCompiles);
  });

  it.each<[string, Record<string, StorageBufferConfig>, number]>([
    ["name", { renamed: { count: 4, stride: 16, elementType: "float4" } }, 2],
    ["element type", { particles: { count: 4, stride: 16, elementType: "uint4" } }, 2],
    ["count", { particles: { count: 8, stride: 16, elementType: "float4" } }, 1],
  ])(
    "rebuilds the compute pipeline when storage %s changes while reusing layout-compatible WGSL",
    async (_label, storage, expectedComputeCompiles) => {
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
        options.passName === "ComputeSim")).toHaveLength(expectedComputeCompiles);
    },
  );

  it("reuses WGSL but rebuilds compute GPU resources when dimensions change", async () => {
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
    expect(device.createComputePipeline).toHaveBeenCalledTimes(2);
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
      ComputeSim: computeSource("B"),
    });
    await vi.waitFor(() => expect(compiler.compile).toHaveBeenCalledWith(
      computeSource("B"),
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

  it("keeps a published compute generation live when predecessor disposal throws", async () => {
    const { engine, buffers } = harness();
    const config = computeConfig({ sampled: true });
    await engine.compileShaderPipeline(IMAGE_SOURCE, config, "/shader.slang", {
      ComputeSim: COMPUTE_SOURCE,
    });
    const predecessor = (engine as unknown as {
      computePipelines: Map<string, SlangComputePipeline>;
    }).computePipelines.get("ComputeSim")!;
    const predecessorDispose = vi.spyOn(predecessor, "dispose").mockImplementation(() => {
      throw new Error("old compute disposal failed");
    });

    const result = await engine.compileShaderPipeline(IMAGE_SOURCE, config, "/shader.slang", {
      ComputeSim: computeSource("changed"),
    });
    const installed = (engine as unknown as {
      computePipelines: Map<string, SlangComputePipeline>;
    }).computePipelines.get("ComputeSim")!;

    expect(result?.success).toBe(true);
    expect(result?.warnings?.join("\n")).toMatch(/old compute disposal failed/i);
    expect(installed).not.toBe(predecessor);
    expect(installed.getPipeline()).not.toBeNull();
    expect(predecessorDispose).toHaveBeenCalledTimes(1);
    expect(dispatchBuffers(buffers).at(-1)?.destroy).not.toHaveBeenCalled();
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
      { ComputeSim: computeSource("compiler broken") },
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
      { ComputeSim: computeSource("wgsl broken") },
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
        ComputeFirst: { type: 'compute', path: "first.slang" },
        ComputeSecond: { type: 'compute', path: "second.slang" },
        Image: { inputs: {} },
      },
    };

    await engine.compileShaderPipeline(IMAGE_SOURCE, config, "/shader.slang", {
      ComputeFirst: computeSource("first 1"),
      ComputeSecond: computeSource("second 2"),
    });

    expect(compiler.compile.mock.calls.map(([source]) => source)).toEqual([
      computeSource("first 1"),
      computeSource("second 2"),
      IMAGE_SOURCE,
    ]);
    expect(device.createComputePipeline).toHaveBeenCalledTimes(2);

    compiler.compile.mockClear();
    await engine.compileShaderPipeline(IMAGE_SOURCE, config, "/shader.slang", {
      ComputeFirst: computeSource("first 1"),
      ComputeSecond: computeSource("second 3"),
    });

    expect(compiler.compile).toHaveBeenCalledTimes(1);
    expect(compiler.compile).toHaveBeenCalledWith(
      computeSource("second 3"),
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
      if (source === computeSource("B")) {
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
      { ComputeSim: computeSource("B") },
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
      { ComputeSim: computeSource("C") },
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
      { ComputeSim: computeSource("C") },
    );
    expect(storageBuffers(buffers)).toHaveLength(3);
    expect(winnerStorage.destroy).not.toHaveBeenCalled();
  });

  it("never disposes a reused predecessor from a stale generation after its replacement installs", async () => {
    const { engine, compiler } = harness();
    const config: ShaderConfig = {
      version: "1",
      passes: {
        ComputeStable: { type: 'compute', path: "stable.slang" },
        ComputeBlocked: { type: 'compute', path: "blocked.slang" },
        Image: { inputs: { iChannel0: { type: "buffer", source: "ComputeStable" } } },
      },
    };
    await engine.compileShaderPipeline(IMAGE_SOURCE, config, "/shader.slang", {
      ComputeStable: computeSource("stable baseline"),
      ComputeBlocked: computeSource("blocked baseline"),
    });
    const installed = (engine as unknown as {
      computePipelines: Map<string, SlangComputePipeline>;
    }).computePipelines;
    const predecessor = installed.get("ComputeStable")!;
    const predecessorDispose = vi.spyOn(predecessor, "dispose");
    const blockedA = deferred<CompileResult>();
    compiler.compile.mockImplementation((source: string, options: { passName?: string }) => {
      if (source === computeSource("blocked A")) {
        return blockedA.promise;
      }
      return Promise.resolve({ success: true, wgsl: `// ${options.passName ?? "pass"}` });
    });

    const pendingA = engine.compileShaderPipeline(IMAGE_SOURCE, config, "/shader.slang", {
      ComputeStable: computeSource("stable baseline"),
      ComputeBlocked: computeSource("blocked A"),
    });
    await vi.waitFor(() => expect(compiler.compile).toHaveBeenCalledWith(
      computeSource("blocked A"),
      expect.objectContaining({ passName: "ComputeBlocked" }),
    ));
    const resultB = await engine.compileShaderPipeline(IMAGE_SOURCE, config, "/shader.slang", {
      ComputeStable: computeSource("stable B"),
      ComputeBlocked: computeSource("blocked B"),
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
      { ComputeSim: computeSource("pending compute") },
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
      { ComputeSim: computeSource("pending diagnostics") },
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
      { ComputeSim: computeSource("pending diagnostics") },
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
      { ComputeSim: computeSource("pending diagnostics A") },
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
      { ComputeSim: computeSource("pending pipeline") },
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
