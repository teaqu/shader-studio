import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { ShaderConfig } from "@shader-studio/types";
import { WebGPURenderingEngine } from "../../webgpu/WebGPURenderingEngine";
import { SlangPassPipeline } from "../../webgpu/SlangPassPipeline";
import { sharedSlangWgslCache } from "../../webgpu/SlangWgslCache";
import { TimeManager } from "../../util/TimeManager";
import { ResourceManager } from "../../resources/ResourceManager";
import { WebGPUTextureBackend } from "../../webgpu/WebGPUTextureBackend";
import { UNIFORM_OFFSETS } from "../../webgpu/SlangPrelude";

const pixelRegionCapturerMock = vi.hoisted(() => ({ constructor: vi.fn() }));

vi.mock("../../webgpu/WebGPUPixelRegionCapturer", () => ({
  WebGPUPixelRegionCapturer: class {
    constructor(device: GPUDevice, format: GPUTextureFormat) {
      pixelRegionCapturerMock.constructor(device, format);
    }

    queue(): boolean {
      return true;
    }
    collectResults() {
      return [];
    }
    cancelPendingCaptures(): void {}
    encodeAfterRender(): boolean {
      return false;
    }
    beginMappings(): void {}
    dispose(): void {}
  },
}));

/** A canvas stub whose webgpu context is unavailable (as in jsdom / no-WebGPU). */
function noWebGpuCanvas(): HTMLCanvasElement {
  return {
    width: 800,
    height: 600,
    getContext: vi.fn(() => null),
    addEventListener: vi.fn(),
  } as unknown as HTMLCanvasElement;
}

const assets = { scriptUrl: "slang.js", wasmUrl: "slang.wasm" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

interface EngineLifecycleInternals {
  ready: Promise<void>;
  device: GPUDevice | null;
  compiler: unknown | null;
  resourceManager: unknown | null;
  compileGeneration: number;
  bufferTextureFormat: GPUTextureFormat;
}

function lifecycleInternals(engine: WebGPURenderingEngine): EngineLifecycleInternals {
  return engine as unknown as EngineLifecycleInternals;
}

function webGpuCanvas(context: Pick<GPUCanvasContext, "configure">): HTMLCanvasElement {
  return {
    width: 800,
    height: 600,
    getContext: vi.fn(() => context),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as HTMLCanvasElement;
}

function lifecycleDevice() {
  const textures: Array<{ createView: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }> = [];
  const device = {
    createTexture: vi.fn(() => {
      const texture = { createView: vi.fn(() => ({})), destroy: vi.fn() };
      textures.push(texture);
      return texture;
    }),
    createSampler: vi.fn(() => ({})),
    queue: { writeTexture: vi.fn() },
    destroy: vi.fn(),
    pushErrorScope: vi.fn(),
    popErrorScope: vi.fn(async () => null),
  };
  return { device: device as unknown as GPUDevice, textures };
}

describe("WebGPURenderingEngine", () => {
  beforeEach(() => {
    sharedSlangWgslCache.clear();
    pixelRegionCapturerMock.constructor.mockClear();
  });

  it("compiles a structured Slang debug plan through the normal image/module pipeline", async () => {
    const engine = new WebGPURenderingEngine(assets);
    const compile = vi.spyOn(engine, "compileShaderPipeline").mockResolvedValue({ success: true });

    await engine.compileSlangDebugPlan({
      workspaceHash: "hash", rootUri: "file:///main.slang", selectedSourceUri: "file:///main.slang", executionMarkerSlot: 0, captureSlots: [],
      files: [
        { uri: "file:///main.slang", path: "/main.slang", source: "float4 mainImage(float2 c) { return 1; }", version: 1, moduleName: "", ownerPass: "ComputeUpdate" },
        { uri: "file:///helper.slang", path: "/helper.slang", source: "module helper;", version: 1, moduleName: "helper", ownerPass: "ComputeUpdate" },
      ],
    });

    expect(compile).toHaveBeenCalledWith(expect.any(String), null, "/main.slang", {}, "", [], [{
      uri: "file:///helper.slang", path: "/helper.slang", source: "module helper;", version: 1, moduleName: "helper", ownerPass: "Image",
    }], "/main.slang", undefined);
  });

  it("uses the current config for a structured debug plan instead of the previous compile snapshot", async () => {
    const engine = new WebGPURenderingEngine(assets);
    const compile = vi.spyOn(engine, "compileShaderPipeline").mockResolvedValue({ success: true });
    const previousConfig: ShaderConfig = {
      version: "1.0",
      passes: { Image: { inputs: { iChannel0: { type: "texture", path: "before.png" } } } },
    };
    const currentConfig: ShaderConfig = {
      version: "1.0",
      passes: { Image: { inputs: { iChannel0: { type: "texture", path: "after.png" } } } },
    };
    (engine as unknown as { lastCompile: unknown }).lastCompile = {
      code: "float4 mainImage(float2 c) { return 0; }",
      config: previousConfig,
      path: "/main.slang",
      buffers: {},
      customUniformDeclarations: "",
      customUniformInfo: [],
      slangModules: [],
      slangSourcePath: "/main.slang",
    };

    await (engine.compileSlangDebugPlan as unknown as (
      plan: DebugInstrumentationPlan,
      config: ShaderConfig,
    ) => Promise<CompilationResult | undefined>)({
      workspaceHash: "hash", rootUri: "file:///main.slang", selectedSourceUri: "file:///main.slang", executionMarkerSlot: 0, captureSlots: [],
      files: [{ uri: "file:///main.slang", path: "/main.slang", source: "float4 mainImage(float2 c) { return 1; }", version: 1, moduleName: "", ownerPass: "Image" }],
    }, currentConfig);

    expect(compile).toHaveBeenCalledWith(expect.any(String), currentConfig, "/main.slang", {}, "", [], [], "/main.slang", undefined);
  });

  it("attributes structured Slang debug failures to the selected imported module", async () => {
    const engine = new WebGPURenderingEngine(assets);
    vi.spyOn(engine, "compileShaderPipeline").mockResolvedValue({ success: false, errors: ["unexpected token"] });

    const result = await engine.compileSlangDebugPlan({
      workspaceHash: "hash", rootUri: "file:///main.slang", selectedSourceUri: "file:///helper.slang", executionMarkerSlot: 0, captureSlots: [],
      files: [
        { uri: "file:///main.slang", path: "/main.slang", source: "import helper;", version: 1, moduleName: "", ownerPass: "Image" },
        { uri: "file:///helper.slang", path: "/helper.slang", source: "module helper;", version: 2, moduleName: "helper", ownerPass: "Image" },
      ],
    });

    expect(result).toEqual({ success: false, errors: ["/helper.slang: unexpected token"] });
  });

  it("compiles a selected common file as common code while retaining Image as the debug root", async () => {
    const engine = new WebGPURenderingEngine(assets);
    const compile = vi.spyOn(engine, "compileShaderPipeline").mockResolvedValue({ success: true });
    const previous = {
      code: "float4 mainImage(float2 coord) { return shared(coord.x); }",
      config: { version: "1.0", passes: { Image: {}, common: { path: "common.slang" } } },
      path: "/image.slang",
      buffers: { common: "float shared(float x) { return x; }" },
      slangModules: [],
      slangSourcePath: "/image.slang",
      slangSourcePaths: { Image: "/image.slang", common: "/common.slang" },
    };
    (engine as unknown as { lastCompile: typeof previous }).lastCompile = previous;

    await engine.compileSlangDebugPlan({
      workspaceHash: "hash", rootUri: "file:///image.slang", selectedSourceUri: "file:///common.slang", executionMarkerSlot: 0, captureSlots: [],
      files: [
        { uri: "file:///image.slang", path: "/image.slang", source: "instrumented image", version: 2, moduleName: "", ownerPass: "Image" },
        { uri: "file:///common.slang", path: "/common.slang", source: "instrumented common", version: 2, moduleName: "", ownerPass: "Image" },
      ],
    });

    expect(compile).toHaveBeenCalledWith(
      "instrumented image",
      previous.config,
      "/image.slang",
      { common: "instrumented common" },
      "",
      [],
      [],
      "/image.slang",
      previous.slangSourcePaths,
    );
  });

  it("preserves the installed compute workspace while compiling an image debug wrapper", async () => {
    const engine = new WebGPURenderingEngine(assets);
    const compile = vi.spyOn(engine, "compileShaderPipeline").mockResolvedValue({ success: true });
    const previous = {
      code: "float4 mainImage(float2 coord) { return 0; }",
      config: { version: "1.0", passes: { Image: { inputs: {} }, ComputeUpdate: { type: 'compute', path: "update.slang" } } },
      path: "/image.slang",
      buffers: { common: "StructuredBuffer<float> samples;", ComputeUpdate: "void computeMain(uint3 id) {}" },
      customUniformDeclarations: "",
      customUniformInfo: [],
      slangModules: [{ moduleName: "support", path: "/support.slang", source: "module support;", ownerPass: "ComputeUpdate" }],
      slangSourcePath: "/image.slang",
    };
    (engine as unknown as { lastCompile: typeof previous }).lastCompile = previous;

    await engine.compileSlangDebugPlan({
      workspaceHash: "hash", rootUri: "file:///update.slang", selectedSourceUri: "file:///update.slang", executionMarkerSlot: 0, captureSlots: [],
      files: [{ uri: "file:///update.slang", path: "/update.slang", source: "float4 mainImage(float2 coord) { return 0; }", version: 1, moduleName: "", ownerPass: "ComputeUpdate" }],
    });

    expect(compile).toHaveBeenCalledWith(
      expect.any(String), previous.config, "/image.slang", previous.buffers,
      "", [], previous.slangModules, "/image.slang", undefined,
    );
  });

  it("initializes without throwing when WebGPU is unavailable", () => {
    const engine = new WebGPURenderingEngine(assets);
    expect(() => engine.initialize(noWebGpuCanvas())).not.toThrow();
  });

  it("connects mesh camera controls to the Slang canvas and input state", () => {
    const engine = new WebGPURenderingEngine(assets);
    const canvas = webGpuCanvas({ configure: vi.fn() });
    const meshCamera = {
      attach: vi.fn(),
      setInputEnabled: vi.fn(),
    };
    (engine as unknown as { meshCamera: typeof meshCamera }).meshCamera = meshCamera;

    engine.initialize(canvas);
    engine.setInputEnabled(false);

    expect(meshCamera.attach).toHaveBeenCalledWith(canvas);
    expect(meshCamera.setInputEnabled).toHaveBeenCalledWith(false);
  });

  it("does not throw if getContext itself throws", () => {
    const canvas = {
      width: 1,
      height: 1,
      getContext: vi.fn(() => {
        throw new Error("Not implemented");
      }),
      addEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const engine = new WebGPURenderingEngine(assets);
    expect(() => engine.initialize(canvas)).not.toThrow();
  });

  it("reports a compile failure (not a crash) when the device is unavailable", async () => {
    const engine = new WebGPURenderingEngine(assets);
    engine.initialize(noWebGpuCanvas());
    const result = await engine.compileShaderPipeline("float4 mainImage(float2 c){return float4(1);}", null, "/a.slang", {});
    expect(result?.success).toBe(false);
    expect(result?.errors?.[0]).toMatch(/WebGPU init failed/);
  });

  it("reports a clear failure if compile is called before initialize", async () => {
    const engine = new WebGPURenderingEngine(assets);
    const result = await engine.compileShaderPipeline("float4 mainImage(float2 c){return float4(1);}", null, "/a.slang", {});
    expect(result?.success).toBe(false);
    expect(result?.errors?.[0]).toMatch(/engine was not initialized/);
  });

  it("logs WebGPU initialization timing boundaries when Slang timing debug is enabled", async () => {
    const context = { configure: vi.fn() };
    // initDevice() also constructs a ResourceManager, which eagerly builds a
    // 1x1 default texture via WebGPUTextureBackend — the fake device needs
    // just enough surface for that to succeed.
    const device = {
      createTexture: vi.fn(() => ({ createView: vi.fn(() => ({})), destroy: vi.fn() })),
      createSampler: vi.fn(() => ({})),
      queue: { writeTexture: vi.fn() },
    };
    const adapter = { requestDevice: vi.fn(async () => device) };
    const canvas = {
      width: 800,
      height: 600,
      getContext: vi.fn(() => context),
      addEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const engine = new WebGPURenderingEngine({ ...assets, debugTimings: true });
    const compiler = { compile: vi.fn(), dispose: vi.fn() };
    const camera = { setupEventListeners: vi.fn() };
    (engine as any).cameraManager = camera;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("navigator", {
      gpu: {
        requestAdapter: vi.fn(async () => adapter),
        getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
      },
    });
    vi.spyOn(engine as unknown as { createCompiler(): Promise<unknown> }, "createCompiler").mockResolvedValue(compiler);

    try {
      engine.initialize(canvas);
      await (engine as unknown as { ready: Promise<void> }).ready;

      expect(camera.setupEventListeners).toHaveBeenCalledWith(canvas);
      expect(logSpy).toHaveBeenCalledWith("[SlangPerf] init start", {
        canvasWidth: 800,
        canvasHeight: 600,
      });
      expect(logSpy).toHaveBeenCalledWith("[SlangPerf] adapter request start", {});
      expect(logSpy).toHaveBeenCalledWith("[SlangPerf] device request start", {});
      expect(logSpy).toHaveBeenCalledWith("[SlangPerf] context configure", expect.objectContaining({
        format: "bgra8unorm",
      }));
      expect(logSpy).toHaveBeenCalledWith("[SlangPerf] compiler create start", {});
      expect(logSpy).toHaveBeenCalledWith("[SlangPerf] init complete", expect.objectContaining({
        adapterMs: expect.any(Number),
        deviceMs: expect.any(Number),
        compilerMs: expect.any(Number),
        totalMs: expect.any(Number),
      }));
    } finally {
      logSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("requests the adapter's higher texture, storage, and compute limits when available", async () => {
    const context = { configure: vi.fn() };
    const device = {
      createTexture: vi.fn(() => ({ createView: vi.fn(() => ({})), destroy: vi.fn() })),
      createSampler: vi.fn(() => ({})),
      queue: { writeTexture: vi.fn() },
      limits: { maxTextureDimension2D: 16384 },
    };
    const adapter = {
      limits: {
        maxTextureDimension2D: 16384,
        maxStorageBuffersPerShaderStage: 16,
        maxStorageBufferBindingSize: 1024 * 1024 * 1024,
        maxComputeInvocationsPerWorkgroup: 1024,
        maxComputeWorkgroupSizeX: 1024,
        maxComputeWorkgroupSizeY: 1024,
        maxComputeWorkgroupSizeZ: 128,
      },
      requestDevice: vi.fn(async () => device),
    };
    const canvas = {
      width: 800,
      height: 600,
      getContext: vi.fn(() => context),
      addEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const engine = new WebGPURenderingEngine(assets);
    vi.stubGlobal("navigator", {
      gpu: {
        requestAdapter: vi.fn(async () => adapter),
        getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
      },
    });
    vi.spyOn(engine as unknown as { createCompiler(): Promise<unknown> }, "createCompiler")
      .mockResolvedValue({ compile: vi.fn(), dispose: vi.fn() });

    try {
      engine.initialize(canvas);
      await (engine as unknown as { ready: Promise<void> }).ready;

      expect(adapter.requestDevice).toHaveBeenCalledWith({
        requiredLimits: {
          maxTextureDimension2D: 16384,
          maxStorageBuffersPerShaderStage: 16,
          maxStorageBufferBindingSize: 1024 * 1024 * 1024,
          maxComputeInvocationsPerWorkgroup: 1024,
          maxComputeWorkgroupSizeX: 1024,
          maxComputeWorkgroupSizeY: 1024,
          maxComputeWorkgroupSizeZ: 128,
        },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ["absent", {}],
    ["at defaults", {
      maxTextureDimension2D: 8192,
      maxStorageBuffersPerShaderStage: 8,
      maxStorageBufferBindingSize: 128 * 1024 * 1024,
    }],
    ["non-finite", {
      maxTextureDimension2D: Number.POSITIVE_INFINITY,
      maxStorageBuffersPerShaderStage: Number.NaN,
      maxStorageBufferBindingSize: Number.POSITIVE_INFINITY,
    }],
  ])("omits %s adapter limits from the device request descriptor", async (_case, limits) => {
    const context = { configure: vi.fn() };
    const device = {
      createTexture: vi.fn(() => ({ createView: vi.fn(() => ({})), destroy: vi.fn() })),
      createSampler: vi.fn(() => ({})),
      queue: { writeTexture: vi.fn() },
      limits: {},
    };
    const adapter = {
      limits,
      requestDevice: vi.fn(async () => device),
    };
    const canvas = {
      width: 800,
      height: 600,
      getContext: vi.fn(() => context),
      addEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const engine = new WebGPURenderingEngine(assets);
    vi.stubGlobal("navigator", {
      gpu: {
        requestAdapter: vi.fn(async () => adapter),
        getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
      },
    });
    vi.spyOn(engine as unknown as { createCompiler(): Promise<unknown> }, "createCompiler")
      .mockResolvedValue({ compile: vi.fn(), dispose: vi.fn() });

    try {
      engine.initialize(canvas);
      await (engine as unknown as { ready: Promise<void> }).ready;

      expect(adapter.requestDevice).toHaveBeenCalledWith();
    } finally {
      vi.unstubAllGlobals();
    }
  });


  it("render() is a safe no-op before a pipeline exists", () => {
    const engine = new WebGPURenderingEngine(assets);
    engine.initialize(noWebGpuCanvas());
    expect(() => engine.render(0)).not.toThrow();
  });

  it("renderForCapture renders one frame even when FPS pacing would skip render()", () => {
    const engine = new WebGPURenderingEngine(assets);
    stubDeviceAndContext(engine);
    const imagePipeline = renderablePipeline({
      getCurrentOutputView: () => null,
      getPreviousOutputView: () => null,
    });
    (engine as any).passGraph = [
      { name: "Image", width: 320, height: 180, output: "canvas", channels: [] },
    ];
    (engine as any).passPipelines = new Map([["Image", imagePipeline]]);
    engine.setFPSLimit(1);

    engine.render(1000);
    engine.render(1001);
    engine.renderForCapture();

    const device = (engine as any).device;
    expect(device.queue.submit).toHaveBeenCalledTimes(2);
  });

  it("rejects an invalid config with a validation error before compiling", async () => {
    const engine = new WebGPURenderingEngine(assets);
    engine.initialize(noWebGpuCanvas());
    // Missing `passes` — ConfigValidator must reject this like WebGL does.
    const invalidConfig = { version: "1.0" } as ShaderConfig;
    const result = await engine.compileShaderPipeline("float4 mainImage(float2 c){return float4(1);}", invalidConfig, "/a.slang", {});
    expect(result?.success).toBe(false);
    expect(result?.errors?.[0]).toMatch(/Invalid shader configuration/);
  });

  describe("duplicate frame parity with WebGL", () => {
    it("drops duplicate frames with zero delta time (VS Code multi-panel rendering)", () => {
      const { engine } = pausableEngine();
      const device = (engine as any).device;

      engine.render(1000);
      engine.render(1016);
      expect(device.queue.submit).toHaveBeenCalledTimes(2);

      engine.render(1016); // duplicate timestamp → deltaTime === 0
      expect(device.queue.submit).toHaveBeenCalledTimes(2);
      expect(engine.getTimeManager().getFrame()).toBe(2);

      engine.render(1033); // normal frame renders again
      expect(device.queue.submit).toHaveBeenCalledTimes(3);
      expect(engine.getTimeManager().getFrame()).toBe(3);
    });

    it("does not drop frame 0 even with zero delta time (new shader load)", () => {
      const { engine } = pausableEngine();
      const device = (engine as any).device;

      engine.render(0);
      expect(device.queue.submit).toHaveBeenCalledTimes(1);
    });
  });

  /** Engine with a BufferA→Image pass graph and controllable input managers. */
  function pausableEngine() {
    const engine = new WebGPURenderingEngine(assets);
    stubDeviceAndContext(engine);

    const bufferPipeline = renderablePipeline({
      getCurrentOutputView: () => ({ label: "bufferA-current" }),
      getPreviousOutputView: () => ({ label: "bufferA-previous" }),
    });
    const imagePipeline = renderablePipeline({
      getCurrentOutputView: () => null,
      getPreviousOutputView: () => null,
    });

    (engine as any).passGraph = [
      { name: "BufferA", width: 320, height: 180, output: "texture", channels: [] },
      { name: "Image", width: 320, height: 180, output: "canvas", channels: [] },
    ];
    (engine as any).passPipelines = new Map([
      ["BufferA", bufferPipeline],
      ["Image", imagePipeline],
    ]);

    const mouse = { value: [0, 0, 0, 0] as number[] };
    (engine as any).mouseManager = {
      getMouse: vi.fn(() => Float32Array.from(mouse.value)),
      setupEventListeners: vi.fn(),
      setEnabled: vi.fn(),
    };

    const camera = {
      pos: [0, 0, 0] as number[],
      dir: [0, 0, -1] as number[],
      update: vi.fn(),
      getCameraPos: vi.fn(() => camera.pos),
      getCameraDir: vi.fn(() => camera.dir),
      setupEventListeners: vi.fn(),
      setEnabled: vi.fn(),
      reset: vi.fn(),
      dispose: vi.fn(),
    };
    (engine as any).cameraManager = camera;

    return { engine, bufferPipeline, imagePipeline, mouse, camera };
  }

  /** Uniform payloads written during the most recent render call. */
  function lastFrameUniformWrites(engine: WebGPURenderingEngine, passCount: number): Float32Array[] {
    const calls = ((engine as any).device.queue.writeBuffer as ReturnType<typeof vi.fn>).mock.calls;
    return calls.slice(-passCount).map((call) => new Float32Array(call[2] as ArrayBuffer));
  }

  describe("pause parity with WebGL", () => {
    // Mirrors the WebGL FrameRenderer pause contract: while paused, buffer
    // passes stop advancing, iFrame freezes, and uniforms (mouse included)
    // stay at the values captured when the pause began.

    it("skips buffer passes and their swap while paused (image pass still renders)", () => {
      const { engine, bufferPipeline } = pausableEngine();

      engine.render(1000); // frame 0, running
      engine.render(1016); // frame 1, running
      expect(bufferPipeline.swap).toHaveBeenCalledTimes(2);

      engine.togglePause();
      engine.render(1033);
      engine.render(1050);

      // Buffer pass no longer renders or swaps, but frames still submit
      // (image pass keeps drawing, e.g. for resize).
      expect(bufferPipeline.swap).toHaveBeenCalledTimes(2);
      const device = (engine as any).device;
      expect(device.queue.submit).toHaveBeenCalledTimes(4);
    });

    it("still renders buffer passes on frame 0 while paused (new shader loaded paused)", () => {
      const { engine, bufferPipeline } = pausableEngine();

      engine.togglePause();
      engine.render(1000);

      expect(bufferPipeline.swap).toHaveBeenCalledTimes(1);
    });

    it("does not increment iFrame while paused", () => {
      const { engine } = pausableEngine();

      engine.render(1000);
      engine.render(1016);
      expect(engine.getTimeManager().getFrame()).toBe(2);

      engine.togglePause();
      engine.render(1033);
      engine.render(1050);
      expect(engine.getTimeManager().getFrame()).toBe(2);
    });

    it("freezes mouse uniforms at the values captured when the pause began", () => {
      const { engine, mouse } = pausableEngine();

      mouse.value = [10, 20, 0, 0];
      engine.render(1000);

      engine.togglePause();
      mouse.value = [50, 60, 0, 0];
      engine.render(1016); // pause entry: captures current mouse

      mouse.value = [99, 88, 0, 0];
      engine.render(1033); // must still use the frozen mouse

      const [imageUniforms] = lastFrameUniformWrites(engine, 1);
      expect([imageUniforms[4], imageUniforms[5]]).toEqual([50, 60]);
    });

    it("uses live mouse values again after unpausing", () => {
      const { engine, mouse } = pausableEngine();

      engine.render(1000);
      engine.togglePause();
      mouse.value = [50, 60, 0, 0];
      engine.render(1016);

      engine.togglePause(); // unpause
      mouse.value = [70, 80, 0, 0];
      engine.render(1033);

      const writes = lastFrameUniformWrites(engine, 2);
      for (const uniforms of writes) {
        expect([uniforms[4], uniforms[5]]).toEqual([70, 80]);
      }
    });

    it("updates camera motion using rendered-frame wall time and uploads its uniforms", () => {
      const { engine, camera } = pausableEngine();
      camera.pos = [1, 2, 3];
      camera.dir = [0.25, 0.5, -0.75];

      engine.render(1000);
      engine.render(1016);

      expect(camera.update).toHaveBeenNthCalledWith(1, 0);
      expect(camera.update).toHaveBeenNthCalledWith(2, 0.016);
      const writes = lastFrameUniformWrites(engine, 2);
      for (const uniforms of writes) {
        const cameraPos = UNIFORM_OFFSETS.iCameraPos / 4;
        const cameraDir = UNIFORM_OFFSETS.iCameraDir / 4;
        expect(Array.from(uniforms.slice(cameraPos, cameraPos + 3))).toEqual([1, 2, 3]);
        expect(Array.from(uniforms.slice(cameraDir, cameraDir + 3))).toEqual([0.25, 0.5, -0.75]);
      }
    });

    it("freezes camera uniforms at pause entry while camera controls keep updating", () => {
      const { engine, camera } = pausableEngine();

      engine.render(1000);
      engine.togglePause();
      camera.pos = [1, 2, 3];
      camera.dir = [0.25, 0.5, -0.75];
      engine.render(1016);

      camera.pos = [9, 8, 7];
      camera.dir = [1, 0, 0];
      engine.render(1033);

      expect(camera.update).toHaveBeenLastCalledWith(0.017);
      const [uniforms] = lastFrameUniformWrites(engine, 1);
      const cameraPos = UNIFORM_OFFSETS.iCameraPos / 4;
      const cameraDir = UNIFORM_OFFSETS.iCameraDir / 4;
      expect(Array.from(uniforms.slice(cameraPos, cameraPos + 3))).toEqual([1, 2, 3]);
      expect(Array.from(uniforms.slice(cameraDir, cameraDir + 3))).toEqual([0.25, 0.5, -0.75]);
    });

    it("renderForCapture preserves the frozen paused uniform snapshot", () => {
      const { engine, mouse } = pausableEngine();

      engine.render(1000);
      engine.togglePause();
      mouse.value = [50, 60, 0, 0];
      engine.render(1016); // captures the paused uniform snapshot

      mouse.value = [99, 88, 0, 0];
      engine.renderForCapture();

      const [imageUniforms] = lastFrameUniformWrites(engine, 1);
      expect([imageUniforms[4], imageUniforms[5]]).toEqual([50, 60]);
      expect((engine as any).pausedUniformInput).not.toBeNull();
    });

    it("synchronizes and pauses or resumes audio and video with shader time", () => {
      const { engine } = pausableEngine();
      vi.spyOn(engine.getTimeManager(), "getCurrentTime").mockReturnValue(2.25);
      const resourceManager = {
        syncAllVideosToTime: vi.fn(),
        syncAllAudioToTime: vi.fn(),
        pauseAllVideos: vi.fn(),
        pauseAllAudio: vi.fn(),
        resumeAllVideos: vi.fn(),
        resumeAllAudio: vi.fn(),
      };
      (engine as any).resourceManager = resourceManager;

      engine.togglePause();

      expect(resourceManager.syncAllVideosToTime).toHaveBeenLastCalledWith(2.25);
      expect(resourceManager.syncAllAudioToTime).toHaveBeenLastCalledWith(2.25);
      expect(resourceManager.pauseAllVideos).toHaveBeenCalledTimes(1);
      expect(resourceManager.pauseAllAudio).toHaveBeenCalledTimes(1);

      engine.togglePause();

      expect(resourceManager.resumeAllVideos).toHaveBeenCalledTimes(1);
      expect(resourceManager.resumeAllAudio).toHaveBeenCalledTimes(1);
    });
  });

  it("exposes a TimeManager and the expected uniform shape", () => {
    const engine = new WebGPURenderingEngine(assets);
    engine.initialize(noWebGpuCanvas());
    expect(engine.getTimeManager()).toBeInstanceOf(TimeManager);

    const u = engine.getUniforms();
    expect(u.res).toEqual([800, 600, 1]);
    expect(u.mouse).toHaveLength(4);
    expect(u.channelLoaded).toEqual(new Array(16).fill(0));
  });

  it("collects loaded state and resolution metadata for channel 15", () => {
    const engine = new WebGPURenderingEngine(assets);
    (engine as any).resourceManager = {
      getImageTextureCache: () => ({ high: { width: 4096, height: 2048 } }),
      getAudioSampleRate: () => 48000,
    };

    const uniforms = (engine as any).getChannelUniforms({
      channels: [{ slot: 15, key: 'iChannel15', kind: 'texture', path: 'high' }],
    });

    expect(uniforms.channelLoaded[15]).toBe(1);
    expect(uniforms.channelResolution.slice(45, 48)).toEqual([4096, 2048, 1]);
  });

  it("stubs unsupported features with safe defaults", () => {
    const engine = new WebGPURenderingEngine(assets);
    engine.initialize(noWebGpuCanvas());
    expect(engine.getPasses()).toEqual([]);
    expect(engine.getCustomUniformInfo()).toEqual([]);
    expect(engine.getCustomUniformDeclarations()).toBe("");
    expect(engine.requestPixelRegion(1, 0, 0)).toBe(false);
    expect(engine.collectPixelRegionResults()).toEqual([]);
    expect(engine.getAudioFFTData()).toBeNull();
  });

  it("throws a clear error if variable capture is attempted before the device is ready", () => {
    const engine = new WebGPURenderingEngine(assets);
    expect(() => engine.createVariableCapturer()).toThrow(/initialized/i);
  });

  it("dispose() disposes the compiler", () => {
    const engine = new WebGPURenderingEngine(assets);
    const compiler = { compile: vi.fn(), dispose: vi.fn() };
    (engine as any).compiler = compiler;
    engine.dispose();
    expect(compiler.dispose).toHaveBeenCalled();
  });

  it("remembers the config from the last successful compile", async () => {
    const engine = new WebGPURenderingEngine(assets);
    stubEngineInternals(engine);
    const config: ShaderConfig = { version: "1", passes: { Image: { inputs: {} } } };
    await engine.compileShaderPipeline("x", config, "/a.slang", {});
    expect(engine.getCurrentConfig()).toBe(config);
  });

  it("compiles configured Slang buffer and image passes", async () => {
    const engine = new WebGPURenderingEngine(assets);
    const device = {
      createShaderModule: vi.fn(() => ({ getCompilationInfo: vi.fn(async () => ({ messages: [] })) })),
      createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: vi.fn(() => ({})) })),
      createBindGroupLayout: vi.fn(() => ({})),
      createPipelineLayout: vi.fn(() => ({})),
      createBuffer: vi.fn(() => ({})),
      createSampler: vi.fn(() => ({})),
      createBindGroup: vi.fn(() => ({})),
      createTexture: vi.fn(() => ({
        createView: vi.fn(() => ({})),
        destroy: vi.fn(),
      })),
      pushErrorScope: vi.fn(),
      popErrorScope: vi.fn(async () => null),
    };
    const compiler = {
      compile: vi.fn(async () => ({ success: true, wgsl: "// wgsl" })),
      dispose: vi.fn(),
    };

    (engine as any).canvas = { width: 320, height: 180 };
    (engine as any).device = device;
    (engine as any).compiler = compiler;
    (engine as any).format = "bgra8unorm";

    const result = await engine.compileShaderPipeline(
      "float4 mainImage(float2 c) { return float4(0); }",
      {
        version: "1",
        passes: {
          Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA" } } },
          BufferA: { path: "buffer-a.slang", inputs: {} },
        },
      },
      "/image.slang",
      { BufferA: "float4 mainImage(float2 c) { return float4(1); }" },
      undefined,
      undefined,
      [
        { moduleName: "buffer_helpers", path: "/buffer-helpers.slang", source: "module buffer_helpers;", ownerPass: "BufferA" },
        { moduleName: "image_helpers", path: "/image-helpers.slang", source: "module image_helpers;", ownerPass: "Image" },
      ],
      undefined,
      { Image: "/image.slang", BufferA: "/passes/buffer-a.slang" },
    );

    expect(result?.success).toBe(true);
    expect(engine.getPasses().map((pass) => pass.name)).toEqual(["BufferA", "Image"]);
    expect(compiler.compile).toHaveBeenCalledTimes(2);
    expect(compiler.compile).toHaveBeenNthCalledWith(1, expect.stringContaining("float4(1)"), {
      passName: "BufferA",
      commonCode: "",
      channels: [],
      storage: [],
      passKind: "render",
      workgroupSize: [8, 8, 1],
      outputLayers: 1,
      hasOutput: true,
      modules: [{
        moduleName: "buffer_helpers",
        path: "/buffer-helpers.slang",
        source: "module buffer_helpers;",
      }],
      sourcePath: "/passes/buffer-a.slang",
    });
    expect(compiler.compile).toHaveBeenNthCalledWith(2, expect.stringContaining("float4(0)"), {
      passName: "Image",
      commonCode: "",
      channels: [{ slot: 0, key: "iChannel0", kind: "buffer" }],
      storage: [],
      passKind: "render",
      workgroupSize: [8, 8, 1],
      outputLayers: 1,
      hasOutput: false,
      modules: [{
        moduleName: "image_helpers",
        path: "/image-helpers.slang",
        source: "module image_helpers;",
      }],
      sourcePath: "/image.slang",
    });
  });

  it("clears feedback only after the reset recompile succeeds", async () => {
    const engine = new WebGPURenderingEngine(assets);
    stubEngineInternals(engine);
    const config: ShaderConfig = {
      version: "1",
      passes: {
        BufferA: { path: "buffer-a.slang", inputs: {} },
        Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA" } } },
      },
    };
    const code = "float4 mainImage(float2 c) { return float4(0); }";
    await engine.compileShaderPipeline(code, config, "/image.slang", { BufferA: code });
    const buffer = (engine as any).passPipelines.get("BufferA") as SlangPassPipeline;
    const resetSpy = vi.spyOn(buffer, "resetOutputTextures");

    engine.resetTime();
    expect(resetSpy).not.toHaveBeenCalled();
    const result = await engine.compileShaderPipeline(code, config, "/image.slang", { BufferA: code });

    expect(result?.success).toBe(true);
    expect(resetSpy).toHaveBeenCalledTimes(1);
  });

  it("compiles arbitrary configured buffer names", async () => {
    const engine = new WebGPURenderingEngine(assets);
    const { compiler } = stubEngineInternals(engine);
    const config: ShaderConfig = {
      version: "1",
      passes: {
        Image: { inputs: { iChannel0: { type: "buffer", source: "Bloom" } } },
        SceneData: { path: "scene.slang", inputs: {} },
        Bloom: { path: "bloom.slang", inputs: {} },
      },
    };

    const result = await engine.compileShaderPipeline(
      "float4 mainImage(float2 c) { return float4(0); }",
      config,
      "/image.slang",
      {
        SceneData: "float4 mainImage(float2 c) { return float4(1); }",
        Bloom: "float4 mainImage(float2 c) { return float4(2); }",
      },
    );

    expect(result?.success).toBe(true);
    expect(engine.getPasses().map((pass) => pass.name)).toEqual([
      "SceneData",
      "Bloom",
      "Image",
    ]);
    expect(compiler.compile.mock.calls.map((call) => call[1].passName)).toEqual([
      "SceneData",
      "Bloom",
      "Image",
    ]);
  });

  it("returns a failure without creating any pipelines when the pass graph has errors", async () => {
    const engine = new WebGPURenderingEngine(assets);
    const device = {
      createShaderModule: vi.fn(),
      createRenderPipeline: vi.fn(),
      createBuffer: vi.fn(),
      createSampler: vi.fn(),
      createBindGroup: vi.fn(),
      createTexture: vi.fn(),
    };
    const compiler = { compile: vi.fn(async () => ({ success: false, errors: [] })), dispose: vi.fn() };

    (engine as any).canvas = { width: 320, height: 180 };
    (engine as any).device = device;
    (engine as any).compiler = compiler;
    (engine as any).format = "bgra8unorm";

    const result = await engine.compileShaderPipeline(
      "float4 mainImage(float2 c) { return float4(0); }",
      {
        version: "1",
        passes: {
          Image: { inputs: { iChannel0: { type: "buffer", source: "MissingPass" } } },
        },
      },
      "/image.slang",
      {}, // Referencing no configured pass -> pass graph reports an error
    );

    expect(result?.success).toBe(false);
    expect(result?.errors?.[0]).toMatch(/MissingPass/);
    expect(compiler.compile).not.toHaveBeenCalled();
    expect(device.createShaderModule).not.toHaveBeenCalled();
    expect(engine.getPasses()).toEqual([]);
  });

  it("disposes discarded pass pipelines on recompile", async () => {
    const engine = new WebGPURenderingEngine(assets);
    const device = {
      createShaderModule: vi.fn(() => ({ getCompilationInfo: vi.fn(async () => ({ messages: [] })) })),
      createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: vi.fn(() => ({})) })),
      createBindGroupLayout: vi.fn(() => ({})),
      createPipelineLayout: vi.fn(() => ({})),
      createBuffer: vi.fn(() => ({})),
      createSampler: vi.fn(() => ({})),
      createBindGroup: vi.fn(() => ({})),
      createTexture: vi.fn(() => ({
        createView: vi.fn(() => ({})),
        destroy: vi.fn(),
      })),
      pushErrorScope: vi.fn(),
      popErrorScope: vi.fn(async () => null),
    };
    const compiler = {
      compile: vi.fn(() => ({ success: true, wgsl: "// wgsl" })),
      dispose: vi.fn(),
    };

    (engine as any).canvas = { width: 320, height: 180 };
    (engine as any).device = device;
    (engine as any).compiler = compiler;
    (engine as any).format = "bgra8unorm";

    const config = {
      version: "1",
      passes: {
        Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA" } } },
        BufferA: { path: "buffer-a.slang", inputs: {} },
      },
    };
    const buffers = { BufferA: "float4 mainImage(float2 c) { return float4(1); }" };

    await engine.compileShaderPipeline(
      "float4 mainImage(float2 c) { return float4(0); }",
      config,
      "/image.slang",
      buffers,
    );
    const firstPipelines = (engine as any).passPipelines as Map<string, { dispose: () => void }>;
    expect(firstPipelines.size).toBe(2);
    const disposeSpies = [...firstPipelines.values()].map((pipeline) => vi.spyOn(pipeline, "dispose"));

    // Change BOTH the image code and the buffer content: with the per-pass
    // compile cache, a pass whose content is unchanged is reused instead of
    // disposed, so this must actually edit every pass to still exercise
    // "discard + dispose" for all of them.
    await engine.compileShaderPipeline(
      "float4 mainImage(float2 c) { return float4(2); }",
      config,
      "/image.slang",
      { BufferA: "float4 mainImage(float2 c) { return float4(3); }" },
    );

    expect(disposeSpies).toHaveLength(2);
    for (const spy of disposeSpies) {
      expect(spy).toHaveBeenCalledTimes(1);
    }
  });

  it("resolves to a failure naming the pass when pipeline creation throws", async () => {
    const engine = new WebGPURenderingEngine(assets);
    const device = {
      createShaderModule: vi.fn(() => ({ getCompilationInfo: vi.fn(async () => ({ messages: [] })) })),
      createRenderPipeline: vi.fn(() => {
        throw new Error("device lost");
      }),
      createBindGroupLayout: vi.fn(() => ({})),
      createPipelineLayout: vi.fn(() => ({})),
      createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
      createSampler: vi.fn(() => ({})),
      createBindGroup: vi.fn(() => ({})),
      createTexture: vi.fn(() => ({
        createView: vi.fn(() => ({})),
        destroy: vi.fn(),
      })),
      pushErrorScope: vi.fn(),
      popErrorScope: vi.fn(async () => null),
    };
    const compiler = {
      compile: vi.fn(() => ({ success: true, wgsl: "// wgsl" })),
      dispose: vi.fn(),
    };

    (engine as any).canvas = { width: 320, height: 180 };
    (engine as any).device = device;
    (engine as any).compiler = compiler;
    (engine as any).format = "bgra8unorm";

    const disposeSpy = vi.spyOn(SlangPassPipeline.prototype, "dispose");
    try {
      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(0); }",
        null,
        "/image.slang",
        {},
      );

      expect(result?.success).toBe(false);
      expect(result?.errors).toEqual(["Image: device lost"]);
      expect(engine.getPasses()).toEqual([]);
      // The pipeline instance was constructed before rebuild() threw mid-way
      // through building it; it must still be disposed to release any
      // partially-created GPU resources.
      expect(disposeSpy).toHaveBeenCalledTimes(1);
    } finally {
      disposeSpy.mockRestore();
    }
  });

  it("disposes already-built pipelines when a later pass fails to compile", async () => {
    const engine = new WebGPURenderingEngine(assets);
    const device = {
      createShaderModule: vi.fn(() => ({ getCompilationInfo: vi.fn(async () => ({ messages: [] })) })),
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
      pushErrorScope: vi.fn(),
      popErrorScope: vi.fn(async () => null),
    };
    const compiler = {
      compile: vi
        .fn()
        .mockReturnValueOnce({ success: true, wgsl: "// wgsl" }) // BufferA builds fine
        .mockReturnValueOnce({ success: false, errors: ["bad shader"] }), // Image fails
      dispose: vi.fn(),
    };

    (engine as any).canvas = { width: 320, height: 180 };
    (engine as any).device = device;
    (engine as any).compiler = compiler;
    (engine as any).format = "bgra8unorm";

    const disposeSpy = vi.spyOn(SlangPassPipeline.prototype, "dispose");
    try {
      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(0); }",
        {
          version: "1",
          passes: {
            Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA" } } },
            BufferA: { path: "buffer-a.slang", inputs: {} },
          },
        },
        "/image.slang",
        { BufferA: "float4 mainImage(float2 c) { return float4(1); }" },
      );

      expect(result?.success).toBe(false);
      expect(result?.errors).toEqual(["Image: bad shader"]);
      // The BufferA pipeline was fully built before Image failed; it must be disposed.
      expect(disposeSpy).toHaveBeenCalledTimes(1);
      expect(engine.getPasses()).toEqual([]);
    } finally {
      disposeSpy.mockRestore();
    }
  });

  it("compiles custom-named channel inputs without a warning", async () => {
    const engine = new WebGPURenderingEngine(assets);
    const device = {
      createShaderModule: vi.fn(() => ({ getCompilationInfo: vi.fn(async () => ({ messages: [] })) })),
      createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: vi.fn(() => ({})) })),
      createBindGroupLayout: vi.fn(() => ({})),
      createPipelineLayout: vi.fn(() => ({})),
      createBuffer: vi.fn(() => ({})),
      createSampler: vi.fn(() => ({})),
      createBindGroup: vi.fn(() => ({})),
      createTexture: vi.fn(() => ({
        createView: vi.fn(() => ({})),
        destroy: vi.fn(),
      })),
      pushErrorScope: vi.fn(),
      popErrorScope: vi.fn(async () => null),
    };
    const compiler = {
      compile: vi.fn(() => ({ success: true, wgsl: "// wgsl" })),
      dispose: vi.fn(),
    };

    (engine as any).canvas = { width: 320, height: 180 };
    (engine as any).device = device;
    (engine as any).compiler = compiler;
    (engine as any).format = "bgra8unorm";

    const result = await engine.compileShaderPipeline(
      "float4 mainImage(float2 c) { return float4(0); }",
      {
        version: "1",
        passes: {
          Image: { inputs: { ignoredInput: { type: "audio", path: "foo.mp3" } } },
        },
      },
      "/image.slang",
      {},
    );

    expect(result?.success).toBe(true);
    expect(result?.warnings).toBeUndefined();
    expect(compiler.compile).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        channels: [{ slot: 0, key: "ignoredInput", kind: "audio" }],
      }),
    );
  });

  it("renders buffer passes before Image and swaps buffer textures once per frame", () => {
    const engine = new WebGPURenderingEngine(assets);
    const calls: string[] = [];
    const bufferPipeline = {
      getPipeline: () => ({ label: "buffer-pipeline" }),
      getBindGroup: () => ({ label: "buffer-bind-group" }),
      getUniformBuffer: () => ({ label: "buffer-uniform" }),
      getCurrentOutputView: () => ({ label: "buffer-current-view" }),
      getPreviousOutputView: () => ({ label: "buffer-previous-view" }),
      rebuildBindGroup: vi.fn(),
      swap: vi.fn(() => calls.push("swap:BufferA")),
    };
    const imagePipeline = {
      getPipeline: () => ({ label: "image-pipeline" }),
      getBindGroup: () => ({ label: "image-bind-group" }),
      getUniformBuffer: () => ({ label: "image-uniform" }),
      getCurrentOutputView: () => null,
      getPreviousOutputView: () => null,
      rebuildBindGroup: vi.fn(),
      swap: vi.fn(),
    };

    (engine as any).device = {
      queue: {
        writeBuffer: vi.fn(),
        submit: vi.fn(),
      },
      createCommandEncoder: vi.fn(() => ({
        beginRenderPass: vi.fn((descriptor) => {
          calls.push(descriptor.colorAttachments[0].view.label ?? "canvas");
          return {
            setPipeline: vi.fn(),
            setBindGroup: vi.fn(),
            draw: vi.fn(),
            end: vi.fn(),
          };
        }),
        finish: vi.fn(() => ({})),
      })),
    };
    (engine as any).context = {
      getCurrentTexture: () => ({ createView: () => ({ label: "canvas" }) }),
    };
    (engine as any).canvas = { width: 320, height: 180 };
    (engine as any).passGraph = [
      { name: "BufferA", width: 320, height: 180, output: "texture", channels: [] },
      { name: "Image", width: 320, height: 180, output: "canvas", channels: [] },
    ];
    (engine as any).passPipelines = new Map([
      ["BufferA", bufferPipeline],
      ["Image", imagePipeline],
    ]);

    engine.render(1000);

    expect(calls).toEqual(["buffer-current-view", "canvas", "swap:BufferA"]);
  });

  it("never calls swap() on the canvas (Image) pass", () => {
    const engine = new WebGPURenderingEngine(assets);
    const bufferPipeline = {
      getPipeline: () => ({ label: "buffer-pipeline" }),
      getBindGroup: () => ({ label: "buffer-bind-group" }),
      getUniformBuffer: () => ({ label: "buffer-uniform" }),
      getCurrentOutputView: () => ({ label: "buffer-current-view" }),
      getPreviousOutputView: () => ({ label: "buffer-previous-view" }),
      rebuildBindGroup: vi.fn(),
      swap: vi.fn(),
    };
    const imagePipeline = {
      getPipeline: () => ({ label: "image-pipeline" }),
      getBindGroup: () => ({ label: "image-bind-group" }),
      getUniformBuffer: () => ({ label: "image-uniform" }),
      getCurrentOutputView: () => null,
      getPreviousOutputView: () => null,
      rebuildBindGroup: vi.fn(),
      swap: vi.fn(),
    };

    (engine as any).device = {
      queue: { writeBuffer: vi.fn(), submit: vi.fn() },
      createCommandEncoder: vi.fn(() => ({
        copyTextureToTexture: vi.fn(),
        beginRenderPass: vi.fn(() => ({
          setPipeline: vi.fn(),
          setBindGroup: vi.fn(),
          draw: vi.fn(),
          end: vi.fn(),
        })),
        finish: vi.fn(() => ({})),
      })),
    };
    (engine as any).context = {
      getCurrentTexture: () => ({ createView: () => ({ label: "canvas" }) }),
    };
    (engine as any).canvas = { width: 320, height: 180 };
    (engine as any).passGraph = [
      { name: "BufferA", width: 320, height: 180, output: "texture", channels: [] },
      { name: "Image", width: 320, height: 180, output: "canvas", channels: [] },
    ];
    (engine as any).passPipelines = new Map([
      ["BufferA", bufferPipeline],
      ["Image", imagePipeline],
    ]);

    engine.render(1000);

    expect(bufferPipeline.swap).toHaveBeenCalledTimes(1);
    expect(imagePipeline.swap).not.toHaveBeenCalled();
  });

  it("render() with a populated pass graph but no compiled pipelines is a safe no-op", () => {
    const engine = new WebGPURenderingEngine(assets);
    const writeBuffer = vi.fn();
    const beginRenderPass = vi.fn();
    const getCurrentTexture = vi.fn();
    (engine as any).device = {
      queue: { writeBuffer, submit: vi.fn() },
      createCommandEncoder: vi.fn(() => ({
        beginRenderPass,
        finish: vi.fn(() => ({})),
      })),
    };
    (engine as any).context = { getCurrentTexture };
    (engine as any).canvas = { width: 320, height: 180 };
    (engine as any).passGraph = [
      { name: "Image", width: 320, height: 180, output: "canvas", channels: [] },
    ];
    // No entry in passPipelines for "Image" -> render() must skip it entirely
    // rather than crashing on a missing pipeline.
    (engine as any).passPipelines = new Map();

    expect(() => engine.render(0)).not.toThrow();
    expect(writeBuffer).not.toHaveBeenCalled();
    expect(beginRenderPass).not.toHaveBeenCalled();
    expect(getCurrentTexture).not.toHaveBeenCalled();
  });

  it("writes a distinct uniform buffer per pass with each pass's own resolution", () => {
    const engine = new WebGPURenderingEngine(assets);
    const writeBuffer = vi.fn();
    const bufferUniform = { label: "buffer-uniform" };
    const imageUniform = { label: "image-uniform" };
    const bufferPipeline = {
      getPipeline: () => ({ label: "buffer-pipeline" }),
      getBindGroup: () => ({ label: "buffer-bind-group" }),
      getUniformBuffer: () => bufferUniform,
      getCurrentOutputView: () => ({ label: "buffer-current-view" }),
      getPreviousOutputView: () => ({ label: "buffer-previous-view" }),
      rebuildBindGroup: vi.fn(),
      swap: vi.fn(),
    };
    const imagePipeline = {
      getPipeline: () => ({ label: "image-pipeline" }),
      getBindGroup: () => ({ label: "image-bind-group" }),
      getUniformBuffer: () => imageUniform,
      getCurrentOutputView: () => null,
      getPreviousOutputView: () => null,
      rebuildBindGroup: vi.fn(),
      swap: vi.fn(),
    };

    (engine as any).device = {
      queue: { writeBuffer, submit: vi.fn() },
      createCommandEncoder: vi.fn(() => ({
        beginRenderPass: vi.fn(() => ({
          setPipeline: vi.fn(),
          setBindGroup: vi.fn(),
          draw: vi.fn(),
          end: vi.fn(),
        })),
        finish: vi.fn(() => ({})),
      })),
    };
    (engine as any).context = {
      getCurrentTexture: () => ({ createView: () => ({ label: "canvas" }) }),
    };
    (engine as any).canvas = { width: 640, height: 480 };
    (engine as any).passGraph = [
      { name: "BufferA", width: 64, height: 32, output: "texture", channels: [] },
      { name: "Image", width: 640, height: 480, output: "canvas", channels: [] },
    ];
    (engine as any).passPipelines = new Map([
      ["BufferA", bufferPipeline],
      ["Image", imagePipeline],
    ]);

    engine.render(1000);

    expect(writeBuffer).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = writeBuffer.mock.calls;
    expect(firstCall[0]).toBe(bufferUniform);
    expect(secondCall[0]).toBe(imageUniform);

    const firstResolution = new Float32Array(firstCall[2] as ArrayBuffer, 0, 2);
    const secondResolution = new Float32Array(secondCall[2] as ArrayBuffer, 0, 2);
    expect(Array.from(firstResolution)).toEqual([64, 32]);
    expect(Array.from(secondResolution)).toEqual([640, 480]);
  });

  function fullDevice() {
    return {
      createShaderModule: vi.fn(() => ({ getCompilationInfo: vi.fn(async () => ({ messages: [] })) })),
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
        submit: vi.fn(),
        // ResourceManager constructs a 1x1 default texture eagerly (via
        // WebGPUTextureBackend.createTexture), so the fake device needs these
        // even in tests that never load a real texture.
        writeTexture: vi.fn(),
        copyExternalImageToTexture: vi.fn(),
      },
      createCommandEncoder: vi.fn(() => ({
        copyTextureToTexture: vi.fn(),
        beginRenderPass: vi.fn(() => ({
          setPipeline: vi.fn(),
          setBindGroup: vi.fn(),
          draw: vi.fn(),
          end: vi.fn(),
        })),
        finish: vi.fn(() => ({})),
      })),
      pushErrorScope: vi.fn(),
      popErrorScope: vi.fn(async () => null),
    };
  }

  function stubEngineInternals(engine: WebGPURenderingEngine) {
    const device = fullDevice();
    const compiler = { compile: vi.fn(() => ({ success: true, wgsl: "// wgsl" })), dispose: vi.fn() };
    const canvas = { width: 320, height: 180 };

    (engine as any).canvas = canvas;
    (engine as any).device = device;
    (engine as any).compiler = compiler;
    (engine as any).format = "bgra8unorm";
    (engine as any).context = {
      getCurrentTexture: () => ({ createView: () => ({ label: "canvas" }) }),
    };
    return { device, compiler, canvas };
  }

  describe("custom and remaining ShaderToy uniform parity", () => {
    it("compiles, exposes, preserves, and partially updates script uniforms", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { compiler, device } = stubEngineInternals(engine);
      const declarations = "uniform float gain;\nuniform bool enabled;";
      const info = [
        { name: "gain", type: "float" },
        { name: "enabled", type: "bool" },
      ];

      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(enabled ? gain : 0); }",
        null,
        "/image.slang",
        {},
        declarations,
        info,
      );

      expect(result?.success).toBe(true);
      expect(compiler.compile).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        customUniforms: info,
      }));
      expect(engine.getCustomUniformDeclarations()).toBe(declarations);
      expect(engine.getCustomUniformInfo()).toEqual(info);
      expect(engine.getCurrentCustomUniforms()).toEqual([
        { name: "gain", type: "float", value: 0 },
        { name: "enabled", type: "bool", value: false },
      ]);

      engine.setCustomUniformValues([
        { name: "gain", type: "float", value: 0.5 },
        { name: "enabled", type: "bool", value: false },
      ]);
      engine.updateCustomUniformValues([
        { name: "enabled", type: "bool", value: true },
      ]);
      device.queue.writeBuffer.mockClear();
      engine.render(1000);

      expect(engine.getCurrentCustomUniforms()).toEqual([
        { name: "gain", type: "float", value: 0.5 },
        { name: "enabled", type: "bool", value: true },
      ]);
      const packed = device.queue.writeBuffer.mock.calls.at(-1)![2] as ArrayBuffer;
      expect(packed.byteLength).toBe(896);
      const view = new DataView(packed);
      expect(view.getFloat32(880, true)).toBeCloseTo(0.5);
      expect(view.getInt32(884, true)).toBe(1);
    });

    it("preserves values that arrive before custom declarations compile", async () => {
      const engine = new WebGPURenderingEngine(assets);
      stubEngineInternals(engine);
      engine.setCustomUniformValues([{ name: "gain", type: "float", value: 2.5 }]);

      await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(gain); }",
        null,
        "/image.slang",
        {},
        "uniform float gain;",
        [{ name: "gain", type: "float" }],
      );

      expect(engine.getCurrentCustomUniforms()).toEqual([
        { name: "gain", type: "float", value: 2.5 },
      ]);
    });

    it("clears script uniforms when a later compile has no script", async () => {
      const engine = new WebGPURenderingEngine(assets);
      stubEngineInternals(engine);
      await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(gain); }",
        null,
        "/image.slang",
        {},
        "uniform float gain;",
        [{ name: "gain", type: "float" }],
      );

      await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(1); }",
        null,
        "/image.slang",
      );

      expect(engine.getCustomUniformDeclarations()).toBe("");
      expect(engine.getCustomUniformInfo()).toEqual([]);
      expect(engine.getCurrentCustomUniforms()).toEqual([]);
    });

    it("recompiles unchanged shader source when the script uniform layout changes", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { compiler } = stubEngineInternals(engine);
      const source = "float4 mainImage(float2 c) { return float4(1); }";
      await engine.compileShaderPipeline(
        source, null, "/image.slang", {}, "uniform float gain;", [{ name: "gain", type: "float" }],
      );

      await engine.compileShaderPipeline(
        source, null, "/image.slang", {}, "uniform vec4 tint;", [{ name: "tint", type: "vec4" }],
      );

      expect(compiler.compile).toHaveBeenCalledTimes(2);
    });

    it("keeps the installed custom layout when a same-file recompile fails", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { compiler } = stubEngineInternals(engine);
      await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(gain); }",
        null,
        "/image.slang",
        {},
        "uniform float gain;",
        [{ name: "gain", type: "float" }],
      );
      compiler.compile.mockReturnValue({ success: false, errors: ["syntax error"] });

      const result = await engine.compileShaderPipeline(
        "broken",
        null,
        "/image.slang",
        {},
        "uniform vec4 tint;",
        [{ name: "tint", type: "vec4" }],
      );

      expect(result?.success).toBe(false);
      expect(engine.getCustomUniformDeclarations()).toBe("uniform float gain;");
      expect(engine.getCustomUniformInfo()).toEqual([{ name: "gain", type: "float" }]);
    });

    it("packs iDate and GLSL-compatible channel resolutions per pass", () => {
      const engine = new WebGPURenderingEngine(assets);
      stubDeviceAndContext(engine);
      const textureHandle = { width: 640, height: 360, view: {}, sampler: {} };
      (engine as any).resourceManager = {
        getImageTextureCache: () => ({ "/tex.png": textureHandle }),
        getDefaultTexture: () => textureHandle,
        getAudioTexture: () => textureHandle,
        getAudioState: () => null,
        getAudioSampleRate: () => 44100,
        updateAudioTextures: vi.fn(),
        updateKeyboardTexture: vi.fn(),
        getKeyboardTexture: () => textureHandle,
      };
      vi.spyOn(engine.getTimeManager(), "getCurrentDate").mockReturnValue(
        Float32Array.from([2026, 7, 19, 12345]),
      );
      const imagePipeline = renderablePipeline({
        getCurrentOutputView: () => null,
        getPreviousOutputView: () => null,
      });
      (engine as any).passGraph = [{
        name: "Image",
        width: 320,
        height: 180,
        output: "canvas",
        channels: [
          { kind: "texture", slot: 0, key: "iChannel0", path: "/tex.png" },
          { kind: "audio", slot: 1, key: "iChannel1", path: "/audio.wav" },
          { kind: "keyboard", slot: 3, key: "iChannel3" },
        ],
      }];
      (engine as any).passPipelines = new Map([["Image", imagePipeline]]);

      engine.render(1000);

      const write = (engine as any).device.queue.writeBuffer.mock.calls.at(-1)![2] as ArrayBuffer;
      const view = new DataView(write);
      expect(view.getFloat32(UNIFORM_OFFSETS.iDate, true)).toBe(2026);
      expect(view.getFloat32(UNIFORM_OFFSETS.iChannelResolution, true)).toBe(640);
      expect(view.getFloat32(UNIFORM_OFFSETS.iChannelResolution + 4, true)).toBe(360);
      expect(view.getFloat32(UNIFORM_OFFSETS.iChannelResolution + 16, true)).toBe(512);
      expect(view.getFloat32(UNIFORM_OFFSETS.iChannelResolution + 16 + 4, true)).toBe(2);
      expect(view.getFloat32(UNIFORM_OFFSETS.iChannelResolution + 48, true)).toBe(256);
      expect(view.getFloat32(UNIFORM_OFFSETS.iChannelResolution + 48 + 4, true)).toBe(3);
    });

    it("uses the selected buffer pass resources, resolution, and channel uniforms for capture", () => {
      const engine = new WebGPURenderingEngine(assets);
      stubEngineInternals(engine);
      const bufferHandle = { width: 64, height: 32, view: { label: "buffer-input" }, sampler: {} };
      const imageHandle = { width: 256, height: 128, view: { label: "image-input" }, sampler: {} };
      (engine as any).resourceManager = {
        getImageTextureCache: () => ({
          "/buffer.png": bufferHandle,
          "/image.png": imageHandle,
        }),
        getDefaultTexture: () => imageHandle,
        getAudioSampleRate: () => 44100,
      };
      (engine as any).passGraph = [
        {
          name: "BufferA",
          width: 160,
          height: 90,
          output: "texture",
          source: "buffer-source",
          channels: [{ kind: "texture", slot: 0, key: "iChannel0", path: "/buffer.png" }],
        },
        {
          name: "Image",
          width: 320,
          height: 180,
          output: "canvas",
          source: "image-source",
          channels: [{ kind: "texture", slot: 0, key: "iChannel0", path: "/image.png" }],
        },
      ];
      (engine as any).lastCompile = {
        code: 'image-source',
        path: '/image.slang',
        buffers: { BufferA: 'buffer-source', common: 'import palette;\nfloat helper() { return 1; }' },
        slangModules: [
          { moduleName: 'tone_map', path: '/tone-map.slang', source: 'module tone_map;', ownerPass: 'BufferA' },
          { moduleName: 'palette', path: '/palette.slang', source: 'module palette;', ownerPass: 'BufferA' },
          { moduleName: 'image_only', path: '/image-only.slang', source: 'module image_only;', ownerPass: 'Image' },
        ],
      };

      const capturer = engine.createVariableCapturer();
      const context = engine.getVariableCaptureCompileContext(undefined, "BufferA", "/palette.slang");
      capturer.setCompileContext(context);

      expect(context).toMatchObject({
        slangPassName: "BufferA",
        slangChannels: [{ slot: 0, key: "iChannel0", kind: "texture" }],
        slangSourcePath: '/palette.slang',
        slangModules: [{ moduleName: 'tone_map', path: '/tone-map.slang', source: 'module tone_map;' }],
      });
      expect(context.commonCode).toBe('\nfloat helper() { return 1; }');
      expect(engine.getVariableCaptureCompileContext(undefined, "BufferA", "/tone-map.slang").slangModules)
        .toEqual([]);
      expect((capturer as any).getChannelResources(context)).toEqual([
        expect.objectContaining({ slot: 0, textureView: bufferHandle.view }),
      ]);
      const captureUniforms = engine.getCaptureUniforms();
      expect(captureUniforms.res).toEqual([160, 90, 1]);
      expect(captureUniforms.channelResolution?.slice(0, 3)).toEqual([64, 32, 1]);
    });
  });

  describe("video input parity", () => {
    const videoConfig: ShaderConfig = {
      version: "1",
      passes: {
        Image: {
          inputs: {
            iChannel0: {
              type: "video",
              path: "clip.mp4",
              resolved_path: "vscode-webview://clip.mp4",
              filter: "nearest",
              wrap: "repeat",
              vflip: false,
            },
          },
        },
      },
    };

    it("loads video inputs as sampled channels during compile", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { compiler } = stubEngineInternals(engine);
      const loadVideoTexture = vi.fn(async () => ({ texture: {}, warning: undefined }));
      (engine as any).resourceManager = { loadVideoTexture };

      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(0); }",
        videoConfig,
        "/image.slang",
      );

      expect(result?.success).toBe(true);
      expect((result?.warnings ?? []).join("\n")).not.toContain("unsupported Slang/WebGPU input type");
      expect(loadVideoTexture).toHaveBeenCalledWith("vscode-webview://clip.mp4", {
        filter: "nearest",
        wrap: "repeat",
        vflip: false,
      });
      expect(compiler.compile).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          channels: [{ slot: 0, key: "iChannel0", kind: "video" }],
        }),
      );
      expect(engine.getPasses()[0].channels[0]).toEqual(expect.objectContaining({
        kind: "video",
        slot: 0,
        key: "iChannel0",
        path: "vscode-webview://clip.mp4",
      }));
    });

    it("binds the loaded video texture and sampler when rendering", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { device } = stubEngineInternals(engine);
      const videoHandle = {
        view: { label: "video-view" },
        sampler: { label: "video-sampler" },
      };
      const resourceManager = {
        loadVideoTexture: vi.fn(async () => ({ texture: videoHandle, warning: undefined })),
        getVideoTexture: vi.fn(() => videoHandle),
        getDefaultTexture: vi.fn(() => null),
      };
      (engine as any).resourceManager = resourceManager;

      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(0); }",
        videoConfig,
        "/image.slang",
      );
      expect(result?.success).toBe(true);
      device.createBindGroup.mockClear();

      engine.render(1000);

      expect(resourceManager.getVideoTexture).toHaveBeenCalledWith("vscode-webview://clip.mp4");
      expect(device.createBindGroup).toHaveBeenCalledTimes(1);
      expect(device.createBindGroup.mock.calls[0][0].entries).toEqual([
        { binding: 0, resource: { buffer: expect.anything() } },
        { binding: 1, resource: videoHandle.view },
        { binding: 2, resource: videoHandle.sampler },
      ]);
    });

    it("propagates video loading warnings from the resource manager", async () => {
      const engine = new WebGPURenderingEngine(assets);
      stubEngineInternals(engine);
      const warning = "Video is not loading: vscode-webview://clip.mp4";
      (engine as any).resourceManager = {
        loadVideoTexture: vi.fn(async () => ({ texture: null, warning })),
      };

      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(0); }",
        videoConfig,
        "/image.slang",
      );

      expect(result?.success).toBe(true);
      expect(result?.warnings).toContain(warning);
    });

    it("falls back to the default texture when a video texture cache lookup misses", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { device } = stubEngineInternals(engine);
      const defaultHandle = {
        view: { label: "default-view" },
        sampler: { label: "default-sampler" },
      };
      const resourceManager = {
        loadVideoTexture: vi.fn(async () => ({ texture: defaultHandle, warning: "video warning" })),
        getVideoTexture: vi.fn(() => null),
        getDefaultTexture: vi.fn(() => defaultHandle),
      };
      (engine as any).resourceManager = resourceManager;

      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(0); }",
        videoConfig,
        "/image.slang",
      );
      expect(result?.success).toBe(true);
      device.createBindGroup.mockClear();

      engine.render(1000);

      expect(resourceManager.getDefaultTexture).toHaveBeenCalled();
      expect(device.createBindGroup.mock.calls[0][0].entries).toEqual([
        { binding: 0, resource: { buffer: expect.anything() } },
        { binding: 1, resource: defaultHandle.view },
        { binding: 2, resource: defaultHandle.sampler },
      ]);
    });

    it("delegates video controls and state to the resource manager", () => {
      const engine = new WebGPURenderingEngine(assets);
      const state = { paused: false, muted: true, currentTime: 12, duration: 60 };
      const resourceManager = {
        controlVideo: vi.fn(),
        getVideoState: vi.fn(() => state),
      };
      (engine as any).resourceManager = resourceManager;

      engine.controlVideo("clip.mp4", "pause");
      const result = engine.getVideoState("clip.mp4");

      expect(resourceManager.controlVideo).toHaveBeenCalledWith("clip.mp4", "pause");
      expect(resourceManager.getVideoState).toHaveBeenCalledWith("clip.mp4");
      expect(result).toBe(state);
    });

    it("passes channel muted to loadVideoTexture", async () => {
      const engine = new WebGPURenderingEngine(assets);
      stubEngineInternals(engine);
      const mutedVideoConfig: ShaderConfig = {
        version: "1",
        passes: {
          Image: {
            inputs: {
              iChannel0: {
                type: "video",
                path: "clip.mp4",
                resolved_path: "vscode-webview://clip.mp4",
                filter: "nearest",
                wrap: "repeat",
                vflip: false,
                muted: true,
              },
            },
          },
        },
      };
      const loadVideoTexture = vi.fn(async () => ({ texture: {}, warning: undefined }));
      (engine as any).resourceManager = { loadVideoTexture };

      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(0); }",
        mutedVideoConfig,
        "/image.slang",
      );

      expect(result?.success).toBe(true);
      expect(loadVideoTexture).toHaveBeenCalledWith(
        "vscode-webview://clip.mp4",
        expect.objectContaining({ muted: true }),
      );
    });

    it("setGlobalVolume delegates to resourceManager.setGlobalAudioState", () => {
      const engine = new WebGPURenderingEngine(assets);
      const setGlobalAudioState = vi.fn();
      (engine as any).resourceManager = { setGlobalAudioState };

      engine.setGlobalVolume(0.5, true);

      expect(setGlobalAudioState).toHaveBeenCalledWith(0.5, true);
    });

    it("setGlobalVolume is a no-op when no resource manager is attached", () => {
      const engine = new WebGPURenderingEngine(assets);
      (engine as any).resourceManager = null;

      expect(() => engine.setGlobalVolume(0.5, true)).not.toThrow();
    });
  });

  describe("audio input parity", () => {
    const audioConfig: ShaderConfig = {
      version: "1",
      passes: {
        Image: {
          inputs: {
            iChannel1: {
              type: "audio",
              path: "test.wav",
              resolved_path: "/audio/test.wav",
              muted: true,
              startTime: 0.5,
              endTime: 2.5,
            },
          },
        },
      },
    };

    it("delegates public audio controls and queries", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const state = { paused: false, muted: true, currentTime: 1.5, duration: 3 };
      const fft = new Uint8Array([1, 2, 3]);
      const resourceManager = {
        resumeAudioContext: vi.fn(async () => undefined),
        resumeAllAudio: vi.fn(),
        updateAudioLoopRegion: vi.fn(),
        controlAudio: vi.fn(),
        getAudioState: vi.fn(() => state),
        seekAudio: vi.fn(),
        getAudioFFTData: vi.fn(() => fft),
      };
      (engine as any).resourceManager = resourceManager;

      await engine.resumeAudioContext();
      engine.resumeAllAudio();
      engine.updateAudioLoopRegion("music.wav", 0.25, 2.75);
      engine.controlAudio("music.wav", "play");
      const actualState = engine.getAudioState("music.wav");
      engine.seekAudio("music.wav", 1.25);

      expect(resourceManager.resumeAudioContext).toHaveBeenCalledTimes(1);
      expect(resourceManager.resumeAllAudio).toHaveBeenCalledTimes(1);
      expect(resourceManager.updateAudioLoopRegion).toHaveBeenCalledWith("music.wav", 0.25, 2.75);
      expect(resourceManager.controlAudio).toHaveBeenCalledWith("music.wav", "play");
      expect(resourceManager.getAudioState).toHaveBeenCalledWith("music.wav");
      expect(actualState).toBe(state);
      expect(resourceManager.seekAudio).toHaveBeenCalledWith("music.wav", 1.25);
      expect(engine.getAudioFFTData("audio", "music.wav")).toBe(fft);
      expect(resourceManager.getAudioFFTData).toHaveBeenCalledWith("music.wav");
      expect(engine.getAudioFFTData("video", "music.wav")).toBeNull();
      expect(engine.getAudioFFTData("audio")).toBeNull();
    });

    it("loads audio with playback options and updates its loop without autoplaying", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { compiler } = stubEngineInternals(engine);
      const resourceManager = {
        loadAudioSource: vi.fn(async () => ({})),
        updateAudioLoopRegion: vi.fn(),
        controlAudio: vi.fn(),
      };
      (engine as any).resourceManager = resourceManager;

      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return sampleIChannel1(float2(c.x, 0.25)); }",
        audioConfig,
        "/image.slang",
      );

      expect(result?.success).toBe(true);
      expect(resourceManager.loadAudioSource).toHaveBeenCalledWith("/audio/test.wav", {
        muted: true,
        startTime: 0.5,
        endTime: 2.5,
      });
      expect(resourceManager.updateAudioLoopRegion).toHaveBeenCalledWith(
        "/audio/test.wav", 0.5, 2.5,
      );
      expect(resourceManager.controlAudio).not.toHaveBeenCalled();
      expect(compiler.compile).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          channels: [{ slot: 0, key: "iChannel1", kind: "audio" }],
        }),
      );
    });

    it("keeps shader compilation successful when audio loading fails", async () => {
      const engine = new WebGPURenderingEngine(assets);
      stubEngineInternals(engine);
      (engine as any).resourceManager = {
        loadAudioSource: vi.fn(async () => {
          throw new Error("decode failed");
        }),
        updateAudioLoopRegion: vi.fn(),
      };

      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return sampleIChannel1(float2(c.x, 0.25)); }",
        audioConfig,
        "/image.slang",
      );

      expect(result?.success).toBe(true);
      expect(result?.warnings).toContain("Audio loading failed: /audio/test.wav");
      expect((engine as any).resourceManager.updateAudioLoopRegion).not.toHaveBeenCalled();
    });

    it("updates and binds the audio texture with its timing uniforms", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { device } = stubEngineInternals(engine);
      const audioHandle = {
        view: { label: "audio-view" },
        sampler: { label: "audio-sampler" },
      };
      const resourceManager = {
        loadAudioSource: vi.fn(async () => audioHandle),
        updateAudioLoopRegion: vi.fn(),
        updateAudioTextures: vi.fn(),
        getAudioTexture: vi.fn(() => audioHandle),
        getAudioState: vi.fn(() => ({
          paused: false, muted: true, currentTime: 1.75, duration: 3,
        })),
        getAudioSampleRate: vi.fn(() => 48000),
        getDefaultTexture: vi.fn(() => null),
        updateKeyboardTexture: vi.fn(),
        getKeyboardTexture: vi.fn(() => null),
      };
      (engine as any).resourceManager = resourceManager;

      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return sampleIChannel1(float2(c.x, 0.25)); }",
        audioConfig,
        "/image.slang",
      );
      expect(result?.success).toBe(true);
      device.createBindGroup.mockClear();
      device.queue.writeBuffer.mockClear();

      engine.render(1000);

      expect(resourceManager.updateAudioTextures).toHaveBeenCalledTimes(1);
      expect(resourceManager.getAudioTexture).toHaveBeenCalledWith("/audio/test.wav");
      expect(device.createBindGroup.mock.calls[0][0].entries).toEqual([
        { binding: 0, resource: { buffer: expect.anything() } },
        { binding: 1, resource: audioHandle.view },
        { binding: 2, resource: audioHandle.sampler },
      ]);
      const packed = device.queue.writeBuffer.mock.calls.at(-1)![2] as ArrayBuffer;
      const uniforms = new DataView(packed);
      expect(uniforms.getFloat32(UNIFORM_OFFSETS.iChannelTime, true)).toBeCloseTo(1.75);
      expect(uniforms.getFloat32(UNIFORM_OFFSETS.iChannelLoaded, true)).toBe(1);
      expect(uniforms.getFloat32(UNIFORM_OFFSETS.iSampleRate, true)).toBe(48000);
    });

    it("binds the default texture and reports unloaded when audio is missing", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { device } = stubEngineInternals(engine);
      const defaultHandle = {
        view: { label: "default-view" },
        sampler: { label: "default-sampler" },
      };
      const resourceManager = {
        loadAudioSource: vi.fn(async () => defaultHandle),
        updateAudioLoopRegion: vi.fn(),
        updateAudioTextures: vi.fn(),
        getAudioTexture: vi.fn(() => null),
        getAudioState: vi.fn(() => null),
        getAudioSampleRate: vi.fn(() => 0),
        getDefaultTexture: vi.fn(() => defaultHandle),
        updateKeyboardTexture: vi.fn(),
        getKeyboardTexture: vi.fn(() => null),
      };
      (engine as any).resourceManager = resourceManager;

      await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return sampleIChannel1(float2(c.x, 0.25)); }",
        audioConfig,
        "/image.slang",
      );
      device.createBindGroup.mockClear();
      device.queue.writeBuffer.mockClear();

      engine.render(1000);

      expect(device.createBindGroup.mock.calls[0][0].entries).toContainEqual({
        binding: 1, resource: defaultHandle.view,
      });
      const packed = device.queue.writeBuffer.mock.calls.at(-1)![2] as ArrayBuffer;
      const uniforms = new DataView(packed);
      expect(uniforms.getFloat32(UNIFORM_OFFSETS.iChannelTime + 4, true)).toBe(0);
      expect(uniforms.getFloat32(UNIFORM_OFFSETS.iChannelLoaded + 4, true)).toBe(0);
      expect(uniforms.getFloat32(UNIFORM_OFFSETS.iSampleRate, true)).toBe(44100);
    });
  });

  describe("video sync on compilation", () => {
    // WebGL parity (RenderingEngine.test.ts "video sync on compilation"):
    // newly loaded video textures must not sit frozen on their first frame —
    // a successful compile should sync them to the current shader time and
    // start/hold playback based on pause state.
    it("should sync and resume videos on successful compilation when not paused", async () => {
      const engine = new WebGPURenderingEngine(assets);
      stubEngineInternals(engine);
      const resourceManager = {
        syncAllVideosToTime: vi.fn(),
        pauseAllVideos: vi.fn(),
        resumeAllVideos: vi.fn(),
      };
      (engine as any).resourceManager = resourceManager;
      (engine as any).timeManager = {
        getCurrentTime: vi.fn().mockReturnValue(7.5),
        isPaused: vi.fn().mockReturnValue(false),
      };

      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(0); }",
        null,
        "/image.slang",
      );

      expect(result?.success).toBe(true);
      expect(resourceManager.syncAllVideosToTime).toHaveBeenCalledWith(7.5);
      expect(resourceManager.resumeAllVideos).toHaveBeenCalled();
      expect(resourceManager.pauseAllVideos).not.toHaveBeenCalled();
    });

    it("should sync and pause videos on successful compilation when paused", async () => {
      const engine = new WebGPURenderingEngine(assets);
      stubEngineInternals(engine);
      const resourceManager = {
        syncAllVideosToTime: vi.fn(),
        pauseAllVideos: vi.fn(),
        resumeAllVideos: vi.fn(),
      };
      (engine as any).resourceManager = resourceManager;
      (engine as any).timeManager = {
        getCurrentTime: vi.fn().mockReturnValue(3.0),
        isPaused: vi.fn().mockReturnValue(true),
      };

      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(0); }",
        null,
        "/image.slang",
      );

      expect(result?.success).toBe(true);
      expect(resourceManager.syncAllVideosToTime).toHaveBeenCalledWith(3.0);
      expect(resourceManager.pauseAllVideos).toHaveBeenCalled();
      expect(resourceManager.resumeAllVideos).not.toHaveBeenCalled();
    });

    it("should leave videos untouched on failed compilation", async () => {
      const engine = new WebGPURenderingEngine(assets);
      stubEngineInternals(engine);
      const resourceManager = {
        syncAllVideosToTime: vi.fn(),
        pauseAllVideos: vi.fn(),
        resumeAllVideos: vi.fn(),
      };
      (engine as any).resourceManager = resourceManager;
      (engine as any).timeManager = {
        getCurrentTime: vi.fn().mockReturnValue(0),
        isPaused: vi.fn().mockReturnValue(false),
      };
      (engine as any).compiler = { compile: vi.fn(() => ({ success: false, errors: ["bad"] })), dispose: vi.fn() };

      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(0); }",
        null,
        "/image.slang",
      );

      expect(result?.success).toBe(false);
      expect(resourceManager.syncAllVideosToTime).not.toHaveBeenCalled();
      expect(resourceManager.pauseAllVideos).not.toHaveBeenCalled();
      expect(resourceManager.resumeAllVideos).not.toHaveBeenCalled();
    });

    it("treats reused-manager media failures as post-publication warnings", async () => {
      const engine = new WebGPURenderingEngine(assets);
      stubEngineInternals(engine);
      const resourceManager = {
        syncAllVideosToTime: vi.fn(() => {
          throw new Error("installed media sync failed");
        }),
        pauseAllVideos: vi.fn(),
        resumeAllVideos: vi.fn(),
      };
      (engine as any).resourceManager = resourceManager;

      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(0); }",
        null,
        "/image.slang",
      );

      expect(result?.success).toBe(true);
      expect(result?.warnings?.join("\n")).toMatch(/installed media sync failed/i);
      expect(resourceManager.resumeAllVideos).toHaveBeenCalledTimes(1);
      expect(engine.getPasses().map(({ name }) => name)).toEqual(["Image"]);
    });
  });

  describe("cubemap input parity", () => {
    const cubemapConfig: ShaderConfig = {
      version: "1",
      passes: {
        Image: {
          inputs: {
            iChannel0: {
              type: "cubemap",
              path: "sky-cross.png",
              resolved_path: "vscode-webview://sky-cross.png",
              filter: "mipmap",
              wrap: "clamp",
              vflip: true,
            },
          },
        },
      },
    };

    it("loads cubemap inputs as cube sampled channels during compile", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { compiler } = stubEngineInternals(engine);
      const loadCubemapTexture = vi.fn(async () => ({}));
      (engine as any).resourceManager = { loadCubemapTexture };

      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(0); }",
        cubemapConfig,
        "/image.slang",
      );

      expect(result?.success).toBe(true);
      expect((result?.warnings ?? []).join("\n")).not.toContain("unsupported Slang/WebGPU input type");
      expect(loadCubemapTexture).toHaveBeenCalledWith("vscode-webview://sky-cross.png", {
        filter: "mipmap",
        wrap: "clamp",
        vflip: true,
      });
      expect(compiler.compile).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          channels: [{ slot: 0, key: "iChannel0", kind: "cubemap" }],
        }),
      );
      expect(engine.getPasses()[0].channels[0]).toEqual(expect.objectContaining({
        kind: "cubemap",
        slot: 0,
        key: "iChannel0",
        path: "vscode-webview://sky-cross.png",
      }));
    });

    it("binds the loaded cubemap texture and sampler when rendering", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { device } = stubEngineInternals(engine);
      const cubemapHandle = {
        view: { label: "cube-view" },
        sampler: { label: "cube-sampler" },
      };
      const resourceManager = {
        loadCubemapTexture: vi.fn(async () => cubemapHandle),
        getCubemapTexture: vi.fn(() => cubemapHandle),
        getDefaultTexture: vi.fn(() => null),
      };
      (engine as any).resourceManager = resourceManager;

      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(0); }",
        cubemapConfig,
        "/image.slang",
      );
      expect(result?.success).toBe(true);
      device.createBindGroup.mockClear();

      engine.render(1000);

      expect(resourceManager.getCubemapTexture).toHaveBeenCalledWith("vscode-webview://sky-cross.png");
      expect(device.createBindGroup).toHaveBeenCalledTimes(1);
      expect(device.createBindGroup.mock.calls[0][0].entries).toEqual([
        { binding: 0, resource: { buffer: expect.anything() } },
        { binding: 1, resource: cubemapHandle.view },
        { binding: 2, resource: cubemapHandle.sampler },
      ]);
    });

    it("skips the pass instead of binding a 2D default texture when a cubemap cache lookup misses", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { device } = stubEngineInternals(engine);
      const defaultHandle = {
        view: { label: "default-view" },
        sampler: { label: "default-sampler" },
      };
      const resourceManager = {
        loadCubemapTexture: vi.fn(async () => null),
        getCubemapTexture: vi.fn(() => null),
        getDefaultTexture: vi.fn(() => defaultHandle),
      };
      (engine as any).resourceManager = resourceManager;

      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(0); }",
        cubemapConfig,
        "/image.slang",
      );
      expect(result?.success).toBe(true);
      device.createBindGroup.mockClear();

      engine.render(1000);

      expect(resourceManager.getDefaultTexture).not.toHaveBeenCalled();
      expect(device.createBindGroup).not.toHaveBeenCalled();
    });
  });

  describe("handleCanvasResize", () => {
    async function compiledEngine() {
      const engine = new WebGPURenderingEngine(assets);
      const { device, canvas } = stubEngineInternals(engine);

      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(0); }",
        {
          version: "1",
          passes: {
            Image: { inputs: {} },
            BufferA: { path: "buffer-a.slang", inputs: {}, resolution: { scale: 0.5 } },
            BufferB: { path: "buffer-b.slang", inputs: {}, resolution: { width: 256, height: 128 } },
          },
        },
        "/image.slang",
        {
          BufferA: "float4 mainImage(float2 c) { return float4(1); }",
          BufferB: "float4 mainImage(float2 c) { return float4(2); }",
        },
      );
      expect(result?.success).toBe(true);
      return { engine, device, canvas };
    }

    it("creates buffer textures using each buffer pass resolution at compile time", async () => {
      const { device } = await compiledEngine();

      // Compile created 2 ping-pong textures each for BufferA then BufferB.
      expect(device.createTexture).toHaveBeenCalledTimes(4);
      expect(device.createTexture.mock.calls.map((call) => call[0].size)).toEqual([
        { width: 160, height: 90 },
        { width: 160, height: 90 },
        { width: 256, height: 128 },
        { width: 256, height: 128 },
      ]);
    });

    it("recomputes per-pass resolutions so the next render packs the new sizes", async () => {
      const { engine, device, canvas } = await compiledEngine();

      engine.handleCanvasResize(640, 360);
      engine.render(1000);

      expect(canvas.width).toBe(640);
      expect(canvas.height).toBe(360);
      const writeBuffer = device.queue.writeBuffer;
      expect(writeBuffer).toHaveBeenCalledTimes(3);
      const resolutions = writeBuffer.mock.calls.map((call) =>
        Array.from(new Float32Array(call[2] as ArrayBuffer, 0, 2)));
      // BufferA (scale 0.5) tracks the canvas; BufferB is fixed; Image is the canvas.
      expect(resolutions).toEqual([
        [320, 180],
        [256, 128],
        [640, 360],
      ]);
    });

    it("uses the resized canvas size for Image when Image resolution scale is already applied by the UI", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { device, canvas } = stubEngineInternals(engine);

      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(0); }",
        {
          version: "1",
          passes: {
            Image: { inputs: {}, resolution: { scale: 0.5 } },
          },
        },
        "/image.slang",
      );
      expect(result?.success).toBe(true);

      engine.handleCanvasResize(160, 90);
      device.queue.writeBuffer.mockClear();
      engine.render(1000);

      expect(canvas.width).toBe(160);
      expect(canvas.height).toBe(90);
      const writeBuffer = device.queue.writeBuffer;
      expect(writeBuffer).toHaveBeenCalledTimes(1);
      const resolution = Array.from(new Float32Array(writeBuffer.mock.calls[0][2] as ArrayBuffer, 0, 2));
      expect(resolution).toEqual([160, 90]);
    });

    it("recreates scaled buffer textures at the new size and destroys the old ones", async () => {
      const { engine, device } = await compiledEngine();
      // Compile created 2 ping-pong textures each for BufferA then BufferB.
      expect(device.createTexture).toHaveBeenCalledTimes(4);
      const bufferATextures = device.createTexture.mock.results.slice(0, 2).map((r) => r.value);
      const bufferBTextures = device.createTexture.mock.results.slice(2, 4).map((r) => r.value);

      engine.handleCanvasResize(640, 360);

      // BufferA (scale 0.5) went 160x90 -> 320x180: two new textures, old destroyed.
      expect(device.createTexture).toHaveBeenCalledTimes(6);
      for (const call of device.createTexture.mock.calls.slice(4)) {
        expect(call[0].size).toEqual({ width: 320, height: 180 });
      }
      for (const texture of bufferATextures) {
        expect(texture.destroy).toHaveBeenCalledTimes(1);
      }
      // BufferB has a fixed resolution: its textures are untouched.
      for (const texture of bufferBTextures) {
        expect(texture.destroy).not.toHaveBeenCalled();
      }
    });

    it("batches all resized buffer migrations into one command submission", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { device } = stubEngineInternals(engine);
      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(0); }",
        {
          version: "1",
          passes: {
            Image: { inputs: {} },
            BufferA: { path: "buffer-a.slang", inputs: {}, resolution: { scale: 0.5 } },
            BufferB: { path: "buffer-b.slang", inputs: {}, resolution: { scale: 0.25 } },
          },
        },
        "/image.slang",
        {
          BufferA: "float4 mainImage(float2 c) { return float4(1); }",
          BufferB: "float4 mainImage(float2 c) { return float4(2); }",
        },
      );
      expect(result?.success).toBe(true);
      const oldTextures = device.createTexture.mock.results.map((entry) => entry.value);
      device.createCommandEncoder.mockClear();
      device.queue.submit.mockClear();

      engine.handleCanvasResize(640, 360);

      expect(device.createCommandEncoder).toHaveBeenCalledTimes(1);
      const encoder = device.createCommandEncoder.mock.results[0].value;
      expect(encoder.copyTextureToTexture).toHaveBeenCalledTimes(4);
      expect(device.queue.submit).toHaveBeenCalledTimes(1);
      expect(device.queue.submit).toHaveBeenCalledWith([encoder.finish.mock.results[0].value]);
      for (const texture of oldTextures) {
        expect(texture.destroy).toHaveBeenCalledTimes(1);
      }
    });

    it("redraws Image immediately after resize while running without advancing feedback again", async () => {
      const { engine, device } = await compiledEngine();
      (engine as any).running = true;
      const pipelines = (engine as any).passPipelines as Map<string, SlangPassPipeline>;
      const swap = vi.spyOn(pipelines.get("BufferA")!, "swap");
      device.createCommandEncoder.mockClear();
      device.queue.submit.mockClear();

      engine.handleCanvasResize(640, 360);

      expect(device.createCommandEncoder).toHaveBeenCalledTimes(2);
      const migrationEncoder = device.createCommandEncoder.mock.results[0].value;
      const redrawEncoder = device.createCommandEncoder.mock.results[1].value;
      expect(migrationEncoder.copyTextureToTexture).toHaveBeenCalledTimes(2);
      expect(redrawEncoder.beginRenderPass).toHaveBeenCalledTimes(1);
      expect(device.queue.submit).toHaveBeenCalledTimes(2);
      expect(swap).not.toHaveBeenCalled();
    });

    it("recreates the Image mesh depth texture to match the resized canvas", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { device } = stubEngineInternals(engine);
      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(0); }",
        { version: "1", passes: { Image: { inputs: {}, geometry: { type: "sphere" } } } },
        "/image.slang",
      );
      expect(result?.success).toBe(true);

      const initialDepthTexture = device.createTexture.mock.results[0].value;
      engine.handleCanvasResize(640, 360);

      expect(device.createTexture).toHaveBeenCalledTimes(2);
      expect(device.createTexture.mock.calls[1][0]).toMatchObject({
        size: { width: 640, height: 360 },
        format: "depth24plus",
      });
      expect(initialDepthTexture.destroy).toHaveBeenCalledTimes(1);
    });

    it("does nothing to passes when the size is unchanged", async () => {
      const { engine, device } = await compiledEngine();

      engine.handleCanvasResize(320, 180);

      expect(device.createTexture).toHaveBeenCalledTimes(4);
      for (const result of device.createTexture.mock.results) {
        expect(result.value.destroy).not.toHaveBeenCalled();
      }
    });

    it("clamps oversized canvas and scaled pass resolutions to the device 2D texture limit", async () => {
      const { engine, device, canvas } = await compiledEngine();
      (device as any).limits = { maxTextureDimension2D: 8192 };

      engine.handleCanvasResize(6448, 10192);
      engine.render(1000);

      expect(canvas.width).toBe(6448);
      expect(canvas.height).toBe(8192);
      const writeBuffer = device.queue.writeBuffer;
      expect(writeBuffer).toHaveBeenCalledTimes(3);
      const resolutions = writeBuffer.mock.calls.map((call) =>
        Array.from(new Float32Array(call[2] as ArrayBuffer, 0, 2)));
      expect(resolutions).toEqual([
        [3224, 4096],
        [256, 128],
        [6448, 8192],
      ]);
      for (const call of device.createTexture.mock.calls.slice(4)) {
        expect(call[0].size.width).toBeLessThanOrEqual(8192);
        expect(call[0].size.height).toBeLessThanOrEqual(8192);
      }
    });

    it("is a safe no-op before any compile", () => {
      const engine = new WebGPURenderingEngine(assets);
      (engine as any).canvas = { width: 320, height: 180 };
      expect(() => engine.handleCanvasResize(640, 360)).not.toThrow();
      expect((engine as any).canvas.width).toBe(640);
    });
  });

  describe("frame pacing and frame times", () => {
    async function compiledEngine() {
      const engine = new WebGPURenderingEngine(assets);
      const { device } = stubEngineInternals(engine);
      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(0); }",
        { version: "1", passes: { Image: { inputs: {} } } },
        "/image.slang",
        {},
      );
      expect(result?.success).toBe(true);
      vi.mocked(device.queue.submit).mockClear();
      return { engine, device };
    }

    it("skips renders when the FPS limit interval has not elapsed", async () => {
      const { engine, device } = await compiledEngine();
      engine.setFPSLimit(30);

      engine.render(1000);
      engine.render(1010);

      expect(device.queue.submit).toHaveBeenCalledTimes(1);
      expect(engine.getTimeManager().getFrame()).toBe(1);
    });

    it("renders every frame when the FPS limit is disabled", async () => {
      const { engine, device } = await compiledEngine();
      engine.setFPSLimit(30);

      engine.render(1000);
      engine.setFPSLimit(0);
      engine.render(1010);

      expect(device.queue.submit).toHaveBeenCalledTimes(2);
      expect(engine.getTimeManager().getFrame()).toBe(2);
    });

    it("records chronological frame times for rendered frames only", async () => {
      const { engine } = await compiledEngine();
      engine.setFPSLimit(30);

      engine.render(1000);
      engine.render(1010);
      engine.render(1034);
      engine.render(1068);

      expect(engine.getFrameTimeHistory()).toEqual([34, 34]);
      expect(engine.getFrameTimeCount()).toBe(2);
    });

    it("renders the first frame with an FPS limit enabled (lastRenderedAt starts null)", async () => {
      const { engine, device } = await compiledEngine();
      engine.setFPSLimit(30);

      engine.render(5000);

      expect(device.queue.submit).toHaveBeenCalledTimes(1);
    });

    it("renders about half the frames with a 30fps limit on 60Hz input (drift-corrected)", async () => {
      const { engine, device } = await compiledEngine();
      engine.setFPSLimit(30);

      const frames = 120;
      for (let i = 0; i < frames; i++) {
        engine.render(1000 + i * (1000 / 60));
      }

      const rendered = vi.mocked(device.queue.submit).mock.calls.length;
      expect(rendered).toBeGreaterThanOrEqual(frames / 2 - 2);
      expect(rendered).toBeLessThanOrEqual(frames / 2 + 2);
    });

    it("snaps to current time after a large gap instead of rapid-firing to catch up", async () => {
      const { engine, device } = await compiledEngine();
      engine.setFPSLimit(30);

      engine.render(1000);
      engine.render(11000); // tab backgrounded for 10s
      expect(device.queue.submit).toHaveBeenCalledTimes(2);

      // Immediately after the gap the interval applies again: too-soon
      // frames are still skipped rather than rapid-fired.
      engine.render(11005);
      engine.render(11010);
      expect(device.queue.submit).toHaveBeenCalledTimes(2);
    });

    it("applies an FPS limit change mid-stream", async () => {
      const { engine, device } = await compiledEngine();
      engine.setFPSLimit(30);

      engine.render(1000);
      engine.render(1010); // skipped at 30fps
      expect(device.queue.submit).toHaveBeenCalledTimes(1);

      engine.setFPSLimit(60);
      engine.render(1020); // 20ms since last rendered — allowed at 60fps
      expect(device.queue.submit).toHaveBeenCalledTimes(2);
    });

    it("ignores large frame deltas (>= 500ms, tab backgrounding) in the history", async () => {
      const { engine } = await compiledEngine();

      engine.render(1000);
      engine.render(1016);
      engine.render(2016); // 1000ms delta — ignored
      engine.render(2032);

      expect(engine.getFrameTimeHistory()).toEqual([16, 16]);
      expect(engine.getFrameTimeCount()).toBe(2);
    });

    it("resets the frame-time baseline while paused so unpausing records no spike", async () => {
      const { engine } = await compiledEngine();

      engine.render(1000);
      engine.render(1016);
      expect(engine.getFrameTimeCount()).toBe(1);

      engine.togglePause();
      engine.render(1032);

      engine.togglePause(); // unpause much later
      engine.render(9000);
      expect(engine.getFrameTimeCount()).toBe(1); // no 8s spike recorded

      engine.render(9016);
      expect(engine.getFrameTimeHistory()).toEqual([16, 16]);
    });

    it("caps the history at 3600 entries while the count keeps growing", async () => {
      const { engine } = await compiledEngine();

      const frames = 3700;
      for (let i = 0; i <= frames; i++) {
        engine.render(1000 + i * 16);
      }

      expect(engine.getFrameTimeHistory()).toHaveLength(3600);
      expect(engine.getFrameTimeCount()).toBe(frames);
    });
  });

  describe("render loop", () => {
    function rafStubbedEngine() {
      const { engine } = pausableEngine();
      const rafCallbacks: FrameRequestCallback[] = [];
      let nextRafId = 1;
      vi.stubGlobal("requestAnimationFrame", vi.fn((cb: FrameRequestCallback) => {
        rafCallbacks.push(cb);
        return nextRafId++;
      }));
      vi.stubGlobal("cancelAnimationFrame", vi.fn());
      const fireFrame = (time: number) => {
        const cb = rafCallbacks.shift();
        cb?.(time);
      };
      return { engine, fireFrame };
    }

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("renders on each animation frame once started", () => {
      const { engine, fireFrame } = rafStubbedEngine();
      const device = (engine as any).device;

      engine.startRenderLoop();
      fireFrame(1000);
      fireFrame(1016);

      expect(device.queue.submit).toHaveBeenCalledTimes(2);
    });

    it("does not start a second loop when already running", () => {
      const { engine } = rafStubbedEngine();

      engine.startRenderLoop();
      engine.startRenderLoop();

      expect(vi.mocked(requestAnimationFrame)).toHaveBeenCalledTimes(1);
    });

    it("stops rendering after stopRenderLoop", () => {
      const { engine, fireFrame } = rafStubbedEngine();
      const device = (engine as any).device;

      engine.startRenderLoop();
      fireFrame(1000);
      engine.stopRenderLoop();
      fireFrame(1016);

      expect(device.queue.submit).toHaveBeenCalledTimes(1);
      expect(vi.mocked(cancelAnimationFrame)).toHaveBeenCalled();
    });
  });

  describe("updateBufferAndRecompile", () => {
    const bufferConfig: ShaderConfig = {
      version: "1",
      passes: {
        Image: { inputs: { iChannel0: { type: "buffer", source: "BlurPass" } } },
        BlurPass: { path: "blur.slang", inputs: {} },
      },
    };

    async function compiledEngine() {
      const engine = new WebGPURenderingEngine(assets);
      const { device, compiler } = stubEngineInternals(engine);

      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(0); }",
        bufferConfig,
        "/image.slang",
        { BlurPass: "float4 mainImage(float2 c) { return float4(1); }" },
      );
      expect(result?.success).toBe(true);
      return { engine, device, compiler };
    }

    it("recompiles the pipeline with the patched buffer content and returns success", async () => {
      const { engine, compiler } = await compiledEngine();
      compiler.compile.mockClear();

      const result = await engine.updateBufferAndRecompile(
        "BlurPass",
        "float4 mainImage(float2 c) { return float4(9); }",
      );

      expect(result?.success).toBe(true);
      // Only BlurPass's content changed; the per-pass compile cache reuses
      // Image's unchanged pipeline instead of recompiling it.
      expect(compiler.compile).toHaveBeenCalledTimes(1);
      expect(compiler.compile).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining("float4(9)"),
        expect.objectContaining({ passName: "BlurPass" }),
      );
      expect(engine.getPasses().map((pass: { name: string }) => pass.name)).toEqual(["BlurPass", "Image"]);
    });

    it("keeps the previous pipelines when the recompile fails", async () => {
      const { engine, device, compiler } = await compiledEngine();
      const pipelinesBefore = new Map((engine as any).passPipelines as Map<string, unknown>);
      compiler.compile.mockReturnValue({ success: false, errors: ["syntax error"] });

      const result = await engine.updateBufferAndRecompile("BlurPass", "broken {");

      expect(result?.success).toBe(false);
      expect(result?.errors?.[0]).toMatch(/syntax error/);
      expect((engine as any).passPipelines).toEqual(pipelinesBefore);
      expect(engine.getPasses().map((pass: { name: string }) => pass.name)).toEqual(["BlurPass", "Image"]);
      expect(device.createCommandEncoder).not.toHaveBeenCalled();
      expect(device.queue.submit).not.toHaveBeenCalled();
    });

    it("discards the installed shader and clears the canvas when a different shader path fails", async () => {
      const { engine, device, compiler } = await compiledEngine();
      const installedPipelineMap = new Map(
        (engine as any).passPipelines as Map<string, SlangPassPipeline>,
      );
      const installedPipelines = [...installedPipelineMap.values()];
      const disposeSpies = installedPipelines.map((pipeline) => vi.spyOn(pipeline, "dispose"));
      const disposeResources = vi.fn();
      (engine as any).resourceManager = { dispose: disposeResources };
      const cleanupTime = vi.spyOn(engine.getTimeManager(), "cleanup");
      compiler.compile.mockReturnValue({ success: false, errors: ["syntax error"] });

      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { broken syntax }",
        bufferConfig,
        "/different.slang",
        { BlurPass: "broken {" },
      );

      expect(result?.success).toBe(false);
      expect(result?.errors?.[0]).toMatch(/syntax error/);
      expect(engine.getPasses()).toEqual([]);
      expect((engine as any).passPipelines.size).toBe(0);
      for (const dispose of disposeSpies) {
        expect(dispose).toHaveBeenCalledOnce();
      }
      expect(disposeResources).toHaveBeenCalledOnce();
      expect(cleanupTime).toHaveBeenCalledOnce();
      expect(device.createCommandEncoder).toHaveBeenCalledOnce();
      expect(device.queue.submit).toHaveBeenCalledOnce();
    });

    it("does not render after a different shader path fails", async () => {
      const { engine, device, compiler } = await compiledEngine();
      compiler.compile.mockReturnValue({ success: false, errors: ["syntax error"] });

      await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { broken syntax }",
        null,
        "/different.slang",
      );
      device.createCommandEncoder.mockClear();
      device.queue.submit.mockClear();

      engine.render(16);

      expect(device.createCommandEncoder).not.toHaveBeenCalled();
      expect(device.queue.submit).not.toHaveBeenCalled();
    });

    it("uses the updated content on subsequent updates too", async () => {
      const { engine, compiler } = await compiledEngine();

      await engine.updateBufferAndRecompile("BlurPass", "float4 mainImage(float2 c) { return float4(7); }");
      compiler.compile.mockClear();
      await engine.updateBufferAndRecompile("BlurPass", "float4 mainImage(float2 c) { return float4(8); }");

      expect(compiler.compile).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining("float4(8)"),
        expect.objectContaining({ passName: "BlurPass" }),
      );
    });

    it("handles an unknown buffer name by recompiling without error", async () => {
      const { engine } = await compiledEngine();

      // The pass graph ignores buffers that no configured pass references.
      const result = await engine.updateBufferAndRecompile("BufferZ", "float4 mainImage(float2 c) { return float4(0); }");

      expect(result?.success).toBe(true);
      expect(engine.getPasses().map((pass: { name: string }) => pass.name)).toEqual(["BlurPass", "Image"]);
    });

    it("returns a clear failure when no shader has been compiled yet", async () => {
      const engine = new WebGPURenderingEngine(assets);
      stubEngineInternals(engine);

      const result = await engine.updateBufferAndRecompile("BufferA", "float4 mainImage(float2 c) { return float4(0); }");

      expect(result?.success).toBe(false);
      expect(result?.errors?.[0]).toMatch(/compil/i);
    });
  });

  describe("shader file lifecycle", () => {
    const lifecycleConfig: ShaderConfig = {
      version: "1",
      passes: {
        Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA" } } },
        BufferA: { path: "buffer-a.slang", inputs: {} },
      },
    };
    const imageSource = "float4 mainImage(float2 c) { return float4(0); }";
    const bufferSource = "float4 mainImage(float2 c) { return float4(1); }";

    function lifecycleEngine() {
      const engine = new WebGPURenderingEngine(assets);
      const { device, compiler } = stubEngineInternals(engine);
      const resourceManager = {
        cleanup: vi.fn(),
        dispose: vi.fn(),
        syncAllVideosToTime: vi.fn(),
        pauseAllVideos: vi.fn(),
        resumeAllVideos: vi.fn(),
      };
      resourceManager.dispose = resourceManager.cleanup;
      (engine as any).resourceManager = resourceManager;
      return { engine, device, compiler, resourceManager };
    }

    it("resets time and cleans resources when a different shader file compiles", async () => {
      const { engine, resourceManager } = lifecycleEngine();
      await engine.compileShaderPipeline(imageSource, lifecycleConfig, "/first.slang", {
        BufferA: bufferSource,
      });
      engine.render(1000);
      engine.render(1016);
      expect(engine.getTimeManager().getFrame()).toBeGreaterThan(0);
      resourceManager.cleanup.mockClear();
      const syncSpy = vi.spyOn(ResourceManager.prototype, "syncAllVideosToTime");

      try {
        const result = await engine.compileShaderPipeline(
          "float4 mainImage(float2 c) { return float4(0, 1, 0, 1); }",
          lifecycleConfig,
          "/second.slang",
          { BufferA: "float4 mainImage(float2 c) { return float4(2); }" },
        );

        expect(result?.success).toBe(true);
        expect(engine.getTimeManager().getFrame()).toBe(0);
        expect(resourceManager.cleanup).toHaveBeenCalledTimes(1);
        expect(syncSpy).toHaveBeenCalledWith(0);
      } finally {
        syncSpy.mockRestore();
      }
    });

    it("replaces identical pipelines and buffer history when the shader path changes", async () => {
      const { engine } = lifecycleEngine();
      await engine.compileShaderPipeline(imageSource, lifecycleConfig, "/first.slang", {
        BufferA: bufferSource,
      });
      const firstPipelines = new Map(
        (engine as any).passPipelines as Map<string, SlangPassPipeline>,
      );
      const disposeSpies = new Map(
        [...firstPipelines].map(([name, pipeline]) => [name, vi.spyOn(pipeline, "dispose")]),
      );

      const result = await engine.compileShaderPipeline(imageSource, lifecycleConfig, "/second.slang", {
        BufferA: bufferSource,
      });

      expect(result?.success).toBe(true);
      const secondPipelines = (engine as any).passPipelines as Map<string, SlangPassPipeline>;
      for (const [name, firstPipeline] of firstPipelines) {
        expect(secondPipelines.get(name)).not.toBe(firstPipeline);
        expect(disposeSpies.get(name)).toHaveBeenCalledTimes(1);
      }
    });

    it("publishes successfully and continues retirement when an old render pipeline throws", async () => {
      const { engine, resourceManager } = lifecycleEngine();
      await engine.compileShaderPipeline(imageSource, lifecycleConfig, "/first.slang", {
        BufferA: bufferSource,
      });
      const predecessors = new Map(
        (engine as any).passPipelines as Map<string, SlangPassPipeline>,
      );
      const bufferDispose = vi.spyOn(predecessors.get("BufferA")!, "dispose")
        .mockImplementation(() => {
          throw new Error("old render disposal failed");
        });
      const imageDispose = vi.spyOn(predecessors.get("Image")!, "dispose");

      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(0, 1, 0, 1); }",
        lifecycleConfig,
        "/second.slang",
        { BufferA: "float4 mainImage(float2 c) { return float4(2); }" },
      );
      const installed = (engine as any).passPipelines as Map<string, SlangPassPipeline>;

      expect(result?.success).toBe(true);
      expect(result?.warnings?.join("\n")).toMatch(/old render disposal failed/i);
      expect(bufferDispose).toHaveBeenCalledTimes(1);
      expect(imageDispose).toHaveBeenCalledTimes(1);
      expect(resourceManager.cleanup).toHaveBeenCalledTimes(1);
      expect(installed.get("BufferA")).not.toBe(predecessors.get("BufferA"));
      expect(installed.get("Image")).not.toBe(predecessors.get("Image"));
      expect(installed.get("BufferA")?.getPipeline()).not.toBeNull();
      expect(installed.get("Image")?.getPipeline()).not.toBeNull();
      expect(engine.getCurrentConfig()).toBe(lifecycleConfig);
    });

    it("keeps the new generation installed when the old resource manager throws on disposal", async () => {
      const { engine, resourceManager } = lifecycleEngine();
      await engine.compileShaderPipeline(imageSource, lifecycleConfig, "/first.slang", {
        BufferA: bufferSource,
      });
      const predecessors = new Map(
        (engine as any).passPipelines as Map<string, SlangPassPipeline>,
      );
      const cleanupTime = vi.spyOn(engine.getTimeManager(), "cleanup");
      resourceManager.cleanup.mockImplementationOnce(() => {
        throw new Error("old resource disposal failed");
      });

      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(0, 0, 1, 1); }",
        lifecycleConfig,
        "/second.slang",
        { BufferA: "float4 mainImage(float2 c) { return float4(3); }" },
      );

      expect(result?.success).toBe(true);
      expect(result?.warnings?.join("\n")).toMatch(/old resource disposal failed/i);
      expect(engine.getResourceManager()).not.toBe(resourceManager);
      expect((engine as any).passPipelines).not.toEqual(predecessors);
      expect(resourceManager.cleanup).toHaveBeenCalledTimes(1);
      expect(cleanupTime).toHaveBeenCalledTimes(1);
      expect(engine.getPasses().map(({ name }) => name)).toEqual(["BufferA", "Image"]);
      expect(engine.getCurrentConfig()).toBe(lifecycleConfig);
    });

    it("discards the installed generation when candidate video synchronization throws on a path switch", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { device } = stubEngineInternals(engine);
      (engine as any).resourceManager = new ResourceManager(
        new WebGPUTextureBackend(device as unknown as GPUDevice),
      );
      await engine.compileShaderPipeline(imageSource, lifecycleConfig, "/first.slang", {
        BufferA: bufferSource,
      });
      const installedResourceManager = engine.getResourceManager();
      const loadSpy = vi.spyOn(ResourceManager.prototype, "loadVideoTexture")
        .mockResolvedValue({ texture: {} as never });
      const syncSpy = vi.spyOn(ResourceManager.prototype, "syncAllVideosToTime")
        .mockImplementation(function (this: ResourceManager<unknown>) {
          if (this !== installedResourceManager) {
            throw new Error("candidate video synchronization failed");
          }
        });
      const disposeSpy = vi.spyOn(ResourceManager.prototype, "dispose");
      const videoConfig: ShaderConfig = {
        version: "1",
        passes: {
          Image: {
            inputs: {
              iChannel0: {
                type: "video",
                path: "candidate.mp4",
                resolved_path: "/candidate.mp4",
              },
            },
          },
        },
      };

      try {
        const result = await engine.compileShaderPipeline(
          "candidate image",
          videoConfig,
          "/second.slang",
        );
        const candidateResourceManager = loadSpy.mock.instances[0];

        expect(result).toMatchObject({
          success: false,
          errors: [expect.stringMatching(/candidate video synchronization failed/i)],
        });
        expect((engine as any).passPipelines.size).toBe(0);
        expect(engine.getCurrentConfig()).toBeNull();
        expect(engine.getResourceManager()).not.toBe(installedResourceManager);
        expect(disposeSpy.mock.instances.filter((instance) =>
          instance === candidateResourceManager)).toHaveLength(1);
        expect(disposeSpy.mock.instances).toContain(installedResourceManager);
      } finally {
        loadSpy.mockRestore();
        syncSpy.mockRestore();
        disposeSpy.mockRestore();
      }
    });

    it("keeps candidate file resources separate until a path switch commits", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { device } = stubEngineInternals(engine);
      const installedResourceManager = new ResourceManager(
        new WebGPUTextureBackend(device as unknown as GPUDevice),
      );
      (engine as any).resourceManager = installedResourceManager;
      await engine.compileShaderPipeline(imageSource, lifecycleConfig, "/first.slang", {
        BufferA: bufferSource,
      });
      const loadedHandle = { view: { label: "candidate view" }, sampler: { label: "candidate sampler" } };
      const loadSpy = vi.spyOn(ResourceManager.prototype, "loadImageTexture")
        .mockResolvedValue(loadedHandle as never);
      const cleanupSpy = vi.spyOn(ResourceManager.prototype, "cleanup");
      const textureConfig: ShaderConfig = {
        version: "1",
        passes: {
          Image: {
            inputs: {
              iChannel0: {
                type: "texture",
                path: "candidate.png",
                resolved_path: "/candidate.png",
              },
            },
          },
        },
      };

      try {
        const result = await engine.compileShaderPipeline(
          imageSource,
          textureConfig,
          "/second.slang",
        );
        const candidateResourceManager = engine.getResourceManager();

        expect(result?.success).toBe(true);
        expect(candidateResourceManager).not.toBe(installedResourceManager);
        expect(loadSpy.mock.instances).toEqual([candidateResourceManager]);
        expect(cleanupSpy.mock.instances).toContain(installedResourceManager);
        expect(cleanupSpy.mock.instances).not.toContain(candidateResourceManager);
      } finally {
        loadSpy.mockRestore();
        cleanupSpy.mockRestore();
      }
    });

    it("applies the engine's global media state before loading candidate videos", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { device } = stubEngineInternals(engine);
      (engine as any).resourceManager = new ResourceManager(
        new WebGPUTextureBackend(device as unknown as GPUDevice),
      );
      await engine.compileShaderPipeline(imageSource, lifecycleConfig, "/first.slang", {
        BufferA: bufferSource,
      });
      engine.setGlobalVolume(0.25, true);
      const globalStateSpy = vi.spyOn(ResourceManager.prototype, "setGlobalAudioState");
      const loadSpy = vi.spyOn(ResourceManager.prototype, "loadVideoTexture")
        .mockResolvedValue({ texture: {} as never });
      const videoConfig: ShaderConfig = {
        version: "1",
        passes: {
          Image: {
            inputs: {
              iChannel0: {
                type: "video",
                path: "candidate.mp4",
                resolved_path: "/candidate.mp4",
              },
            },
          },
        },
      };

      try {
        const result = await engine.compileShaderPipeline(
          imageSource,
          videoConfig,
          "/second.slang",
        );
        const candidateResourceManager = engine.getResourceManager();

        expect(result?.success).toBe(true);
        expect(globalStateSpy).toHaveBeenCalledWith(0.25, true);
        expect(globalStateSpy.mock.instances.every((instance) =>
          instance === candidateResourceManager)).toBe(true);
        expect(loadSpy.mock.instances).toEqual([candidateResourceManager]);
        expect(globalStateSpy.mock.invocationCallOrder[0])
          .toBeLessThan(loadSpy.mock.invocationCallOrder[0]);
      } finally {
        globalStateSpy.mockRestore();
        loadSpy.mockRestore();
      }
    });

    it("keeps installed resources isolated from a failed same-path image/video candidate", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { device, compiler } = stubEngineInternals(engine);
      (engine as any).resourceManager = new ResourceManager(
        new WebGPUTextureBackend(device as unknown as GPUDevice),
      );
      await engine.compileShaderPipeline(imageSource, lifecycleConfig, "/same.slang", {
        BufferA: bufferSource,
      });
      const installedResourceManager = engine.getResourceManager();
      const loadImageSpy = vi.spyOn(ResourceManager.prototype, "loadImageTexture")
        .mockResolvedValue({} as never);
      const loadVideoSpy = vi.spyOn(ResourceManager.prototype, "loadVideoTexture")
        .mockResolvedValue({ texture: {} as never });
      const disposeSpy = vi.spyOn(ResourceManager.prototype, "dispose");
      compiler.compile.mockResolvedValueOnce({ success: false, errors: ["candidate failed"] });
      const candidateConfig: ShaderConfig = {
        version: "1",
        passes: {
          Image: {
            inputs: {
              iChannel0: { type: "texture", path: "candidate.png", resolved_path: "/candidate.png" },
              iChannel1: { type: "video", path: "candidate.mp4", resolved_path: "/candidate.mp4" },
            },
          },
        },
      };

      try {
        const result = await engine.compileShaderPipeline(
          "failed same-path image",
          candidateConfig,
          "/same.slang",
        );
        const candidateResourceManager = loadImageSpy.mock.instances[0];

        expect(result?.success).toBe(false);
        expect(candidateResourceManager).not.toBe(installedResourceManager);
        expect(loadVideoSpy.mock.instances).toEqual([candidateResourceManager]);
        expect(engine.getResourceManager()).toBe(installedResourceManager);
        expect(disposeSpy.mock.instances.filter((instance) => instance === candidateResourceManager))
          .toHaveLength(1);
        expect(disposeSpy.mock.instances).not.toContain(installedResourceManager);
      } finally {
        loadImageSpy.mockRestore();
        loadVideoSpy.mockRestore();
        disposeSpy.mockRestore();
      }
    });

    it("disposes a same-path resource candidate when a newer compile supersedes it", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { device, compiler } = stubEngineInternals(engine);
      (engine as any).resourceManager = new ResourceManager(
        new WebGPUTextureBackend(device as unknown as GPUDevice),
      );
      await engine.compileShaderPipeline(imageSource, lifecycleConfig, "/same.slang", {
        BufferA: bufferSource,
      });
      const installedResourceManager = engine.getResourceManager();
      const loadImageSpy = vi.spyOn(ResourceManager.prototype, "loadImageTexture")
        .mockResolvedValue({} as never);
      const disposeSpy = vi.spyOn(ResourceManager.prototype, "dispose");
      let releaseCandidate!: () => void;
      compiler.compile.mockImplementationOnce(() => new Promise((resolve) => {
        releaseCandidate = () => resolve({ success: true, wgsl: "// stale candidate" });
      }));
      const candidateConfig: ShaderConfig = {
        version: "1",
        passes: {
          Image: {
            inputs: {
              iChannel0: { type: "texture", path: "candidate.png", resolved_path: "/candidate.png" },
            },
          },
        },
      };

      try {
        const pending = engine.compileShaderPipeline(
          "pending same-path image",
          candidateConfig,
          "/same.slang",
        );
        await vi.waitFor(() => expect(compiler.compile).toHaveBeenCalledWith(
          "pending same-path image",
          expect.objectContaining({ passName: "Image" }),
        ));
        const candidateResourceManager = loadImageSpy.mock.instances[0];

        const newerFailure = await engine.compileShaderPipeline(
          imageSource,
          { version: "1" } as ShaderConfig,
          "/same.slang",
        );

        expect(newerFailure?.success).toBe(false);
        expect(engine.getResourceManager()).toBe(installedResourceManager);
        expect(disposeSpy.mock.instances.filter((instance) => instance === candidateResourceManager))
          .toHaveLength(1);
        expect(disposeSpy.mock.instances).not.toContain(installedResourceManager);

        releaseCandidate();
        await expect(pending).resolves.toEqual({
          success: false,
          errors: ["Superseded by a newer compile"],
          superseded: true,
        });
      } finally {
        loadImageSpy.mockRestore();
        disposeSpy.mockRestore();
      }
    });

    it("promptly settles a compile whose pending video load is superseded", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { device } = stubEngineInternals(engine);
      (engine as any).resourceManager = new ResourceManager(
        new WebGPUTextureBackend(device as unknown as GPUDevice),
      );
      await engine.compileShaderPipeline(imageSource, lifecycleConfig, "/same.slang", {
        BufferA: bufferSource,
      });
      const installedResourceManager = engine.getResourceManager();
      const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const imageLoadSpy = vi.spyOn(ResourceManager.prototype, "loadImageTexture")
        .mockResolvedValue({} as never);
      const pendingConfig: ShaderConfig = {
        version: "1",
        passes: {
          Image: {
            inputs: {
              iChannel0: { type: "video", path: "pending.mp4", resolved_path: "/pending.mp4" },
              iChannel1: { type: "texture", path: "late.png", resolved_path: "/late.png" },
            },
          },
        },
      };

      try {
        const pending = engine.compileShaderPipeline(
          "pending video image",
          pendingConfig,
          "/same.slang",
        );
        await vi.waitFor(() => expect(document.body.querySelector("video")).not.toBeNull());

        const newerFailure = await engine.compileShaderPipeline(
          imageSource,
          { version: "1" } as ShaderConfig,
          "/same.slang",
        );

        expect(newerFailure?.success).toBe(false);
        await expect(pending).resolves.toEqual({
          success: false,
          errors: ["Superseded by a newer compile"],
          superseded: true,
        });
        expect(engine.getResourceManager()).toBe(installedResourceManager);
        expect(document.body.querySelector("video")).toBeNull();
        expect(pauseSpy).toHaveBeenCalledTimes(1);
        expect(imageLoadSpy).not.toHaveBeenCalled();
      } finally {
        pauseSpy.mockRestore();
        errorSpy.mockRestore();
        warnSpy.mockRestore();
        imageLoadSpy.mockRestore();
      }
    });

    it("cleans a cancelled resource candidate again after its in-flight image load settles", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { device } = stubEngineInternals(engine);
      (engine as any).resourceManager = new ResourceManager(
        new WebGPUTextureBackend(device as unknown as GPUDevice),
      );
      await engine.compileShaderPipeline(imageSource, lifecycleConfig, "/same.slang", {
        BufferA: bufferSource,
      });
      let releaseImage!: () => void;
      const loadSpy = vi.spyOn(ResourceManager.prototype, "loadImageTexture")
        .mockImplementationOnce(() => new Promise((resolve) => {
          releaseImage = () => resolve({} as never);
        }));
      const disposeSpy = vi.spyOn(ResourceManager.prototype, "dispose");
      const pendingConfig: ShaderConfig = {
        version: "1",
        passes: {
          Image: {
            inputs: {
              iChannel0: { type: "texture", path: "pending.png", resolved_path: "/pending.png" },
            },
          },
        },
      };

      try {
        const pending = engine.compileShaderPipeline(
          "pending image candidate",
          pendingConfig,
          "/same.slang",
        );
        await vi.waitFor(() => expect(loadSpy).toHaveBeenCalledTimes(1));
        const candidateResourceManager = loadSpy.mock.instances[0];

        await engine.compileShaderPipeline(
          imageSource,
          { version: "1" } as ShaderConfig,
          "/same.slang",
        );
        releaseImage();

        await expect(pending).resolves.toMatchObject({ success: false, superseded: true });
        expect(disposeSpy.mock.instances.filter((instance) =>
          instance === candidateResourceManager)).toHaveLength(2);
      } finally {
        loadSpy.mockRestore();
        disposeSpy.mockRestore();
      }
    });

    it("precomputes the installed buffer snapshot before publishing a generation", async () => {
      const { engine } = lifecycleEngine();
      await engine.compileShaderPipeline(imageSource, lifecycleConfig, "/same.slang", {
        BufferA: bufferSource,
      });
      const predecessors = (engine as any).passPipelines;
      let enumerations = 0;
      const buffers = new Proxy({
        BufferA: "float4 mainImage(float2 c) { return float4(9); }",
      }, {
        ownKeys(target) {
          enumerations++;
          if (enumerations > 1) {
            throw new Error("buffer snapshot read during publication");
          }
          return Reflect.ownKeys(target);
        },
      });

      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(8); }",
        lifecycleConfig,
        "/same.slang",
        buffers,
      );

      expect(result?.success).toBe(true);
      expect(enumerations).toBe(1);
      expect((engine as any).passPipelines).not.toBe(predecessors);
      expect(engine.getVariableCaptureCompileContext()).toEqual({
        commonCode: "",
        slangPassName: "Image",
        slangChannels: [{ slot: 0, key: "iChannel0", kind: "buffer" }],
        slangStorage: [],
        slangStorageBuffers: expect.any(Map),
        slangModules: [],
      });
    });

    it("does not let a failed first attempt leak media into the first successful session", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { device, compiler } = stubEngineInternals(engine);
      (engine as any).resourceManager = new ResourceManager(
        new WebGPUTextureBackend(device as unknown as GPUDevice),
      );
      const loadVideoSpy = vi.spyOn(ResourceManager.prototype, "loadVideoTexture")
        .mockResolvedValue({ texture: {} as never });
      const syncSpy = vi.spyOn(ResourceManager.prototype, "syncAllVideosToTime");
      const resumeSpy = vi.spyOn(ResourceManager.prototype, "resumeAllVideos");
      const disposeSpy = vi.spyOn(ResourceManager.prototype, "dispose");
      compiler.compile.mockResolvedValueOnce({ success: false, errors: ["first attempt failed"] });
      const failedConfig: ShaderConfig = {
        version: "1",
        passes: {
          Image: {
            inputs: {
              iChannel0: { type: "video", path: "orphan.mp4", resolved_path: "/orphan.mp4" },
            },
          },
        },
      };

      try {
        const failed = await engine.compileShaderPipeline(
          "failed first image",
          failedConfig,
          "/a.slang",
        );
        const failedCandidate = loadVideoSpy.mock.instances[0];
        const winner = await engine.compileShaderPipeline(
          "successful second image",
          { version: "1", passes: { Image: { inputs: {} } } },
          "/b.slang",
        );
        const installedResourceManager = engine.getResourceManager();

        expect(failed?.success).toBe(false);
        expect(winner?.success).toBe(true);
        expect(installedResourceManager).not.toBe(failedCandidate);
        expect(disposeSpy.mock.instances.filter((instance) => instance === failedCandidate))
          .toHaveLength(1);
        expect(syncSpy.mock.instances).toContain(installedResourceManager);
        expect(syncSpy.mock.instances).not.toContain(failedCandidate);
        expect(resumeSpy.mock.instances).toContain(installedResourceManager);
        expect(resumeSpy.mock.instances).not.toContain(failedCandidate);
      } finally {
        loadVideoSpy.mockRestore();
        syncSpy.mockRestore();
        resumeSpy.mockRestore();
        disposeSpy.mockRestore();
      }
    });

    it("applies the latest global media state to a candidate immediately before it commits", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { device, compiler } = stubEngineInternals(engine);
      (engine as any).resourceManager = new ResourceManager(
        new WebGPUTextureBackend(device as unknown as GPUDevice),
      );
      await engine.compileShaderPipeline(imageSource, lifecycleConfig, "/same.slang", {
        BufferA: bufferSource,
      });
      const globalStateSpy = vi.spyOn(ResourceManager.prototype, "setGlobalAudioState");
      const loadVideoSpy = vi.spyOn(ResourceManager.prototype, "loadVideoTexture")
        .mockResolvedValue({ texture: {} as never });
      let releaseCandidate!: () => void;
      compiler.compile.mockImplementationOnce(() => new Promise((resolve) => {
        releaseCandidate = () => resolve({ success: true, wgsl: "// candidate" });
      }));
      const candidateConfig: ShaderConfig = {
        version: "1",
        passes: {
          Image: {
            inputs: {
              iChannel0: { type: "video", path: "candidate.mp4", resolved_path: "/candidate.mp4" },
            },
          },
        },
      };

      try {
        const pending = engine.compileShaderPipeline(
          "pending media candidate",
          candidateConfig,
          "/same.slang",
        );
        await vi.waitFor(() => expect(compiler.compile).toHaveBeenCalledWith(
          "pending media candidate",
          expect.objectContaining({ passName: "Image" }),
        ));
        const candidateResourceManager = loadVideoSpy.mock.instances[0];

        engine.setGlobalVolume(0.35, true);
        releaseCandidate();
        const result = await pending;
        const candidateCalls = globalStateSpy.mock.calls.filter((_, index) =>
          globalStateSpy.mock.instances[index] === candidateResourceManager);

        expect(result?.success).toBe(true);
        expect(engine.getResourceManager()).toBe(candidateResourceManager);
        expect(candidateCalls).toEqual([
          [1, false],
          [0.35, true],
        ]);
      } finally {
        globalStateSpy.mockRestore();
        loadVideoSpy.mockRestore();
      }
    });

    it("keeps the installed manager on the latest global media state when a candidate fails", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { device, compiler } = stubEngineInternals(engine);
      (engine as any).resourceManager = new ResourceManager(
        new WebGPUTextureBackend(device as unknown as GPUDevice),
      );
      await engine.compileShaderPipeline(imageSource, lifecycleConfig, "/same.slang", {
        BufferA: bufferSource,
      });
      const installedResourceManager = engine.getResourceManager();
      const globalStateSpy = vi.spyOn(ResourceManager.prototype, "setGlobalAudioState");
      const loadVideoSpy = vi.spyOn(ResourceManager.prototype, "loadVideoTexture")
        .mockResolvedValue({ texture: {} as never });
      let failCandidate!: () => void;
      compiler.compile.mockImplementationOnce(() => new Promise((resolve) => {
        failCandidate = () => resolve({ success: false, errors: ["candidate failed"] });
      }));
      const candidateConfig: ShaderConfig = {
        version: "1",
        passes: {
          Image: {
            inputs: {
              iChannel0: { type: "video", path: "candidate.mp4", resolved_path: "/candidate.mp4" },
            },
          },
        },
      };

      try {
        const pending = engine.compileShaderPipeline(
          "failing media candidate",
          candidateConfig,
          "/same.slang",
        );
        await vi.waitFor(() => expect(compiler.compile).toHaveBeenCalledWith(
          "failing media candidate",
          expect.objectContaining({ passName: "Image" }),
        ));

        engine.setGlobalVolume(0.2, true);
        failCandidate();
        const result = await pending;
        const installedCalls = globalStateSpy.mock.calls.filter((_, index) =>
          globalStateSpy.mock.instances[index] === installedResourceManager);

        expect(result?.success).toBe(false);
        expect(engine.getResourceManager()).toBe(installedResourceManager);
        expect(installedCalls).toContainEqual([0.2, true]);
      } finally {
        globalStateSpy.mockRestore();
        loadVideoSpy.mockRestore();
      }
    });

    it("commits a successful same-path resource candidate and retires its predecessor once", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { device } = stubEngineInternals(engine);
      (engine as any).resourceManager = new ResourceManager(
        new WebGPUTextureBackend(device as unknown as GPUDevice),
      );
      await engine.compileShaderPipeline(imageSource, lifecycleConfig, "/same.slang", {
        BufferA: bufferSource,
      });
      const installedResourceManager = engine.getResourceManager();
      const loadImageSpy = vi.spyOn(ResourceManager.prototype, "loadImageTexture")
        .mockResolvedValue({} as never);
      const disposeSpy = vi.spyOn(ResourceManager.prototype, "dispose");
      const candidateConfig: ShaderConfig = {
        version: "1",
        passes: {
          Image: {
            inputs: {
              iChannel0: { type: "texture", path: "replacement.png", resolved_path: "/replacement.png" },
            },
          },
        },
      };

      try {
        const result = await engine.compileShaderPipeline(
          "successful same-path image",
          candidateConfig,
          "/same.slang",
        );
        const candidateResourceManager = loadImageSpy.mock.instances[0];

        expect(result?.success).toBe(true);
        expect(candidateResourceManager).not.toBe(installedResourceManager);
        expect(engine.getResourceManager()).toBe(candidateResourceManager);
        expect(disposeSpy.mock.instances.filter((instance) => instance === installedResourceManager))
          .toHaveLength(1);
        expect(disposeSpy.mock.instances).not.toContain(candidateResourceManager);
      } finally {
        loadImageSpy.mockRestore();
        disposeSpy.mockRestore();
      }
    });

    it("clears the installed config after a failed path switch", async () => {
      const { engine, compiler } = lifecycleEngine();
      const installedConfig: ShaderConfig = {
        version: "1",
        passes: {
          Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA" } } },
          BufferA: { path: "buffer-a.slang", inputs: {}, resolution: { scale: 0.5 } },
        },
      };
      const candidateConfig: ShaderConfig = {
        version: "1",
        passes: {
          Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA" } } },
          BufferA: { path: "buffer-a.slang", inputs: {}, resolution: { scale: 0.25 } },
        },
      };
      await engine.compileShaderPipeline(imageSource, installedConfig, "/first.slang", {
        BufferA: bufferSource,
      });
      let rejectCandidate!: () => void;
      const blockedCandidate = new Promise<{ success: false; errors: string[] }>((resolve) => {
        rejectCandidate = () => resolve({ success: false, errors: ["candidate failed"] });
      });
      compiler.compile.mockImplementation((source: string) => source === "pending candidate"
        ? blockedCandidate
        : { success: true, wgsl: "// wgsl" });

      const pending = engine.compileShaderPipeline(imageSource, candidateConfig, "/second.slang", {
        BufferA: "pending candidate",
      });
      await vi.waitFor(() => expect(compiler.compile).toHaveBeenCalledWith(
        "pending candidate",
        expect.objectContaining({ passName: "BufferA" }),
      ));

      expect(engine.getCurrentConfig()).toBe(installedConfig);
      engine.handleCanvasResize(640, 360);
      expect(engine.getPasses().find(({ name }) => name === "BufferA")).toMatchObject({
        width: 320,
        height: 180,
      });

      rejectCandidate();
      const result = await pending;

      expect(result?.success).toBe(false);
      expect(engine.getCurrentConfig()).toBeNull();
      expect(engine.getPasses()).toEqual([]);
    });

    it("recompiles attempted source with its matching config after a failed path switch", async () => {
      const { engine, compiler } = lifecycleEngine();
      await engine.compileShaderPipeline(imageSource, lifecycleConfig, "/first.slang", {
        BufferA: bufferSource,
      });
      const candidateConfig: ShaderConfig = {
        version: "1",
        passes: {
          Image: { inputs: { iChannel0: { type: "buffer", source: "BufferB" } } },
          BufferB: { path: "buffer-b.slang", inputs: {} },
        },
      };
      compiler.compile.mockReturnValue({ success: false, errors: ["candidate failed"] });
      const failed = await engine.compileShaderPipeline(
        "candidate image",
        candidateConfig,
        "/second.slang",
        { BufferB: "broken candidate" },
      );
      expect(failed?.success).toBe(false);
      expect(engine.getCurrentConfig()).toBeNull();
      compiler.compile.mockReturnValue({ success: true, wgsl: "// fixed candidate" });

      const recovered = await engine.updateBufferAndRecompile("BufferB", "fixed candidate");

      expect(recovered?.success).toBe(true);
      expect(engine.getPasses().map(({ name }) => name)).toEqual(["BufferB", "Image"]);
      expect(engine.getCurrentConfig()).toBe(candidateConfig);
      expect(compiler.compile).toHaveBeenCalledWith(
        "fixed candidate",
        expect.objectContaining({ passName: "BufferB" }),
      );
    });

    it("keeps capture context for the last attempted shader when a different path fails", async () => {
      const { engine, compiler } = lifecycleEngine();
      await engine.compileShaderPipeline(imageSource, lifecycleConfig, "/first.slang", {
        common: "float commonA() { return 1.0; }",
        BufferA: bufferSource,
      });
      const candidateConfig: ShaderConfig = {
        version: "1",
        passes: {
          Image: { inputs: { iChannel1: { type: "buffer", source: "BufferB" } } },
          BufferB: { path: "buffer-b.slang", inputs: {} },
        },
      };
      let rejectCandidate!: () => void;
      const blockedCandidate = new Promise<{ success: false; errors: string[] }>((resolve) => {
        rejectCandidate = () => resolve({ success: false, errors: ["candidate failed"] });
      });
      compiler.compile.mockImplementation((source: string) => source === "buffer B"
        ? blockedCandidate
        : { success: true, wgsl: "// wgsl" });

      const pending = engine.compileShaderPipeline(
        "candidate image",
        candidateConfig,
        "/second.slang",
        {
          common: "float commonB() { return 2.0; }",
          BufferB: "buffer B",
        },
      );
      await vi.waitFor(() => expect(compiler.compile).toHaveBeenCalledWith(
        "buffer B",
        expect.objectContaining({ passName: "BufferB" }),
      ));

      expect(engine.getVariableCaptureCompileContext("candidate image")).toEqual({
        commonCode: "float commonA() { return 1.0; }",
        slangPassName: "Image",
        slangChannels: [{ slot: 0, key: "iChannel0", kind: "buffer" }],
        slangStorage: [],
        slangStorageBuffers: expect.any(Map),
        slangModules: [],
      });

      rejectCandidate();
      expect((await pending)?.success).toBe(false);
      expect(engine.getVariableCaptureCompileContext("candidate image")).toEqual({
        commonCode: "float commonB() { return 2.0; }",
        slangPassName: "Image",
        slangChannels: [{ slot: 0, key: "iChannel1", kind: "buffer" }],
        slangStorage: [],
        slangStorageBuffers: expect.any(Map),
        slangModules: [],
      });

      compiler.compile.mockReturnValue({ success: false, errors: ["same-path edit failed"] });
      const failedSamePath = await engine.compileShaderPipeline(
        "same-path candidate image",
        lifecycleConfig,
        "/first.slang",
        {
          common: "float commonC() { return 3.0; }",
          BufferA: "same-path broken buffer",
        },
      );

      expect(failedSamePath?.success).toBe(false);
      expect(engine.getVariableCaptureCompileContext("same-path candidate image")).toEqual({
        commonCode: "float commonC() { return 3.0; }",
        slangPassName: "Image",
        slangChannels: [{ slot: 0, key: "iChannel0", kind: "buffer" }],
        slangStorage: [],
        slangStorageBuffers: expect.any(Map),
        slangModules: [],
      });
    });

    it("publishes a successful path generation to capture context", async () => {
      const { engine } = lifecycleEngine();
      await engine.compileShaderPipeline(imageSource, lifecycleConfig, "/first.slang", {
        common: "float commonA() { return 1.0; }",
        BufferA: bufferSource,
      });
      const candidateConfig: ShaderConfig = {
        version: "1",
        passes: {
          Image: { inputs: { iChannel1: { type: "buffer", source: "BufferB" } } },
          BufferB: { path: "buffer-b.slang", inputs: {} },
        },
      };

      const result = await engine.compileShaderPipeline(
        "candidate image",
        candidateConfig,
        "/second.slang",
        {
          common: "float commonB() { return 2.0; }",
          BufferB: "buffer B",
        },
      );

      expect(result?.success).toBe(true);
      expect(engine.getVariableCaptureCompileContext("candidate image")).toEqual({
        commonCode: "float commonB() { return 2.0; }",
        slangPassName: "Image",
        slangChannels: [{ slot: 0, key: "iChannel1", kind: "buffer" }],
        slangStorage: [],
        slangStorageBuffers: expect.any(Map),
        slangModules: [],
      });
    });

    it("preserves time and reusable pipelines when the same shader file recompiles", async () => {
      const { engine, resourceManager } = lifecycleEngine();
      await engine.compileShaderPipeline(imageSource, lifecycleConfig, "/same.slang", {
        BufferA: bufferSource,
      });
      engine.render(1000);
      engine.render(1016);
      const frameBefore = engine.getTimeManager().getFrame();
      const pipelinesBefore = new Map(
        (engine as any).passPipelines as Map<string, SlangPassPipeline>,
      );
      resourceManager.cleanup.mockClear();

      const result = await engine.compileShaderPipeline(imageSource, lifecycleConfig, "/same.slang", {
        BufferA: bufferSource,
      });

      expect(result?.success).toBe(true);
      expect(engine.getTimeManager().getFrame()).toBe(frameBefore);
      expect((engine as any).passPipelines).toEqual(pipelinesBefore);
      expect(resourceManager.cleanup).not.toHaveBeenCalled();
    });

    it("recovers in the same engine after switching to a broken shader file", async () => {
      const { engine, compiler } = lifecycleEngine();
      await engine.compileShaderPipeline(imageSource, lifecycleConfig, "/working.slang", {
        BufferA: bufferSource,
      });
      compiler.compile.mockReturnValue({ success: false, errors: ["syntax error"] });

      const failed = await engine.compileShaderPipeline("broken image", null, "/broken.slang");
      expect(failed?.success).toBe(false);
      expect(engine.getPasses()).toEqual([]);

      compiler.compile.mockReturnValue({ success: true, wgsl: "// corrected" });
      const recovered = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(0, 1, 0, 1); }",
        null,
        "/broken.slang",
      );

      expect(recovered?.success).toBe(true);
      expect(engine.getPasses().map((pass) => pass.name)).toEqual(["Image"]);
      expect((engine as any).passPipelines.get("Image")).toBeTruthy();
    });
  });

  function renderablePipeline(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      getPipeline: () => ({ label: "pipeline" }),
      getBindGroup: () => ({ label: "bind-group" }),
      getUniformBuffer: () => ({ label: "uniform" }),
      getCurrentOutputView: () => ({ label: "current-view" }),
      getPreviousOutputView: () => ({ label: "previous-view" }),
      rebuildBindGroup: vi.fn(),
      swap: vi.fn(),
      ...overrides,
    };
  }

  function stubDeviceAndContext(engine: WebGPURenderingEngine) {
    (engine as any).device = {
      queue: { writeBuffer: vi.fn(), submit: vi.fn() },
      createCommandEncoder: vi.fn(() => ({
        beginRenderPass: vi.fn(() => ({
          setPipeline: vi.fn(),
          setBindGroup: vi.fn(),
          draw: vi.fn(),
          end: vi.fn(),
        })),
        finish: vi.fn(() => ({})),
      })),
    };
    (engine as any).context = {
      getCurrentTexture: () => ({ createView: () => ({ label: "canvas" }) }),
    };
    (engine as any).canvas = { width: 320, height: 180 };
  }

  it("passes the source pipeline's previous-frame view for a self-feedback buffer channel", () => {
    const engine = new WebGPURenderingEngine(assets);
    stubDeviceAndContext(engine);

    const bufferPipeline = renderablePipeline({
      getCurrentOutputView: () => ({ label: "bufferA-current" }),
      getPreviousOutputView: () => ({ label: "bufferA-previous" }),
    });
    const imagePipeline = renderablePipeline({
      getCurrentOutputView: () => null,
      getPreviousOutputView: () => null,
    });

    (engine as any).passGraph = [
      {
        name: "BufferA",
        width: 320,
        height: 180,
        output: "texture",
        // Self-feedback: BufferA reads its own previous frame.
        channels: [{ kind: "buffer", slot: 0, key: "iChannel0", source: "BufferA", readFrom: "previous-frame" }],
      },
      { name: "Image", width: 320, height: 180, output: "canvas", channels: [] },
    ];
    (engine as any).passPipelines = new Map([
      ["BufferA", bufferPipeline],
      ["Image", imagePipeline],
    ]);

    engine.render(1000);

    expect(bufferPipeline.rebuildBindGroup).toHaveBeenCalledWith(
      [{ slot: 0, textureView: { label: "bufferA-previous" } }],
      expect.any(Map),
    );
  });

  it("passes the source pipeline's current-frame view for an Image channel", () => {
    const engine = new WebGPURenderingEngine(assets);
    stubDeviceAndContext(engine);

    const bufferPipeline = renderablePipeline({
      getCurrentOutputView: () => ({ label: "bufferA-current" }),
      getPreviousOutputView: () => ({ label: "bufferA-previous" }),
    });
    const imagePipeline = renderablePipeline({
      getCurrentOutputView: () => null,
      getPreviousOutputView: () => null,
    });

    (engine as any).passGraph = [
      { name: "BufferA", width: 320, height: 180, output: "texture", channels: [] },
      {
        name: "Image",
        width: 320,
        height: 180,
        output: "canvas",
        channels: [{ kind: "buffer", slot: 0, key: "iChannel0", source: "BufferA", readFrom: "current-frame" }],
      },
    ];
    (engine as any).passPipelines = new Map([
      ["BufferA", bufferPipeline],
      ["Image", imagePipeline],
    ]);

    engine.render(1000);

    expect(imagePipeline.rebuildBindGroup).toHaveBeenCalledWith(
      [{ slot: 0, textureView: { label: "bufferA-current" } }],
      expect.any(Map),
    );
  });

  it("rebuilds a channel fragment pass with both resolved channels and installed storage", () => {
    const engine = new WebGPURenderingEngine(assets);
    stubDeviceAndContext(engine);
    const positions = { label: "positions" } as unknown as GPUBuffer;
    const installedStorage = new Map([["positions", positions]]);
    const bufferPipeline = renderablePipeline({
      getCurrentOutputView: () => ({ label: "bufferA-current" }),
      getPreviousOutputView: () => ({ label: "bufferA-previous" }),
    });
    const imagePipeline = renderablePipeline({
      getCurrentOutputView: () => null,
      getPreviousOutputView: () => null,
    });
    (engine as any).storageBuffers = installedStorage;
    (engine as any).passGraph = [
      { name: "BufferA", width: 320, height: 180, output: "texture", channels: [] },
      {
        name: "Image",
        width: 320,
        height: 180,
        output: "canvas",
        channels: [{
          kind: "buffer",
          slot: 0,
          key: "iChannel0",
          source: "BufferA",
          readFrom: "current-frame",
        }],
      },
    ];
    (engine as any).passPipelines = new Map([
      ["BufferA", bufferPipeline],
      ["Image", imagePipeline],
    ]);

    engine.render(1000);

    expect(imagePipeline.rebuildBindGroup).toHaveBeenCalledWith(
      [{ slot: 0, textureView: { label: "bufferA-current" } }],
      installedStorage,
    );
  });

  it("skips a pass entirely when any of its channel sources is unresolvable", () => {
    const engine = new WebGPURenderingEngine(assets);
    stubDeviceAndContext(engine);
    const writeBuffer = (engine as any).device.queue.writeBuffer as ReturnType<typeof vi.fn>;

    const bufferPipeline = renderablePipeline({
      getCurrentOutputView: () => ({ label: "bufferA-current" }),
      getPreviousOutputView: () => ({ label: "bufferA-previous" }),
    });
    const imagePipeline = renderablePipeline({
      getCurrentOutputView: () => null,
      getPreviousOutputView: () => null,
    });

    (engine as any).passGraph = [
      { name: "BufferA", width: 320, height: 180, output: "texture", channels: [] },
      {
        name: "Image",
        width: 320,
        height: 180,
        output: "canvas",
        // Image was compiled expecting TWO channels (bindings 1/2 and 3/4).
        // BufferB never compiled -> binding the lone survivor positionally
        // would mis-bind it, so the whole pass must be skipped this frame.
        channels: [
          { kind: "buffer", slot: 0, key: "iChannel0", source: "BufferA", readFrom: "current-frame" },
          { kind: "buffer", slot: 1, key: "iChannel1", source: "BufferB", readFrom: "current-frame" },
        ],
      },
    ];
    (engine as any).passPipelines = new Map([
      ["BufferA", bufferPipeline],
      ["Image", imagePipeline],
    ]);
    const getCurrentTexture = vi.spyOn((engine as any).context, "getCurrentTexture");

    expect(() => engine.render(1000)).not.toThrow();

    // The Image pass is skipped entirely: no bind group rebuild, no uniform
    // write, no render pass begun on the canvas.
    expect(imagePipeline.rebuildBindGroup).not.toHaveBeenCalled();
    expect(getCurrentTexture).not.toHaveBeenCalled();
    expect(writeBuffer).toHaveBeenCalledTimes(1);
    // The buffer pass with no channels still renders normally.
    const encoder = ((engine as any).device.createCommandEncoder as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(encoder.beginRenderPass).toHaveBeenCalledTimes(1);
  });

  it("does not rebuild the bind group for channel-less passes on any frame", () => {
    const engine = new WebGPURenderingEngine(assets);
    stubDeviceAndContext(engine);

    const bufferPipeline = renderablePipeline();
    const imagePipeline = renderablePipeline({
      getCurrentOutputView: () => null,
      getPreviousOutputView: () => null,
    });

    (engine as any).passGraph = [
      { name: "BufferA", width: 320, height: 180, output: "texture", channels: [] },
      { name: "Image", width: 320, height: 180, output: "canvas", channels: [] },
    ];
    (engine as any).passPipelines = new Map([
      ["BufferA", bufferPipeline],
      ["Image", imagePipeline],
    ]);

    engine.render(1000);
    engine.render(1016);

    // The uniform-only bind group built by rebuild() stays valid; per-frame
    // rebuilds would only churn GPU bind group allocations.
    expect(bufferPipeline.rebuildBindGroup).not.toHaveBeenCalled();
    expect(imagePipeline.rebuildBindGroup).not.toHaveBeenCalled();
  });

  it("draws a channel pass whose bind group only exists after rebuildBindGroup", () => {
    const engine = new WebGPURenderingEngine(assets);
    stubDeviceAndContext(engine);

    // With explicit layouts, channel passes get NO bind group at rebuild()
    // time; the first one is created by rebuildBindGroup during render().
    let imageBindGroup: unknown = null;
    const bufferPipeline = renderablePipeline();
    const imagePipeline = renderablePipeline({
      getBindGroup: () => imageBindGroup,
      rebuildBindGroup: vi.fn(() => {
        imageBindGroup = { label: "image-bind-group" };
      }),
      getCurrentOutputView: () => null,
      getPreviousOutputView: () => null,
    });

    (engine as any).passGraph = [
      { name: "BufferA", width: 320, height: 180, output: "texture", channels: [] },
      {
        name: "Image",
        width: 320,
        height: 180,
        output: "canvas",
        channels: [{ kind: "buffer", slot: 0, key: "iChannel0", source: "BufferA", readFrom: "current-frame" }],
      },
    ];
    (engine as any).passPipelines = new Map([
      ["BufferA", bufferPipeline],
      ["Image", imagePipeline],
    ]);

    engine.render(1000);

    expect(imagePipeline.rebuildBindGroup).toHaveBeenCalledTimes(1);
    const encoder = ((engine as any).device.createCommandEncoder as ReturnType<typeof vi.fn>).mock.results[0].value;
    // Both the buffer pass and the Image pass drew this frame.
    expect(encoder.beginRenderPass).toHaveBeenCalledTimes(2);
  });

  it("rebuilds the bind group every frame so channel views stay current across swaps", () => {
    const engine = new WebGPURenderingEngine(assets);
    stubDeviceAndContext(engine);

    let bufferViewToggle = false;
    const bufferPipeline = renderablePipeline({
      getPreviousOutputView: () => (bufferViewToggle ? { label: "swapped-view" } : { label: "initial-view" }),
    });
    const imagePipeline = renderablePipeline({
      getCurrentOutputView: () => null,
      getPreviousOutputView: () => null,
    });

    (engine as any).passGraph = [
      { name: "BufferA", width: 320, height: 180, output: "texture", channels: [] },
      {
        name: "Image",
        width: 320,
        height: 180,
        output: "canvas",
        channels: [{ kind: "buffer", slot: 0, key: "iChannel0", source: "BufferA", readFrom: "previous-frame" }],
      },
    ];
    (engine as any).passPipelines = new Map([
      ["BufferA", bufferPipeline],
      ["Image", imagePipeline],
    ]);

    engine.render(1000);
    expect(imagePipeline.rebuildBindGroup).toHaveBeenNthCalledWith(
      1,
      [{ slot: 0, textureView: { label: "initial-view" } }],
      expect.any(Map),
    );

    bufferViewToggle = true;
    engine.render(1016);
    expect(imagePipeline.rebuildBindGroup).toHaveBeenNthCalledWith(
      2,
      [{ slot: 0, textureView: { label: "swapped-view" } }],
      expect.any(Map),
    );
  });

  describe("per-pass compile cache", () => {
    const twoPassConfig: ShaderConfig = {
      version: "1",
      passes: {
        Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA" } } },
        BufferA: { path: "a.slang", inputs: {} },
      },
    };

    function cachedSetup() {
      const engine = new WebGPURenderingEngine(assets);
      const { device, compiler } = stubEngineInternals(engine);
      return { engine, device, compiler };
    }

    it("reuses compiled WGSL across fresh engine instances", async () => {
      const first = cachedSetup();
      const second = cachedSetup();
      const config: ShaderConfig = {
        version: "1",
        passes: {
          Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA" } } },
          BufferA: { path: "cache-buffer-a.slang", inputs: {} },
        },
      };

      await first.engine.compileShaderPipeline(
        "img cache cross instance",
        config,
        "/cache-cross-instance.slang",
        { BufferA: "buf cache cross instance" },
      );
      await second.engine.compileShaderPipeline(
        "img cache cross instance",
        config,
        "/cache-cross-instance.slang",
        { BufferA: "buf cache cross instance" },
      );

      expect(first.compiler.compile).toHaveBeenCalledTimes(2);
      expect(second.compiler.compile).not.toHaveBeenCalled();
      expect((second.engine as any).passPipelines.get("Image")).toBeTruthy();
      expect((second.engine as any).passPipelines.get("BufferA")).toBeTruthy();
    });

    it("does not reuse a failed Slang compile across fresh engine instances", async () => {
      const first = cachedSetup();
      const second = cachedSetup();
      first.compiler.compile.mockImplementation((source: string) =>
        source === "buf cache failure"
          ? { success: false, errors: ["bad buffer"] }
          : { success: true, wgsl: "// wgsl" });

      const failed = await first.engine.compileShaderPipeline(
        "img cache failure",
        twoPassConfig,
        "/cache-failure.slang",
        { BufferA: "buf cache failure" },
      );
      const recovered = await second.engine.compileShaderPipeline(
        "img cache failure",
        twoPassConfig,
        "/cache-failure.slang",
        { BufferA: "buf cache failure" },
      );

      expect(failed?.success).toBe(false);
      expect(recovered?.success).toBe(true);
      expect(second.compiler.compile).toHaveBeenCalledWith("buf cache failure", expect.objectContaining({
        passName: "BufferA",
      }));
    });

    it("does not reuse compiled WGSL across fresh engine instances when common code changed", async () => {
      const first = cachedSetup();
      const second = cachedSetup();
      await first.engine.compileShaderPipeline("img common cache", twoPassConfig, "/common-cache.slang", {
        BufferA: "buf common cache",
        common: "float k(){ return 1.0; }",
      });

      await second.engine.compileShaderPipeline("img common cache", twoPassConfig, "/common-cache.slang", {
        BufferA: "buf common cache",
        common: "float k(){ return 2.0; }",
      });

      expect(second.compiler.compile).toHaveBeenCalledTimes(2);
    });

    it("reuses only passes whose channel layout matches across fresh engine instances", async () => {
      const first = cachedSetup();
      const second = cachedSetup();
      const rewired: ShaderConfig = {
        version: "1",
        passes: {
          Image: { inputs: { iChannel1: { type: "buffer", source: "BufferA" } } },
          BufferA: { path: "a.slang", inputs: {} },
        },
      };

      await first.engine.compileShaderPipeline("img channel cache", twoPassConfig, "/channel-cache.slang", {
        BufferA: "buf channel cache",
      });
      await second.engine.compileShaderPipeline("img channel cache", rewired, "/channel-cache.slang", {
        BufferA: "buf channel cache",
      });

      expect(second.compiler.compile).toHaveBeenCalledTimes(1);
      expect(second.compiler.compile).toHaveBeenCalledWith("img channel cache", expect.objectContaining({
        passName: "Image",
        channels: [{ slot: 0, key: "iChannel1", kind: "buffer" }],
      }));
    });

    it("recompiles when a channel keeps the same slot/key but changes resource kind", async () => {
      const first = cachedSetup();
      const second = cachedSetup();
      const textureConfig: ShaderConfig = {
        version: "1",
        passes: {
          Image: { inputs: { iChannel0: { type: "texture", path: "sky.png" } } },
        },
      };
      const cubemapConfig: ShaderConfig = {
        version: "1",
        passes: {
          Image: { inputs: { iChannel0: { type: "cubemap", path: "sky.png" } } },
        },
      };
      (first.engine as any).resourceManager = { loadImageTexture: vi.fn(async () => ({})) };
      (second.engine as any).resourceManager = { loadCubemapTexture: vi.fn(async () => ({})) };

      await first.engine.compileShaderPipeline("img channel kind cache", textureConfig, "/channel-kind-cache.slang", {});
      await second.engine.compileShaderPipeline("img channel kind cache", cubemapConfig, "/channel-kind-cache.slang", {});

      expect(second.compiler.compile).toHaveBeenCalledWith("img channel kind cache", expect.objectContaining({
        passName: "Image",
        channels: [{ slot: 0, key: "iChannel0", kind: "cubemap" }],
      }));
    });

    it("skips recompiling when nothing changed and reuses the same pipelines", async () => {
      const { engine, compiler } = cachedSetup();
      await engine.compileShaderPipeline("img", twoPassConfig, "/s.slang", { BufferA: "buf" });
      const firstGen = new Map((engine as any).passPipelines);
      expect(compiler.compile).toHaveBeenCalledTimes(2);

      compiler.compile.mockClear();
      const result = await engine.compileShaderPipeline("img", twoPassConfig, "/s.slang", { BufferA: "buf" });

      expect(result?.success).toBe(true);
      expect(compiler.compile).not.toHaveBeenCalled();
      expect((engine as any).passPipelines.get("Image")).toBe(firstGen.get("Image"));
      expect((engine as any).passPipelines.get("BufferA")).toBe(firstGen.get("BufferA"));
    });

    it("recompiles only the edited pass and disposes only its predecessor", async () => {
      const { engine, compiler } = cachedSetup();
      await engine.compileShaderPipeline("img", twoPassConfig, "/s.slang", { BufferA: "buf" });
      const firstImage = (engine as any).passPipelines.get("Image");
      const firstBufferA = (engine as any).passPipelines.get("BufferA");
      const imageDispose = vi.spyOn(firstImage, "dispose");
      const bufferDispose = vi.spyOn(firstBufferA, "dispose");

      compiler.compile.mockClear();
      await engine.compileShaderPipeline("img", twoPassConfig, "/s.slang", { BufferA: "buf v2" });

      expect(compiler.compile).toHaveBeenCalledTimes(1);
      expect(compiler.compile.mock.calls[0][0]).toBe("buf v2");
      expect((engine as any).passPipelines.get("Image")).toBe(firstImage);
      expect(imageDispose).not.toHaveBeenCalled();
      expect(bufferDispose).toHaveBeenCalledTimes(1);
    });

    it("recompiles only the pass whose geometry changed", async () => {
      const { engine, compiler } = cachedSetup();
      const fullscreenConfig: ShaderConfig = {
        version: "1",
        passes: {
          Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA" } } },
          BufferA: {
            path: "a.slang",
            geometry: { type: "fullscreen" },
            inputs: {},
          },
        },
      };
      const sphereConfig: ShaderConfig = {
        version: "1",
        passes: {
          Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA" } } },
          BufferA: {
            path: "a.slang",
            geometry: { type: "sphere" },
            inputs: {},
          },
        },
      };

      await engine.compileShaderPipeline("img", fullscreenConfig, "/s.slang", { BufferA: "buf" });
      const firstImage = (engine as any).passPipelines.get("Image");
      const firstBufferA = (engine as any).passPipelines.get("BufferA");
      const imageDispose = vi.spyOn(firstImage, "dispose");
      const bufferDispose = vi.spyOn(firstBufferA, "dispose");

      compiler.compile.mockClear();
      await engine.compileShaderPipeline("img", sphereConfig, "/s.slang", { BufferA: "buf" });

      expect(compiler.compile).toHaveBeenCalledTimes(1);
      expect(compiler.compile).toHaveBeenCalledWith("buf", expect.objectContaining({
        passName: "BufferA",
      }));
      expect((engine as any).passPipelines.get("Image")).toBe(firstImage);
      expect(imageDispose).not.toHaveBeenCalled();
      expect((engine as any).passPipelines.get("BufferA")).not.toBe(firstBufferA);
      expect(bufferDispose).toHaveBeenCalledTimes(1);
    });

    it("recompiles every pass when common code changes", async () => {
      const { engine, compiler } = cachedSetup();
      await engine.compileShaderPipeline("img", twoPassConfig, "/s.slang", {
        BufferA: "buf",
        common: "float k(){return 1.0;}",
      });
      compiler.compile.mockClear();
      await engine.compileShaderPipeline("img", twoPassConfig, "/s.slang", {
        BufferA: "buf",
        common: "float k(){return 2.0;}",
      });
      expect(compiler.compile).toHaveBeenCalledTimes(2);
    });

    it("keeps reused pipelines alive when the changed pass fails to compile", async () => {
      const { engine, compiler } = cachedSetup();
      await engine.compileShaderPipeline("img", twoPassConfig, "/s.slang", { BufferA: "buf" });
      const firstImage = (engine as any).passPipelines.get("Image");
      const firstBufferA = (engine as any).passPipelines.get("BufferA");
      const imageDispose = vi.spyOn(firstImage, "dispose");

      compiler.compile.mockImplementation((src: string) =>
        src === "buf broken" ? { success: false, errors: ["bad"] } : { success: true, wgsl: "wgsl" });
      const result = await engine.compileShaderPipeline("img", twoPassConfig, "/s.slang", { BufferA: "buf broken" });

      expect(result?.success).toBe(false);
      expect(imageDispose).not.toHaveBeenCalled();
      expect((engine as any).passPipelines.get("Image")).toBe(firstImage);
      expect((engine as any).passPipelines.get("BufferA")).toBe(firstBufferA);
    });

    it("reuses WGSL but replaces GPU pipelines when graph dimensions change", async () => {
      const { engine, device, compiler } = cachedSetup();
      await engine.compileShaderPipeline("img", twoPassConfig, "/s.slang", { BufferA: "buf" });
      const image = (engine as any).passPipelines.get("Image");

      (engine as any).canvas = { width: 640, height: 360 };
      await engine.compileShaderPipeline("img", twoPassConfig, "/s.slang", { BufferA: "buf" });

      expect((engine as any).passPipelines.get("Image")).not.toBe(image);
      expect(compiler.compile).toHaveBeenCalledTimes(2); // only the first compile's two calls
      expect(device.createRenderPipeline).toHaveBeenCalledTimes(4);
    });

    it("keeps every installed pass untouched when a later resized pass allocation fails", async () => {
      const { engine, device } = cachedSetup();
      const config: ShaderConfig = {
        version: "1",
        passes: {
          Image: { inputs: {} },
          BufferA: { path: "a.slang", inputs: {} },
          BufferB: { path: "b.slang", inputs: {} },
        },
      };
      await engine.compileShaderPipeline("image", config, "/s.slang", {
        BufferA: "buffer a",
        BufferB: "buffer b",
      });
      const installedPipelines = new Map(
        (engine as any).passPipelines as Map<string, SlangPassPipeline>,
      );
      const installedTextures = device.createTexture.mock.results
        .map((result) => result.value);
      const candidateTextureA = {
        createView: vi.fn(() => ({ label: "candidate-a" })),
        destroy: vi.fn(),
      };
      const candidateTextureB = {
        createView: vi.fn(() => ({ label: "candidate-b" })),
        destroy: vi.fn(),
      };
      device.createTexture
        .mockImplementationOnce(() => candidateTextureA)
        .mockImplementationOnce(() => candidateTextureB)
        .mockImplementationOnce(() => {
          throw new Error("later resize allocation failed");
        });
      (engine as any).canvas = { width: 640, height: 360 };

      const result = await engine.compileShaderPipeline("image", config, "/s.slang", {
        BufferA: "buffer a",
        BufferB: "buffer b",
      });

      expect(result).toMatchObject({
        success: false,
        errors: ["BufferB: later resize allocation failed"],
      });
      expect((engine as any).passPipelines).toEqual(installedPipelines);
      expect(installedTextures.every((texture) => texture.destroy.mock.calls.length === 0)).toBe(true);
      expect(candidateTextureA.destroy).toHaveBeenCalledTimes(1);
      expect(candidateTextureB.destroy).toHaveBeenCalledTimes(1);
    });

    it("recompiles a pass whose channel layout changed", async () => {
      const { engine, compiler } = cachedSetup();
      await engine.compileShaderPipeline("img", twoPassConfig, "/s.slang", { BufferA: "buf" });
      compiler.compile.mockClear();

      const rewired: ShaderConfig = {
        version: "1",
        passes: {
          Image: { inputs: { iChannel1: { type: "buffer", source: "BufferA" } } },
          BufferA: { path: "a.slang", inputs: {} },
        },
      };
      await engine.compileShaderPipeline("img", rewired, "/s.slang", { BufferA: "buf" });

      expect(compiler.compile).toHaveBeenCalledTimes(1); // Image only
    });

    it("logs cache hits and per-pass timings when Slang timing debug is enabled", async () => {
      const engine = new WebGPURenderingEngine({ ...assets, debugTimings: true });
      const { compiler } = stubEngineInternals(engine);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        await engine.compileShaderPipeline("img", twoPassConfig, "/s.slang", { BufferA: "buf" });
        compiler.compile.mockClear();
        logSpy.mockClear();

        const result = await engine.compileShaderPipeline("img", twoPassConfig, "/s.slang", { BufferA: "buf v2" });

        expect(result?.success).toBe(true);
        expect(logSpy).toHaveBeenCalledWith("[SlangPerf] compile requested", expect.objectContaining({
          path: "/s.slang",
          hasDevice: true,
          hasCompiler: true,
        }));
        expect(logSpy).toHaveBeenCalledWith("[SlangPerf] compile", expect.objectContaining({
          status: "success",
          path: "/s.slang",
          generation: expect.any(Number),
          totalMs: expect.any(Number),
          graphMs: expect.any(Number),
          passCount: 2,
          cacheHits: 1,
          compiledPasses: ["BufferA"],
          passSummary: expect.stringContaining("BufferA"),
          passes: expect.arrayContaining([
            expect.objectContaining({ name: "BufferA", cacheHit: false, slangMs: expect.any(Number), pipelineMs: expect.any(Number) }),
            expect.objectContaining({ name: "Image", cacheHit: true }),
          ]),
        }));
        expect(logSpy).toHaveBeenCalledWith(
          "[SlangPerf] compile summary",
          expect.stringContaining("BufferA"),
        );
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  describe("concurrent compiles (generation guard)", () => {
    const twoPassConfig: ShaderConfig = {
      version: "1",
      passes: {
        Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA" } } },
        BufferA: { path: "a.slang", inputs: {} },
      },
    };

    it("drops a stale compile that resolves after a newer one already installed", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { compiler } = stubEngineInternals(engine);

      // Baseline compile: establishes the per-pass cache for both passes.
      await engine.compileShaderPipeline("img", twoPassConfig, "/s.slang", { BufferA: "buf-base" });
      const baselineImage = (engine as any).passPipelines.get("Image");

      const disposeSpy = vi.spyOn(SlangPassPipeline.prototype, "dispose");
      try {
        // Compile A (older edit): its BufferA compile blocks on a controllable
        // promise. Compile B (newer edit) is issued and completes fully before
        // A is released.
        let releaseA: (() => void) | undefined;
        const blockedA = new Promise<{ success: true; wgsl: string }>((resolve) => {
          releaseA = () => resolve({ success: true, wgsl: "wgsl-A" });
        });
        compiler.compile.mockImplementation((src: string) => {
          if (src === "buf-A") {
            return blockedA;
          }
          if (src === "buf-B") {
            return Promise.resolve({ success: true, wgsl: "wgsl-B" });
          }
          return Promise.resolve({ success: true, wgsl: "wgsl-base" });
        });

        const resultAPromise = engine.compileShaderPipeline("img", twoPassConfig, "/s.slang", { BufferA: "buf-A" });
        const resultB = await engine.compileShaderPipeline("img", twoPassConfig, "/s.slang", { BufferA: "buf-B" });

        expect(resultB?.success).toBe(true);
        const installedAfterB_BufferA = (engine as any).passPipelines.get("BufferA");
        const installedAfterB_Image = (engine as any).passPipelines.get("Image");
        // Image was unchanged across all three compiles, so it's the same
        // carried-over pipeline throughout.
        expect(installedAfterB_Image).toBe(baselineImage);

        releaseA!();
        const resultA = await resultAPromise;

        // The superseded flag lets callers (BufferUpdater, ShaderPipeline)
        // silently discard this result instead of surfacing it as a
        // user-facing error banner over a shader that's rendering fine.
        expect(resultA).toEqual({ success: false, errors: ["Superseded by a newer compile"], superseded: true });
        // The installed pipelines are still B's; A's late arrival didn't
        // clobber them.
        expect((engine as any).passPipelines.get("BufferA")).toBe(installedAfterB_BufferA);
        expect((engine as any).passPipelines.get("Image")).toBe(baselineImage);
        // A became stale while still awaiting Slang, so it never allocates a
        // candidate pipeline. Neither installed winner is disposed.
        expect(disposeSpy.mock.instances).not.toContain(installedAfterB_BufferA);
        expect(disposeSpy.mock.instances).not.toContain(baselineImage);
        // The only disposal is the baseline BufferA pipeline replaced by B.
        expect(disposeSpy).toHaveBeenCalledTimes(1);
      } finally {
        disposeSpy.mockRestore();
      }
    });

    it("does not let a stale failure for another path clear a newer shader", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { device, compiler } = stubEngineInternals(engine);
      await engine.compileShaderPipeline("img-base", twoPassConfig, "/base.slang", { BufferA: "buf-base" });

      let releaseFailure: (() => void) | undefined;
      const blockedFailure = new Promise<{ success: false; errors: string[] }>((resolve) => {
        releaseFailure = () => resolve({ success: false, errors: ["late syntax error"] });
      });
      compiler.compile.mockImplementation((src: string) => {
        if (src === "buf-broken") {
          return blockedFailure;
        }
        return Promise.resolve({ success: true, wgsl: `// ${src}` });
      });

      const stalePromise = engine.compileShaderPipeline(
        "img-broken",
        twoPassConfig,
        "/broken.slang",
        { BufferA: "buf-broken" },
      );
      const currentResult = await engine.compileShaderPipeline(
        "img-current",
        twoPassConfig,
        "/current.slang",
        { BufferA: "buf-current" },
      );
      const currentPipelines = new Map((engine as any).passPipelines as Map<string, SlangPassPipeline>);
      const submitsBeforeStaleFailure = device.queue.submit.mock.calls.length;

      releaseFailure!();
      const staleResult = await stalePromise;

      expect(currentResult?.success).toBe(true);
      expect(staleResult).toEqual({
        success: false,
        errors: ["Superseded by a newer compile"],
        superseded: true,
      });
      expect((engine as any).passPipelines).toEqual(currentPipelines);
      expect(engine.getPasses().map((pass) => pass.name)).toEqual(["BufferA", "Image"]);
      expect(device.queue.submit).toHaveBeenCalledTimes(submitsBeforeStaleFailure);
    });

    it("applies a canvas resize that lands mid-compile once the compile completes", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { compiler } = stubEngineInternals(engine);

      let releaseCompile: (() => void) | undefined;
      const blocked = new Promise<{ success: true; wgsl: string }>((resolve) => {
        releaseCompile = () => resolve({ success: true, wgsl: "wgsl" });
      });
      compiler.compile.mockImplementation(() => blocked);

      const compilePromise = engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(0); }",
        { version: "1", passes: { Image: { inputs: {} } } },
        "/image.slang",
        {},
      );

      // The resize lands while the compile is still in flight, before any
      // pipeline exists to resize.
      engine.handleCanvasResize(640, 360);
      releaseCompile!();
      const result = await compilePromise;

      expect(result?.success).toBe(true);
      const imagePass = engine.getPasses().find((pass) => pass.name === "Image");
      expect(imagePass?.width).toBe(640);
      expect(imagePass?.height).toBe(360);
    });

    it("keeps all installed passes at their live size when final candidate reconciliation fails", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { device, compiler } = stubEngineInternals(engine);
      const config: ShaderConfig = {
        version: "1",
        passes: {
          Image: { inputs: {} },
          BufferA: { path: "a.slang", inputs: {} },
          BufferB: { path: "b.slang", inputs: {} },
        },
      };
      await engine.compileShaderPipeline("image baseline", config, "/s.slang", {
        BufferA: "buffer a",
        BufferB: "buffer b",
      });
      const installedPipelines = new Map(
        (engine as any).passPipelines as Map<string, SlangPassPipeline>,
      );
      let releaseImage!: () => void;
      compiler.compile.mockImplementationOnce(() => new Promise((resolve) => {
        releaseImage = () => resolve({ success: true, wgsl: "// changed image" });
      }));

      const pending = engine.compileShaderPipeline("image changed", config, "/s.slang", {
        BufferA: "buffer a",
        BufferB: "buffer b",
      });
      await vi.waitFor(() => expect(compiler.compile).toHaveBeenCalledWith(
        "image changed",
        expect.objectContaining({ passName: "Image" }),
      ));
      engine.handleCanvasResize(640, 360);
      const installedTexturesAtLiveSize = device.createTexture.mock.results
        .slice(4, 8)
        .map((result) => result.value);
      const candidateTextureA = {
        createView: vi.fn(() => ({ label: "candidate-a" })),
        destroy: vi.fn(),
      };
      const candidateTextureB = {
        createView: vi.fn(() => ({ label: "candidate-b" })),
        destroy: vi.fn(),
      };
      device.createTexture
        .mockImplementationOnce(() => candidateTextureA)
        .mockImplementationOnce(() => candidateTextureB)
        .mockImplementationOnce(() => {
          throw new Error("final resolution allocation failed");
        });

      releaseImage();
      const result = await pending;

      expect(result).toMatchObject({
        success: false,
        errors: ["BufferB: final resolution allocation failed"],
      });
      expect((engine as any).passPipelines).toEqual(installedPipelines);
      expect(installedTexturesAtLiveSize.every((texture) =>
        texture.destroy.mock.calls.length === 0)).toBe(true);
      expect(candidateTextureA.destroy).toHaveBeenCalledTimes(1);
      expect(candidateTextureB.destroy).toHaveBeenCalledTimes(1);
      expect(engine.getPasses().find(({ name }) => name === "BufferA")).toMatchObject({
        width: 640,
        height: 360,
      });
      expect(engine.getPasses().find(({ name }) => name === "BufferB")).toMatchObject({
        width: 640,
        height: 360,
      });
    });
  });

  describe("dispose()", () => {
    interface DisposableEngineInternals {
      compiler: { dispose(): void } | null;
      pixelRegionCapturer: { dispose(): void } | null;
      passPipelines: Map<string, { dispose(): void }>;
      passKeys: Map<string, string>;
      passGraph: Array<{ name: string }>;
      resourceManager: { cleanup(): void } | null;
      device: { destroy(): void } | null;
    }

    const disposableInternals = (engine: WebGPURenderingEngine) => (
      engine as unknown as DisposableEngineInternals
    );

    it("returns 'Engine disposed' for any compile attempted after dispose()", async () => {
      const engine = new WebGPURenderingEngine(assets);
      stubEngineInternals(engine);

      engine.dispose();
      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(0); }",
        null,
        "/image.slang",
        {},
      );

      expect(result).toEqual({ success: false, errors: ["Engine disposed"], superseded: true });
    });

    it("disposes installed pass pipelines and clears the pass graph/keys", async () => {
      const engine = new WebGPURenderingEngine(assets);
      stubEngineInternals(engine);

      await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(0); }",
        { version: "1", passes: { Image: { inputs: {} } } },
        "/image.slang",
        {},
      );
      const pipeline = (engine as any).passPipelines.get("Image");
      const disposeSpy = vi.spyOn(pipeline, "dispose");

      engine.dispose();

      expect(disposeSpy).toHaveBeenCalledTimes(1);
      expect((engine as any).passPipelines.size).toBe(0);
      expect((engine as any).passKeys.size).toBe(0);
      expect(engine.getPasses()).toEqual([]);
    });

    it("cleans up the resource manager", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { device } = stubEngineInternals(engine);
      (engine as any).resourceManager = new ResourceManager(new WebGPUTextureBackend(device as unknown as GPUDevice));
      const cleanupSpy = vi.spyOn((engine as any).resourceManager, "cleanup");

      engine.dispose();

      expect(cleanupSpy).toHaveBeenCalledTimes(1);
    });

    it("disposes keyboard and mouse listeners", () => {
      const engine = new WebGPURenderingEngine(assets);
      const keyboardDispose = vi.spyOn((engine as any).keyboardManager, "dispose");
      const mouseDispose = vi.spyOn((engine as any).mouseManager, "dispose");

      engine.dispose();

      expect(keyboardDispose).toHaveBeenCalledOnce();
      expect(mouseDispose).toHaveBeenCalledOnce();
    });

    it.each([
      ["texture", "loadImageTexture", {}],
      ["video", "loadVideoTexture", { texture: {}, warning: undefined }],
      ["cubemap", "loadCubemapTexture", {}],
      ["audio", "loadAudioSource", {}],
    ] as const)("cleans late %s resources and aborts compilation after dispose", async (type, loader, value) => {
      const engine = new WebGPURenderingEngine(assets);
      stubEngineInternals(engine);
      const pending = deferred<unknown>();
      const resources = {
        cleanup: vi.fn(),
        [loader]: vi.fn(() => pending.promise),
        updateAudioLoopRegion: vi.fn(),
      };
      (engine as any).resourceManager = resources;
      const compile = engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(0); }",
        { version: "1", passes: { Image: { inputs: { iChannel0: { type, path: `input.${type}` } } } } } as ShaderConfig,
        "/image.slang",
        {},
      );
      await vi.waitFor(() => expect(resources[loader]).toHaveBeenCalledOnce());

      engine.dispose();
      pending.resolve(value);

      await expect(compile).resolves.toMatchObject({ success: false, superseded: true });
      expect(resources.cleanup).toHaveBeenCalledTimes(2);
      expect((engine as any).passPipelines.size).toBe(0);
    });

    it("cleans late resources when a caught audio load rejects after dispose", async () => {
      const engine = new WebGPURenderingEngine(assets);
      stubEngineInternals(engine);
      const pending = deferred<unknown>();
      const resources = {
        cleanup: vi.fn(),
        loadAudioSource: vi.fn(() => pending.promise),
        updateAudioLoopRegion: vi.fn(),
      };
      (engine as any).resourceManager = resources;
      const compile = engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(0); }",
        { version: "1", passes: { Image: { inputs: { iChannel0: { type: "audio", path: "input.wav" } } } } },
        "/image.slang",
        {},
      );
      await vi.waitFor(() => expect(resources.loadAudioSource).toHaveBeenCalledOnce());

      engine.dispose();
      pending.reject(new Error("late failure"));

      await expect(compile).resolves.toMatchObject({ success: false, superseded: true });
      expect(resources.cleanup).toHaveBeenCalledTimes(2);
      expect(resources.updateAudioLoopRegion).not.toHaveBeenCalled();
    });

    it("does not clean a still-current resource manager when only the compile generation is superseded", async () => {
      const engine = new WebGPURenderingEngine(assets);
      stubEngineInternals(engine);
      const pending = deferred<unknown>();
      const resources = {
        cleanup: vi.fn(),
        loadImageTexture: vi.fn(() => pending.promise),
      };
      (engine as any).resourceManager = resources;
      const staleCompile = engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(0); }",
        { version: "1", passes: { Image: { inputs: { iChannel0: { type: "texture", path: "late.png" } } } } },
        "/image.slang",
        {},
      );
      await vi.waitFor(() => expect(resources.loadImageTexture).toHaveBeenCalledOnce());

      const currentCompile = engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(1); }",
        { version: "1", passes: { Image: { inputs: {} } } },
        "/image.slang",
        {},
      );
      await expect(currentCompile).resolves.toMatchObject({ success: true });
      pending.resolve({});

      await expect(staleCompile).resolves.toMatchObject({ success: false, superseded: true });
      expect(resources.cleanup).not.toHaveBeenCalled();
    });

    it("finishes teardown and clears retained state when compiler disposal throws", () => {
      const compilerError = new Error("compiler cleanup failed");
      const compiler = { dispose: vi.fn(() => {
        throw compilerError;
      }) };
      const inspector = { dispose: vi.fn() };
      const firstPipeline = { dispose: vi.fn() };
      const secondPipeline = { dispose: vi.fn() };
      const resources = { cleanup: vi.fn() };
      const device = { destroy: vi.fn() };
      const engine = new WebGPURenderingEngine(assets);
      const internals = disposableInternals(engine);
      internals.compiler = compiler;
      internals.pixelRegionCapturer = inspector;
      internals.passPipelines = new Map([
        ["BufferA", firstPipeline],
        ["Image", secondPipeline],
      ]);
      internals.passKeys = new Map([["Image", "key"]]);
      internals.passGraph = [{ name: "Image" }];
      internals.resourceManager = resources;
      internals.device = device;

      expect(() => engine.dispose()).toThrow(compilerError);

      expect(compiler.dispose).toHaveBeenCalledOnce();
      expect(inspector.dispose).toHaveBeenCalledOnce();
      expect(firstPipeline.dispose).toHaveBeenCalledOnce();
      expect(secondPipeline.dispose).toHaveBeenCalledOnce();
      expect(resources.cleanup).toHaveBeenCalledOnce();
      expect(device.destroy).toHaveBeenCalledOnce();
      expect(internals.compiler).toBeNull();
      expect(internals.pixelRegionCapturer).toBeNull();
      expect(internals.passPipelines.size).toBe(0);
      expect(internals.passKeys.size).toBe(0);
      expect(internals.passGraph).toEqual([]);
      expect(internals.resourceManager).toBeNull();
      expect(internals.device).toBeNull();

      expect(() => engine.dispose()).not.toThrow();
      expect(compiler.dispose).toHaveBeenCalledOnce();
      expect(firstPipeline.dispose).toHaveBeenCalledOnce();
      expect(resources.cleanup).toHaveBeenCalledOnce();
      expect(device.destroy).toHaveBeenCalledOnce();
    });

    it("continues every cleanup stage while preserving the first thrown error", () => {
      const stopError = new Error("stop failed first");
      const compilerError = new Error("compiler failed second");
      const inspectorError = new Error("inspector failed third");
      const pipelineError = new Error("pipeline failed fourth");
      const resourceError = new Error("resources failed fifth");
      const deviceError = new Error("device failed sixth");
      const engine = new WebGPURenderingEngine(assets);
      const stopSpy = vi.spyOn(engine, "stopRenderLoop").mockImplementation(() => {
        throw stopError;
      });
      const compiler = { dispose: vi.fn(() => {
        throw compilerError;
      }) };
      const inspector = { dispose: vi.fn(() => {
        throw inspectorError;
      }) };
      const failedPipeline = { dispose: vi.fn(() => {
        throw pipelineError;
      }) };
      const successfulPipeline = { dispose: vi.fn() };
      const resources = { cleanup: vi.fn(() => {
        throw resourceError;
      }) };
      const device = { destroy: vi.fn(() => {
        throw deviceError;
      }) };
      const mouseManager = { dispose: vi.fn().mockImplementationOnce(() => {
        throw new Error("mouse failed after stop");
      }) };
      const keyboardManager = { dispose: vi.fn() };
      const internals = disposableInternals(engine);
      Object.assign(engine as any, { mouseManager, keyboardManager });
      internals.compiler = compiler;
      internals.pixelRegionCapturer = inspector;
      internals.passPipelines = new Map([
        ["BufferA", failedPipeline],
        ["Image", successfulPipeline],
      ]);
      internals.passKeys = new Map([["Image", "key"]]);
      internals.passGraph = [{ name: "Image" }];
      internals.resourceManager = resources;
      internals.device = device;

      expect(() => engine.dispose()).toThrow(stopError);

      expect(compiler.dispose).toHaveBeenCalledOnce();
      expect(mouseManager.dispose).toHaveBeenCalledOnce();
      expect(keyboardManager.dispose).toHaveBeenCalledOnce();
      expect(inspector.dispose).toHaveBeenCalledOnce();
      expect(failedPipeline.dispose).toHaveBeenCalledOnce();
      expect(successfulPipeline.dispose).toHaveBeenCalledOnce();
      expect(resources.cleanup).toHaveBeenCalledOnce();
      expect(device.destroy).toHaveBeenCalledOnce();
      expect(internals).toMatchObject({
        compiler: null,
        pixelRegionCapturer: null,
        resourceManager: null,
        device: null,
      });
      expect(internals.passPipelines.size).toBe(0);
      expect(internals.passKeys.size).toBe(0);
      expect(internals.passGraph).toEqual([]);

      stopSpy.mockRestore();
      expect(() => engine.dispose()).not.toThrow();
    });
  });

  describe("cleanup()", () => {
    it("cleans up the resource manager without disposing the device", () => {
      const engine = new WebGPURenderingEngine(assets);
      const { device } = stubEngineInternals(engine);
      (engine as any).resourceManager = new ResourceManager(new WebGPUTextureBackend(device as unknown as GPUDevice));
      const cleanupSpy = vi.spyOn((engine as any).resourceManager, "cleanup");

      engine.cleanup();

      expect(cleanupSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("texture channel inputs", () => {
    const IMAGE_SRC = "float4 mainImage(float2 c) { return float4(0); }";
    const textureConfig: ShaderConfig = {
      version: "1.0",
      passes: {
        Image: {
          inputs: {
            iChannel0: {
              type: "texture",
              path: "tex.png",
              resolved_path: "/abs/tex.png",
              filter: "nearest",
              wrap: "clamp",
              vflip: false,
              grayscale: true,
            },
          },
        },
      },
    };

    let originalImage: typeof Image;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // The compile-time texture load hits the real image pipeline unless a
      // test replaces loadImageTexture/getImageTextureCache directly; jsdom
      // never fires onload/onerror on its own, so fail fast and
      // deterministically instead of hanging the compile's await.
      originalImage = globalThis.Image;
      (globalThis as unknown as { Image: unknown }).Image = vi.fn().mockImplementation(function FailingImage() {
        const img = { src: "", onload: null as (() => void) | null, onerror: null as (() => void) | null };
        Object.defineProperty(img, "src", {
          set() {
            img.onerror?.();
          },
        });
        return img;
      });
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      (globalThis as unknown as { Image: unknown }).Image = originalImage;
      errorSpy.mockRestore();
    });

    function compiledEngine() {
      const engine = new WebGPURenderingEngine(assets);
      const { device, compiler } = stubEngineInternals(engine);
      (engine as any).resourceManager = new ResourceManager(new WebGPUTextureBackend(device as unknown as GPUDevice));
      return { engine, device, compiler };
    }

    it("awaits the texture load during compile with the channel's options", async () => {
      const { engine } = compiledEngine();
      const originalResourceManager = engine.getResourceManager();
      const loadSpy = vi.spyOn(ResourceManager.prototype, "loadImageTexture")
        .mockResolvedValue({} as never);

      try {
        const result = await engine.compileShaderPipeline(IMAGE_SRC, textureConfig, "/s.slang", {});

        expect(result?.success).toBe(true);
        expect(loadSpy).toHaveBeenCalledWith("/abs/tex.png", {
          filter: "nearest",
          wrap: "clamp",
          vflip: false,
          grayscale: true,
        });
        expect(loadSpy.mock.instances).toEqual([engine.getResourceManager()]);
        expect(engine.getResourceManager()).not.toBe(originalResourceManager);
      } finally {
        loadSpy.mockRestore();
      }
    });

    it("reloads into an isolated manager before retiring old cached texture resources", async () => {
      const { engine } = compiledEngine();
      const originalResourceManager = engine.getResourceManager();
      const loadSpy = vi.spyOn(ResourceManager.prototype, "loadImageTexture")
        .mockResolvedValue({} as never);
      const disposeSpy = vi.spyOn(ResourceManager.prototype, "dispose");

      try {
        engine.flagReloadOnNextApply();
        const result = await engine.compileShaderPipeline(IMAGE_SRC, textureConfig, "/s.slang", {});
        const candidateResourceManager = loadSpy.mock.instances[0];

        expect(result?.success).toBe(true);
        expect(candidateResourceManager).not.toBe(originalResourceManager);
        expect(engine.getResourceManager()).toBe(candidateResourceManager);
        expect(disposeSpy.mock.instances.filter((instance) => instance === originalResourceManager))
          .toHaveLength(1);
        expect(disposeSpy.mock.invocationCallOrder[0])
          .toBeGreaterThan(loadSpy.mock.invocationCallOrder[0]);
      } finally {
        loadSpy.mockRestore();
        disposeSpy.mockRestore();
      }
    });

    it("renders using the cached texture handle's view and sampler", async () => {
      const { engine, device } = compiledEngine();
      const handle = { view: { tag: "texView" }, sampler: { tag: "texSampler" } };
      const loadSpy = vi.spyOn(ResourceManager.prototype, "loadImageTexture")
        .mockResolvedValue(handle as never);
      const cacheSpy = vi.spyOn(ResourceManager.prototype, "getImageTextureCache")
        .mockReturnValue({ "/abs/tex.png": handle as never });

      try {
        const result = await engine.compileShaderPipeline(IMAGE_SRC, textureConfig, "/s.slang", {});
        expect(result?.success).toBe(true);
        engine.render(16);

        const bindCalls = (device.createBindGroup as ReturnType<typeof vi.fn>).mock.calls;
        const entries = bindCalls.at(-1)![0].entries;
        expect(entries).toContainEqual({ binding: 1, resource: handle.view });
        expect(entries).toContainEqual({ binding: 2, resource: handle.sampler });
      } finally {
        loadSpy.mockRestore();
        cacheSpy.mockRestore();
      }
    });

    it("falls back to the default texture when the load failed (cache miss)", async () => {
      const { engine, device } = compiledEngine();
      const def = { view: { tag: "defaultView" }, sampler: { tag: "defaultSampler" } };
      const cacheSpy = vi.spyOn(ResourceManager.prototype, "getImageTextureCache")
        .mockReturnValue({});
      const defaultSpy = vi.spyOn(ResourceManager.prototype, "getDefaultTexture")
        .mockReturnValue(def as never);

      try {
        const result = await engine.compileShaderPipeline(IMAGE_SRC, textureConfig, "/s.slang", {});
        expect(result?.success).toBe(true);
        engine.render(16);

        const entries = (device.createBindGroup as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0].entries;
        expect(entries).toContainEqual({ binding: 1, resource: def.view });
      } finally {
        cacheSpy.mockRestore();
        defaultSpy.mockRestore();
      }
    });

    it("buffer channels keep rendering when a texture channel coexists", () => {
      const engine = new WebGPURenderingEngine(assets);
      stubDeviceAndContext(engine);
      const device = (engine as any).device;
      const drawCalls: string[] = [];
      device.createCommandEncoder = vi.fn(() => ({
        beginRenderPass: vi.fn((descriptor: { colorAttachments: Array<{ view: { label?: string } }> }) => {
          drawCalls.push(descriptor.colorAttachments[0].view.label ?? "canvas");
          return {
            setPipeline: vi.fn(),
            setBindGroup: vi.fn(),
            draw: vi.fn(),
            end: vi.fn(),
          };
        }),
        finish: vi.fn(() => ({})),
      }));

      const textureHandle = { view: { label: "tex-view" }, sampler: { label: "tex-sampler" } };
      (engine as any).resourceManager = {
        getImageTextureCache: () => ({ "/tex.png": textureHandle }),
        getDefaultTexture: () => null,
      };

      const bufferPipeline = renderablePipeline({
        getCurrentOutputView: () => ({ label: "bufferA-current" }),
        getPreviousOutputView: () => ({ label: "bufferA-previous" }),
      });
      const imagePipeline = renderablePipeline({
        getCurrentOutputView: () => null,
        getPreviousOutputView: () => null,
      });

      (engine as any).passGraph = [
        {
          name: "BufferA",
          width: 320,
          height: 180,
          output: "texture",
          channels: [{ kind: "buffer", slot: 0, key: "iChannel0", source: "BufferA", readFrom: "previous-frame" }],
        },
        {
          name: "Image",
          width: 320,
          height: 180,
          output: "canvas",
          channels: [
            { kind: "buffer", slot: 0, key: "iChannel0", source: "BufferA", readFrom: "current-frame" },
            { kind: "texture", slot: 1, key: "iChannel1", path: "/tex.png" },
          ],
        },
      ];
      (engine as any).passPipelines = new Map([
        ["BufferA", bufferPipeline],
        ["Image", imagePipeline],
      ]);

      engine.render(1000);

      // Both passes drew: BufferA to its output texture, Image to the canvas.
      expect(drawCalls).toEqual(["bufferA-current", "canvas"]);
      // BufferA's own self-feedback buffer channel resolved fine alongside
      // Image's coexisting buffer + texture channels.
      expect(bufferPipeline.rebuildBindGroup).toHaveBeenCalledWith(
        [{ slot: 0, textureView: { label: "bufferA-previous" } }],
        expect.any(Map),
      );
      expect(imagePipeline.rebuildBindGroup).toHaveBeenCalledWith(
        [
          { slot: 0, textureView: { label: "bufferA-current" } },
          { slot: 1, textureView: textureHandle.view, sampler: textureHandle.sampler },
        ],
        expect.any(Map),
      );
    });
  });

  describe("keyboard channel input", () => {
    const IMAGE_SRC = "float4 mainImage(float2 c) { return float4(0); }";
    const keyboardConfig: ShaderConfig = {
      version: "1.0",
      passes: { Image: { inputs: { iChannel0: { type: "keyboard" } } } },
    };

    async function compiledEngineFactory(config: ShaderConfig) {
      const engine = new WebGPURenderingEngine(assets);
      const { device } = stubEngineInternals(engine);
      (engine as any).resourceManager = new ResourceManager(new WebGPUTextureBackend(device as unknown as GPUDevice));
      // stubEngineInternals bypasses initialize(), which is normally what wires
      // the keyboard manager to `window` — attach it directly so the real
      // KeyboardManager instance reacts to dispatched KeyboardEvents.
      (engine as any).keyboardManager.setupEventListeners();
      const result = await engine.compileShaderPipeline(IMAGE_SRC, config, "/s.slang", {});
      expect(result?.success).toBe(true);
      return engine;
    }

    it("updates the keyboard texture from key state on every rendered frame", async () => {
      const engine = await compiledEngineFactory(keyboardConfig);
      const rm = engine.getResourceManager()!;
      // KeyboardManager reuses the same held/pressed/toggled Uint8Arrays every
      // frame (WebGL parity) and clearPressed() zeroes the "pressed" one
      // in-place right after this same render() call — so a plain spy's
      // recorded args would already read back as cleared by the time the
      // test inspects them. Snapshot copies at call time instead.
      let heldSnapshot: Uint8Array | undefined;
      let pressedSnapshot: Uint8Array | undefined;
      const original = rm.updateKeyboardTexture.bind(rm);
      const spy = vi.spyOn(rm, "updateKeyboardTexture").mockImplementation((held, pressed, toggled) => {
        heldSnapshot = Uint8Array.from(held);
        pressedSnapshot = Uint8Array.from(pressed);
        original(held, pressed, toggled);
      });
      window.dispatchEvent(new KeyboardEvent("keydown", { keyCode: 65 } as KeyboardEventInit));
      engine.render(16);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(heldSnapshot?.[65]).toBe(255);
      expect(pressedSnapshot?.[65]).toBe(255);
    });

    it("clears just-pressed state after each frame (pressed row is 0 on the next frame)", async () => {
      const engine = await compiledEngineFactory(keyboardConfig);
      const rm = engine.getResourceManager()!;
      const spy = vi.spyOn(rm, "updateKeyboardTexture");
      window.dispatchEvent(new KeyboardEvent("keydown", { keyCode: 65 } as KeyboardEventInit));
      engine.render(16);
      engine.render(32);
      const [held2, pressed2] = spy.mock.calls[1];
      expect(held2[65]).toBe(255); // still held
      expect(pressed2[65]).toBe(0); // pressed cleared after previous frame
    });

    it("freezes keyboard texture updates while paused, then resumes with pressed already cleared", async () => {
      const engine = await compiledEngineFactory(keyboardConfig);
      const rm = engine.getResourceManager()!;
      const spy = vi.spyOn(rm, "updateKeyboardTexture");
      engine.render(16);
      engine.getTimeManager().togglePause();
      window.dispatchEvent(new KeyboardEvent("keydown", { keyCode: 66 } as KeyboardEventInit));
      engine.render(32);
      expect(spy).toHaveBeenCalledTimes(1);

      engine.getTimeManager().togglePause();
      engine.render(48);
      const [held, pressed] = spy.mock.calls.at(-1)!;
      expect(held[66]).toBe(255);
      expect(pressed[66]).toBe(0);
    });

    it("binds the keyboard texture handle's view and sampler", async () => {
      const engine = await compiledEngineFactory(keyboardConfig);
      const rm = engine.getResourceManager()!;
      const handle = { view: { tag: "kbView" }, sampler: { tag: "kbSampler" } };
      vi.spyOn(rm, "getKeyboardTexture").mockReturnValue(handle as never);
      engine.render(16);
      const device = (engine as any).device;
      const entries = (device.createBindGroup as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0].entries;
      expect(entries).toContainEqual({ binding: 1, resource: handle.view });
      expect(entries).toContainEqual({ binding: 2, resource: handle.sampler });
    });

    it("setInputEnabled(false) clears held keys", async () => {
      const engine = await compiledEngineFactory(keyboardConfig);
      const rm = engine.getResourceManager()!;
      const spy = vi.spyOn(rm, "updateKeyboardTexture");
      window.dispatchEvent(new KeyboardEvent("keydown", { keyCode: 65 } as KeyboardEventInit));
      engine.setInputEnabled(false);
      engine.render(16);
      expect(spy.mock.calls.at(-1)![0][65]).toBe(0);
    });
  });
});
