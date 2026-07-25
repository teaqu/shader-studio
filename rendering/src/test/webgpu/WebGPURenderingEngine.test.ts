import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { ShaderConfig } from "@shader-studio/types";
import { WebGPURenderingEngine } from "../../webgpu/WebGPURenderingEngine";
import { SlangPassPipeline } from "../../webgpu/SlangPassPipeline";
import { sharedSlangWgslCache } from "../../webgpu/SlangWgslCache";
import { TimeManager } from "../../util/TimeManager";
import { ResourceManager } from "../../resources/ResourceManager";
import { WebGPUTextureBackend } from "../../webgpu/WebGPUTextureBackend";
import { UNIFORM_OFFSETS } from "../../webgpu/SlangPrelude";

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
  };
  return { device: device as unknown as GPUDevice, textures };
}

describe("WebGPURenderingEngine", () => {
  beforeEach(() => {
    sharedSlangWgslCache.clear();
  });

  it("initializes without throwing when WebGPU is unavailable", () => {
    const engine = new WebGPURenderingEngine(assets);
    expect(() => engine.initialize(noWebGpuCanvas())).not.toThrow();
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

  it("requests the adapter's higher 2D texture limit when available", async () => {
    const context = { configure: vi.fn() };
    const device = {
      createTexture: vi.fn(() => ({ createView: vi.fn(() => ({})), destroy: vi.fn() })),
      createSampler: vi.fn(() => ({})),
      queue: { writeTexture: vi.fn() },
      limits: { maxTextureDimension2D: 16384 },
    };
    const adapter = {
      limits: { maxTextureDimension2D: 16384 },
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
        requiredLimits: { maxTextureDimension2D: 16384 },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  describe("asynchronous disposal during initialization", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("does not request a device when disposed while the adapter request is pending", async () => {
      const adapterResult = deferred<GPUAdapter | null>();
      const requestDevice = vi.fn();
      const adapter = { requestDevice } as unknown as GPUAdapter;
      const context = { configure: vi.fn() };
      vi.stubGlobal("navigator", {
        gpu: {
          requestAdapter: vi.fn(() => adapterResult.promise),
          getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
        },
      });
      const engine = new WebGPURenderingEngine(assets);

      engine.initialize(webGpuCanvas(context));
      engine.dispose();
      adapterResult.resolve(adapter);
      await lifecycleInternals(engine).ready;

      expect(requestDevice).not.toHaveBeenCalled();
      expect(context.configure).not.toHaveBeenCalled();
      expect(lifecycleInternals(engine)).toMatchObject({
        device: null,
        compiler: null,
        resourceManager: null,
      });
    });

    it("destroys a device obtained after disposal without configuring or retaining it", async () => {
      const deviceResult = deferred<GPUDevice>();
      const requestDevice = vi.fn(() => deviceResult.promise);
      const adapter = { requestDevice } as unknown as GPUAdapter;
      const { device } = lifecycleDevice();
      const context = { configure: vi.fn() };
      vi.stubGlobal("navigator", {
        gpu: {
          requestAdapter: vi.fn(async () => adapter),
          getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
        },
      });
      const engine = new WebGPURenderingEngine(assets);
      const createCompiler = vi.spyOn(
        engine as unknown as { createCompiler(): Promise<unknown> },
        "createCompiler",
      );

      engine.initialize(webGpuCanvas(context));
      await vi.waitFor(() => expect(requestDevice).toHaveBeenCalledOnce());
      engine.dispose();
      deviceResult.resolve(device);
      await lifecycleInternals(engine).ready;

      expect(device.destroy).toHaveBeenCalledOnce();
      expect(context.configure).not.toHaveBeenCalled();
      expect(createCompiler).not.toHaveBeenCalled();
      expect(lifecycleInternals(engine)).toMatchObject({
        device: null,
        compiler: null,
        resourceManager: null,
      });
    });

    it("disposes a compiler obtained after disposal and retains no initialized resources", async () => {
      const compilerResult = deferred<{ compile: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }>();
      const compilerStarted = deferred<void>();
      const compiler = { compile: vi.fn(), dispose: vi.fn() };
      const { device } = lifecycleDevice();
      const adapter = { requestDevice: vi.fn(async () => device) } as unknown as GPUAdapter;
      const context = { configure: vi.fn() };
      vi.stubGlobal("navigator", {
        gpu: {
          requestAdapter: vi.fn(async () => adapter),
          getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
        },
      });
      const engine = new WebGPURenderingEngine(assets);
      vi.spyOn(
        engine as unknown as { createCompiler(): Promise<unknown> },
        "createCompiler",
      ).mockImplementation(() => {
        compilerStarted.resolve();
        return compilerResult.promise;
      });

      engine.initialize(webGpuCanvas(context));
      await compilerStarted.promise;
      engine.dispose();

      expect(device.destroy).toHaveBeenCalledOnce();
      expect(lifecycleInternals(engine)).toMatchObject({
        device: null,
        compiler: null,
        resourceManager: null,
      });

      compilerResult.resolve(compiler);
      await lifecycleInternals(engine).ready;

      expect(compiler.dispose).toHaveBeenCalledOnce();
      expect(lifecycleInternals(engine)).toMatchObject({
        device: null,
        compiler: null,
        resourceManager: null,
      });
    });

    it("drops a compile superseded while waiting for initialization before compiler work", async () => {
      const ready = deferred<void>();
      const compiler = { compile: vi.fn(), dispose: vi.fn() };
      const { device } = lifecycleDevice();
      const engine = new WebGPURenderingEngine(assets);
      const internals = lifecycleInternals(engine);
      internals.ready = ready.promise;
      internals.device = device;
      internals.compiler = compiler;

      const compiling = engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(1); }",
        null,
        "/a.slang",
        {},
      );
      internals.compileGeneration++;
      ready.resolve();

      const result = await compiling;
      expect(result).toEqual({
        success: false,
        errors: ["Superseded by a newer compile"],
        superseded: true,
      });
      expect(compiler.compile).not.toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ passName: "BufferA" }) }));
    });
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
    expect(u.channelLoaded).toEqual([0, 0, 0, 0]);
  });

  it("stubs unsupported features with safe defaults", () => {
    const engine = new WebGPURenderingEngine(assets);
    engine.initialize(noWebGpuCanvas());
    expect(engine.getPasses()).toEqual([]);
    expect(engine.getCustomUniformInfo()).toEqual([]);
    expect(engine.getCustomUniformDeclarations()).toBe("");
    expect(engine.readPixel(0, 0)).toBeNull();
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

  it("delegates input enablement, reset, and disposal to the camera manager", () => {
    const engine = new WebGPURenderingEngine(assets);
    const camera = {
      setEnabled: vi.fn(),
      reset: vi.fn(),
      dispose: vi.fn(),
    };
    (engine as any).cameraManager = camera;

    engine.setInputEnabled(false);
    engine.resetTime();
    engine.dispose();

    expect(camera.setEnabled).toHaveBeenCalledWith(false);
    expect(camera.reset).toHaveBeenCalledTimes(1);
    expect(camera.dispose).toHaveBeenCalledTimes(1);
  });

  it("does not commit config from an unsuccessful compile", async () => {
    const engine = new WebGPURenderingEngine(assets);
    engine.initialize(noWebGpuCanvas());
    const config = { passes: {} } as never;
    await engine.compileShaderPipeline("x", config, "/a.slang", {});
    expect(engine.getCurrentConfig()).toBeNull();
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
    );

    expect(result?.success).toBe(true);
    expect(engine.getPasses().map((pass) => pass.name)).toEqual(["BufferA", "Image"]);
    expect(compiler.compile).toHaveBeenCalledTimes(2);
    expect(compiler.compile).toHaveBeenNthCalledWith(1, expect.objectContaining({ source: expect.stringContaining("float4(1)"), options: expect.objectContaining({ passName: "BufferA", commonCode: "", channels: [] }) }));
    expect(compiler.compile).toHaveBeenNthCalledWith(2, expect.objectContaining({ source: expect.stringContaining("float4(0)"), options: expect.objectContaining({ passName: "Image", commonCode: "", channels: [{ slot: 0, key: "iChannel0", kind: "buffer" }] }) }));
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
          Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA" } } },
          BufferA: { path: "buffer-a.slang", inputs: {} },
        },
      },
      "/image.slang",
      {}, // BufferA source missing -> pass graph reports an error
    );

    expect(result?.success).toBe(false);
    expect(result?.errors?.[0]).toMatch(/BufferA/);
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

  it("propagates pass graph warnings into a successful compile result", async () => {
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
    expect(result?.warnings?.[0]).toMatch(/non-iChannel/i);
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
        beginRenderPass: vi.fn(() => ({
          setPipeline: vi.fn(),
          setBindGroup: vi.fn(),
          draw: vi.fn(),
          end: vi.fn(),
        })),
        finish: vi.fn(() => ({})),
      })),
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

  describe("workspace compile requests", () => {
    const source = "float4 mainImage(float2 c) { return float4(1); }";
    const workspace = () => ({ rootUri: "file:///workspace/shaders/image.slang", files: [
      { path: "/workspace/shaders/image.slang", uri: "file:///workspace/shaders/image.slang", source },
      { path: "/workspace/shaders/passes/buffera.slang", uri: "file:///workspace/shaders/passes/buffera.slang", source: "buffer" },
      { path: "/workspace/shaders/lib/root.slang", uri: "file:///workspace/shaders/lib/root.slang", source: "module root;" },
    ] });

    it("uses exact root and nested buffer files without mutating the supplied workspace", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { compiler } = stubEngineInternals(engine);
      const snapshot = workspace();
      const before = structuredClone(snapshot);
      const config: ShaderConfig = { version: "1", passes: { Image: { inputs: {} }, BufferA: { path: "passes/buffera.slang", inputs: {} } } };
      await engine.compileShaderPipeline(source, config, "/workspace/shaders/image.slang", { BufferA: "buffer v2" }, undefined, undefined, snapshot);
      const buffer = compiler.compile.mock.calls.find(([request]: any[]) => request.options.passName === "BufferA")[0];
      const image = compiler.compile.mock.calls.find(([request]: any[]) => request.options.passName === "Image")[0];
      expect(buffer).toEqual(expect.objectContaining({ sourcePath: "/workspace/shaders/passes/buffera.slang", sourceUri: "file:///workspace/shaders/passes/buffera.slang" }));
      expect(image).toEqual(expect.objectContaining({ sourcePath: "/workspace/shaders/image.slang", sourceUri: "file:///workspace/shaders/image.slang" }));
      expect(buffer.workspace.files).toHaveLength(3);
      expect(snapshot).toEqual(before);
    });

    it("rejects conflicting exact workspace identities before compilation", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { compiler } = stubEngineInternals(engine);
      const conflicting = { rootUri: "file:///workspace/root.slang", files: [
        { path: "/workspace/root.slang", uri: "file:///workspace/other.slang", source },
        { path: "/workspace/other.slang", uri: "file:///workspace/root.slang", source },
      ] };
      const result = await engine.compileShaderPipeline(source, null, "/workspace/root.slang", {}, undefined, undefined, conflicting);
      expect(result).toEqual(expect.objectContaining({ success: false }));
      expect(compiler.compile).not.toHaveBeenCalled();
    });

    it("rejects ambiguous source-only root fallback", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { compiler } = stubEngineInternals(engine);
      const ambiguous = { rootUri: "file:///workspace/missing.slang", files: [
        { path: "/workspace/a.slang", uri: "file:///workspace/a.slang", source },
        { path: "/workspace/b.slang", uri: "file:///workspace/b.slang", source },
      ] };
      const result = await engine.compileShaderPipeline(source, null, "/workspace/missing.slang", {}, undefined, undefined, ambiguous);
      expect(result).toEqual(expect.objectContaining({ success: false }));
      expect(compiler.compile).not.toHaveBeenCalled();
    });

    it("uses a single canonical fallback workspace when omitted", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { compiler } = stubEngineInternals(engine);
      await engine.compileShaderPipeline(source, null, "/workspace/fallback.slang");
      expect(compiler.compile.mock.calls[0][0]).toEqual(expect.objectContaining({
        source, sourcePath: "/workspace/fallback.slang", sourceUri: "file:///workspace/fallback.slang",
        workspace: { rootUri: "file:///workspace/fallback.slang", files: [{ path: "/workspace/fallback.slang", uri: "file:///workspace/fallback.slang", source }] },
      }));
    });

    it("resolves a folder-root relative encoded nested buffer without mutation", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { compiler } = stubEngineInternals(engine);
      const nested = "/workspace/passes/a #%é.slang";
      const uri = "file:///project/passes/a%20%23%25%C3%A9.slang";
      const snapshot = { rootUri: "file:///project", files: [
        { path: "/workspace/image.slang", uri: "file:///project/image.slang", source },
        { path: nested, uri, source: "buffer" },
        { path: "/workspace/lib/a.slang", uri: "file:///project/lib/a.slang", source: "module a;" },
      ] };
      const before = structuredClone(snapshot);
      const config: ShaderConfig = { version: "1", passes: { Image: { inputs: {} }, BufferA: { path: "passes/a #%é.slang", inputs: {} } } };
      await engine.compileShaderPipeline(source, config, "/project/image.slang", { BufferA: "updated" }, undefined, undefined, snapshot);
      const request = compiler.compile.mock.calls.find(([value]: any[]) => value.options.passName === "BufferA")[0];
      expect(request).toEqual(expect.objectContaining({ sourcePath: nested, sourceUri: uri }));
      expect(request.workspace.files).toHaveLength(3);
      expect(snapshot).toEqual(before);
    });

    it("normalizes in-root dot segments but rejects traversal and foreign file authorities", async () => {
      const snapshot = { rootUri: "file:///project", files: [
        { path: "/workspace/image.slang", uri: "file:///project/image.slang", source },
        { path: "/workspace/lib/a.slang", uri: "file:///project/lib/a.slang", source: "lib" },
      ] };
      const config = (path: string): ShaderConfig => ({ version: "1", passes: { Image: { inputs: {} }, BufferA: { path, inputs: {} } } });
      const good = new WebGPURenderingEngine(assets);
      const { compiler } = stubEngineInternals(good);
      await good.compileShaderPipeline(source, config("passes/../lib/a.slang"), "/project/image.slang", { BufferA: "updated" }, undefined, undefined, snapshot);
      expect(compiler.compile.mock.calls.find(([value]: any[]) => value.options.passName === "BufferA")?.[0].sourcePath).toBe("/workspace/lib/a.slang");
      for (const badPath of ["../../outside.slang", "%2e%2e/%2e%2e/outside.slang", "file://foreign/project/lib/a.slang"]) {
        const engine = new WebGPURenderingEngine(assets);
        const mocked = stubEngineInternals(engine).compiler;
        const result = await engine.compileShaderPipeline(source, config(badPath), "/project/image.slang", { BufferA: "updated" }, undefined, undefined, snapshot);
        expect(result?.success).toBe(false);
        expect(mocked.compile).not.toHaveBeenCalled();
      }
    });

    it("maps Windows drive spelling to the canonical workspace file", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { compiler } = stubEngineInternals(engine);
      const snapshot = { rootUri: "file:///C:/Project", files: [
        { path: "/workspace/image.slang", uri: "file:///c:/Project/image.slang", source },
        { path: "/workspace/passes/a.slang", uri: "file:///c:/Project/passes/a.slang", source: "a" },
      ] };
      const config: ShaderConfig = { version: "1", passes: { Image: { inputs: {} }, BufferA: { path: "C:\\Project\\passes\\a.slang", inputs: {} } } };
      await engine.compileShaderPipeline(source, config, "C:\\Project\\image.slang", { BufferA: "updated" }, undefined, undefined, snapshot);
      expect(compiler.compile.mock.calls.find(([value]: any[]) => value.options.passName === "BufferA")?.[0].sourceUri).toBe("file:///c:/Project/passes/a.slang");
    });

    it.each(["/project/a #% .slang", "C:\\Project\\a.slang", "file:///project/a%20%23%25.slang", "nested/a.slang", "../../escape.slang"])("creates one safe fallback workspace for %s", async (input) => {
      const engine = new WebGPURenderingEngine(assets);
      const { compiler } = stubEngineInternals(engine);
      await engine.compileShaderPipeline(source, null, input);
      const request = compiler.compile.mock.calls[0][0];
      expect(request.sourcePath).toMatch(/^\/workspace\//);
      expect(request.workspace).toEqual({ rootUri: request.sourceUri, files: [{ path: request.sourcePath, uri: request.sourceUri, source }] });
      expect(request.source).toBe(source);
    });

    it("rejects unmatched buffers before invoking the compiler", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { compiler } = stubEngineInternals(engine);
      const result = await engine.compileShaderPipeline(source, { version: "1", passes: { BufferA: { path: "missing.slang", inputs: {} }, Image: { inputs: {} } } }, "/workspace/shaders/image.slang", { BufferA: "buffer" }, undefined, undefined, workspace());
      expect(result).toEqual(expect.objectContaining({ success: false, errors: [expect.stringMatching(/Workspace/)] }));
      expect(compiler.compile).not.toHaveBeenCalled();
    });

    it("reuses identical workspace snapshots but recompiles a dependency-only edit", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { compiler } = stubEngineInternals(engine);
      const snapshot = workspace();
      await engine.compileShaderPipeline(source, null, "/workspace/shaders/image.slang", {}, undefined, undefined, snapshot);
      compiler.compile.mockClear();
      await engine.compileShaderPipeline(source, null, "/workspace/shaders/image.slang", {}, undefined, undefined, structuredClone(snapshot));
      expect(compiler.compile).not.toHaveBeenCalled();
      const edited = structuredClone(snapshot);
      edited.files[2].source = "module edited;";
      await engine.compileShaderPipeline(source, null, "/workspace/shaders/image.slang", {}, undefined, undefined, edited);
      expect(compiler.compile).toHaveBeenCalledTimes(1);
    });

    it("recompiles when only a dependency version changes", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { compiler } = stubEngineInternals(engine);
      const snapshot = workspace();
      snapshot.files[2].version = 1;
      await engine.compileShaderPipeline(source, null, "/workspace/shaders/image.slang", {}, undefined, undefined, snapshot);
      compiler.compile.mockClear();
      const versionOnly = structuredClone(snapshot);
      versionOnly.files[2].version = 2;
      await engine.compileShaderPipeline(source, null, "/workspace/shaders/image.slang", {}, undefined, undefined, versionOnly);
      expect(compiler.compile).toHaveBeenCalledTimes(1);
    });

    it("does not cache an earlier pass when a later pipeline rebuild fails", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { compiler } = stubEngineInternals(engine);
      const config: ShaderConfig = { version: "1", passes: { Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA" } } }, BufferA: { path: "passes/buffera.slang", inputs: {} } } };
      const rebuild = vi.spyOn(SlangPassPipeline.prototype, "rebuild")
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(["later pipeline error"]);
      const first = await engine.compileShaderPipeline(source, config, "/workspace/shaders/image.slang", { BufferA: "buffer" }, undefined, undefined, workspace());
      expect(first?.success).toBe(false);
      expect(compiler.compile).toHaveBeenCalledTimes(2);
      rebuild.mockRestore();
      await engine.compileShaderPipeline(source, config, "/workspace/shaders/image.slang", { BufferA: "buffer" }, undefined, undefined, workspace());
      expect(compiler.compile).toHaveBeenCalledTimes(4);
    });

    it("does not cache a failed Slang compile", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { compiler } = stubEngineInternals(engine);
      compiler.compile.mockReturnValueOnce({ success: false, errors: ["bad Slang"], diagnostics: [] });
      const first = await engine.compileShaderPipeline(source, null, "/workspace/failure-cache.slang", {}, undefined, undefined, workspace());
      expect(first?.success).toBe(false);
      compiler.compile.mockReturnValue({ success: true, wgsl: "// recovered", diagnostics: [] });
      const second = await engine.compileShaderPipeline(source, null, "/workspace/failure-cache.slang", {}, undefined, undefined, workspace());
      expect(second?.success).toBe(true);
      expect(compiler.compile).toHaveBeenCalledTimes(2);
    });

    it("does not cache WGSL from a superseded generation", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { compiler } = stubEngineInternals(engine);
      const old = deferred<any>();
      compiler.compile.mockImplementation((request: any) => request.source === "old source"
        ? old.promise
        : { success: true, wgsl: "// new", diagnostics: [] });
      const pendingOld = engine.compileShaderPipeline("old source", null, "/workspace/old.slang");
      const newer = await engine.compileShaderPipeline("new source", null, "/workspace/new.slang");
      expect(newer?.success).toBe(true);
      const installed = (engine as any).passPipelines.get("Image");
      old.resolve({ success: true, wgsl: "// old", diagnostics: [] });
      await expect(pendingOld).resolves.toEqual(expect.objectContaining({ success: false, superseded: true }));
      expect((engine as any).passPipelines.get("Image")).toBe(installed);
      await engine.compileShaderPipeline("old source", null, "/workspace/old.slang");
      expect(compiler.compile.mock.calls.filter(([request]: any[]) => request.source === "old source")).toHaveLength(2);
    });

    it("retains committed state when a different workspace path fails", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { compiler } = stubEngineInternals(engine);
      const oldWorkspace = workspace();
      await engine.compileShaderPipeline(source, null, "/workspace/shaders/image.slang", {}, undefined, undefined, oldWorkspace);
      const oldPipeline = (engine as any).passPipelines.get("Image");
      const dispose = vi.spyOn(oldPipeline, "dispose");
      const oldGraph = engine.getPasses();
      compiler.compile.mockReturnValueOnce({ success: false, errors: ["broken"], diagnostics: [] });
      const failed = await engine.compileShaderPipeline("new", null, "/workspace/other.slang", {}, undefined, undefined, { rootUri: "file:///workspace/other.slang", files: [{ path: "/workspace/other.slang", uri: "file:///workspace/other.slang", source: "new" }] });
      expect(failed?.success).toBe(false);
      expect((engine as any).shaderPath).toBe("/workspace/shaders/image.slang");
      expect(engine.getPasses()).toBe(oldGraph);
      expect((engine as any).passPipelines.get("Image")).toBe(oldPipeline);
      expect(dispose).not.toHaveBeenCalled();
      expect((engine as any).lastCompile).toEqual(expect.objectContaining({ path: "/workspace/shaders/image.slang", workspace: oldWorkspace }));
    });

    it("swaps a different workspace only after its compile commits", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { compiler } = stubEngineInternals(engine);
      const a = workspace();
      await engine.compileShaderPipeline(source, null, "/workspace/shaders/image.slang", {}, undefined, undefined, a);
      const oldPipeline = (engine as any).passPipelines.get("Image");
      const dispose = vi.spyOn(oldPipeline, "dispose");
      const pending = deferred<any>();
      compiler.compile.mockImplementationOnce(() => pending.promise);
      const b = { rootUri: "file:///workspace/b.slang", files: [{ path: "/workspace/b.slang", uri: "file:///workspace/b.slang", source: "b" }] };
      const compiling = engine.compileShaderPipeline("b", null, "/workspace/b.slang", {}, undefined, undefined, b);
      expect((engine as any).passPipelines.get("Image")).toBe(oldPipeline);
      expect(dispose).not.toHaveBeenCalled();
      pending.resolve({ success: true, wgsl: "// b", diagnostics: [] });
      await expect(compiling).resolves.toEqual(expect.objectContaining({ success: true }));
      expect(dispose).toHaveBeenCalledTimes(1);
      expect((engine as any).passPipelines.get("Image")).not.toBe(oldPipeline);
      expect((engine as any).lastCompile).toEqual(expect.objectContaining({ path: "/workspace/b.slang", workspace: b }));
    });

    it("drops deferred compilation when disposed without caching or committing it", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { compiler } = stubEngineInternals(engine);
      const pending = deferred<any>();
      compiler.compile.mockReturnValueOnce(pending.promise);
      const compiling = engine.compileShaderPipeline("dispose source", null, "/workspace/dispose.slang");
      engine.dispose();
      pending.resolve({ success: true, wgsl: "// dispose", diagnostics: [] });
      await expect(compiling).resolves.toEqual(expect.objectContaining({ success: false, superseded: true }));
      expect((engine as any).passPipelines.size).toBe(0);
      expect((engine as any).lastCompile).toBeNull();
      const fresh = new WebGPURenderingEngine(assets);
      const next = stubEngineInternals(fresh);
      await fresh.compileShaderPipeline("dispose source", null, "/workspace/dispose.slang");
      expect(next.compiler.compile).toHaveBeenCalledTimes(1);
    });

    it("does not commit a failed buffer update into the replay workspace", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { compiler } = stubEngineInternals(engine);
      const snapshot = workspace();
      const config: ShaderConfig = { version: "1", passes: { Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA" } } }, BufferA: { path: "passes/buffera.slang", inputs: {} } } };
      await engine.compileShaderPipeline(source, config, "/workspace/shaders/image.slang", { BufferA: "old buffer" }, undefined, undefined, snapshot);
      compiler.compile.mockReturnValueOnce({ success: false, errors: ["bad update"], diagnostics: [] });
      await engine.updateBufferAndRecompile("BufferA", "failed buffer");
      expect((engine as any).lastCompile.buffers.BufferA).toBe("old buffer");
      compiler.compile.mockClear();
      await engine.updateBufferAndRecompile("BufferA", "next buffer");
      const bufferRequest = compiler.compile.mock.calls.find(([request]: any[]) => request.options.passName === "BufferA")?.[0];
      expect(bufferRequest.source).toBe("next buffer");
      expect((engine as any).lastCompile.workspace).toEqual(expect.objectContaining({ rootUri: snapshot.rootUri }));
      expect((engine as any).lastCompile.workspace).not.toBe(snapshot);
    });

    it("commits a successful buffer replay and keeps its workspace defensive", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { compiler } = stubEngineInternals(engine);
      const snapshot = workspace();
      const config: ShaderConfig = { version: "1", passes: { Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA" } } }, BufferA: { path: "passes/buffera.slang", inputs: {} } } };
      await engine.compileShaderPipeline(source, config, "/workspace/shaders/image.slang", { BufferA: "old" }, undefined, undefined, snapshot);
      await engine.updateBufferAndRecompile("BufferA", "new");
      expect((engine as any).lastCompile.buffers.BufferA).toBe("new");
      const observed = compiler.compile.mock.calls.at(-1)[0].workspace;
      observed.files[0].source = "mutated observed request";
      await engine.updateBufferAndRecompile("BufferA", "newer");
      expect((engine as any).lastCompile.workspace.files[0].source).not.toBe("mutated observed request");
    });

    it("cannot let a superseded buffer replay overwrite the newer committed state", async () => {
      const engine = new WebGPURenderingEngine(assets);
      const { compiler } = stubEngineInternals(engine);
      const snapshot = workspace();
      const config: ShaderConfig = { version: "1", passes: { Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA" } } }, BufferA: { path: "passes/buffera.slang", inputs: {} } } };
      await engine.compileShaderPipeline(source, config, "/workspace/shaders/image.slang", { BufferA: "initial" }, undefined, undefined, snapshot);
      const old = deferred<any>();
      compiler.compile.mockImplementation((request: any) => request.source === "OLD" ? old.promise : { success: true, wgsl: "// new", diagnostics: [] });
      const pendingOld = engine.updateBufferAndRecompile("BufferA", "OLD");
      const newer = await engine.updateBufferAndRecompile("BufferA", "NEW");
      expect(newer?.success).toBe(true);
      old.resolve({ success: true, wgsl: "// old", diagnostics: [] });
      await expect(pendingOld).resolves.toEqual(expect.objectContaining({ success: false, superseded: true }));
      expect((engine as any).lastCompile.buffers.BufferA).toBe("NEW");
      expect((engine as any).lastCompile.workspace.rootUri).toBe(snapshot.rootUri);
    });

    it.each([
      "float4 mainImage(float2 c) { return 1; }",
      "#language slang legacy\nfloat4 mainImage(float2 c) { return 1; }",
      "#language slang 2025\nfloat4 mainImage(float2 c) { return 1; }",
      "#language slang 2026\nfloat4 mainImage(float2 c) { return 1; }",
      "#language slang latest\nfloat4 mainImage(float2 c) { return 1; }",
    ])("preserves the Slang version root request exactly", async (versionSource) => {
      const engine = new WebGPURenderingEngine(assets);
      const { compiler } = stubEngineInternals(engine);
      const snapshot = { rootUri: "file:///workspace/versions/root.slang", files: [{ path: "/workspace/versions/root.slang", uri: "file:///workspace/versions/root.slang", source: versionSource }] };
      const before = structuredClone(snapshot);
      await engine.compileShaderPipeline(versionSource, null, "/workspace/versions/root.slang", {}, undefined, undefined, snapshot);
      const request = compiler.compile.mock.calls[0][0];
      expect(request).toEqual(expect.objectContaining({ source: versionSource, sourcePath: "/workspace/versions/root.slang", sourceUri: "file:///workspace/versions/root.slang", options: expect.objectContaining({ passName: "Image" }) }));
      expect(request.workspace).toEqual(snapshot);
      expect(snapshot).toEqual(before);
    });
  });

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
      expect(compiler.compile).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ customUniforms: info }) }));
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
      expect(packed.byteLength).toBe(224);
      const view = new DataView(packed);
      expect(view.getFloat32(208, true)).toBeCloseTo(0.5);
      expect(view.getInt32(212, true)).toBe(1);
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

      const capturer = engine.createVariableCapturer();
      const context = engine.getVariableCaptureCompileContext(undefined, "BufferA");
      capturer.setCompileContext(context);

      expect(context).toMatchObject({
        slangPassName: "BufferA",
        slangChannels: [{ slot: 0, key: "iChannel0", kind: "texture" }],
      });
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
      expect(compiler.compile).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ channels: [{ slot: 0, key: "iChannel0", kind: "video" }] }) }));
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
      expect(compiler.compile).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ channels: [{ slot: 1, key: "iChannel1", kind: "audio" }] }) }));
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
      expect(uniforms.getFloat32(UNIFORM_OFFSETS.iChannelTime + 4, true)).toBeCloseTo(1.75);
      expect(uniforms.getFloat32(UNIFORM_OFFSETS.iChannelLoaded + 4, true)).toBe(1);
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
      expect(compiler.compile).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ channels: [{ slot: 0, key: "iChannel0", kind: "cubemap" }] }) }));
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
        Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA" } } },
        BufferA: { path: "buffer-a.slang", inputs: {} },
      },
    };

    async function compiledEngine() {
      const engine = new WebGPURenderingEngine(assets);
      const { device, compiler } = stubEngineInternals(engine);

      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(0); }",
        bufferConfig,
        "/image.slang",
        { BufferA: "float4 mainImage(float2 c) { return float4(1); }" },
      );
      expect(result?.success).toBe(true);
      return { engine, device, compiler };
    }

    it("recompiles the pipeline with the patched buffer content and returns success", async () => {
      const { engine, compiler } = await compiledEngine();
      compiler.compile.mockClear();

      const result = await engine.updateBufferAndRecompile(
        "BufferA",
        "float4 mainImage(float2 c) { return float4(9); }",
      );

      expect(result?.success).toBe(true);
      // Only BufferA's content changed; the per-pass compile cache reuses
      // Image's unchanged pipeline instead of recompiling it.
      expect(compiler.compile).toHaveBeenCalledTimes(1);
      expect(compiler.compile).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ source: expect.stringContaining("float4(9)"), options: expect.objectContaining({ passName: "BufferA" }) }),
      );
      expect(engine.getPasses().map((pass: { name: string }) => pass.name)).toEqual(["BufferA", "Image"]);
    });

    it("keeps the previous pipelines when the recompile fails", async () => {
      const { engine, device, compiler } = await compiledEngine();
      const pipelinesBefore = new Map((engine as any).passPipelines as Map<string, unknown>);
      compiler.compile.mockReturnValue({ success: false, errors: ["syntax error"] });

      const result = await engine.updateBufferAndRecompile("BufferA", "broken {");

      expect(result?.success).toBe(false);
      expect(result?.errors?.[0]).toMatch(/syntax error/);
      expect((engine as any).passPipelines).toEqual(pipelinesBefore);
      expect(engine.getPasses().map((pass: { name: string }) => pass.name)).toEqual(["BufferA", "Image"]);
      expect(device.createCommandEncoder).not.toHaveBeenCalled();
      expect(device.queue.submit).not.toHaveBeenCalled();
    });

    it("clears installed pipelines and the canvas when a different shader path fails", async () => {
      const { engine, device, compiler } = await compiledEngine();
      const installedPipelines = [...((engine as any).passPipelines as Map<string, SlangPassPipeline>).values()];
      const disposeSpies = installedPipelines.map((pipeline) => vi.spyOn(pipeline, "dispose"));
      const cleanupResources = vi.fn();
      (engine as any).resourceManager = { cleanup: cleanupResources };
      const cleanupTime = vi.spyOn(engine.getTimeManager(), "cleanup");
      compiler.compile.mockReturnValue({ success: false, errors: ["syntax error"] });

      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { broken syntax }",
        bufferConfig,
        "/different.slang",
        { BufferA: "broken {" },
      );

      expect(result?.success).toBe(false);
      expect(result?.errors?.[0]).toMatch(/syntax error/);
      expect(engine.getPasses().map((pass) => pass.name)).toEqual(["BufferA", "Image"]);
      expect((engine as any).passPipelines.size).toBeGreaterThan(0);
      for (const dispose of disposeSpies) {
        expect(dispose).not.toHaveBeenCalled();
      }
      expect(cleanupResources).not.toHaveBeenCalled();
      expect(cleanupTime).not.toHaveBeenCalled();
    });

    it("uses the updated content on subsequent updates too", async () => {
      const { engine, compiler } = await compiledEngine();

      await engine.updateBufferAndRecompile("BufferA", "float4 mainImage(float2 c) { return float4(7); }");
      compiler.compile.mockClear();
      await engine.updateBufferAndRecompile("BufferA", "float4 mainImage(float2 c) { return float4(8); }");

      expect(compiler.compile).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ source: expect.stringContaining("float4(8)"), options: expect.objectContaining({ passName: "BufferA" }) }),
      );
    });

    it("handles an unknown buffer name by recompiling without error", async () => {
      const { engine } = await compiledEngine();

      // The pass graph ignores buffers that no configured pass references.
      const result = await engine.updateBufferAndRecompile("BufferZ", "float4 mainImage(float2 c) { return float4(0); }");

      expect(result?.success).toBe(true);
      expect(engine.getPasses().map((pass: { name: string }) => pass.name)).toEqual(["BufferA", "Image"]);
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
        syncAllVideosToTime: vi.fn(),
        pauseAllVideos: vi.fn(),
        resumeAllVideos: vi.fn(),
      };
      (engine as any).resourceManager = resourceManager;
      return { engine, device, compiler, resourceManager };
    }

    it("loads a different shader's image and video into an isolated manager before atomically replacing the live manager", async () => {
      const { engine } = lifecycleEngine();
      const oldResources = (engine as any).resourceManager;
      (engine as any).shaderPath = "/first.slang";
      const candidate = {
        cleanup: vi.fn(),
        loadImageTexture: vi.fn(async () => ({})),
        loadVideoTexture: vi.fn(async () => ({ texture: {}, warning: undefined })),
        syncAllVideosToTime: vi.fn(),
        pauseAllVideos: vi.fn(),
        resumeAllVideos: vi.fn(),
      };
      const factory = vi.spyOn(engine as unknown as { createResourceManager(): unknown }, "createResourceManager")
        .mockReturnValue(candidate);
      const config: ShaderConfig = { version: "1", passes: { Image: { inputs: {
        iChannel0: { type: "texture", path: "next.png" },
        iChannel1: { type: "video", path: "next.mp4" },
      } } } };

      const compiling = engine.compileShaderPipeline(imageSource, config, "/second.slang", {});
      await vi.waitFor(() => expect(candidate.loadImageTexture).toHaveBeenCalledOnce());
      expect(oldResources.cleanup).not.toHaveBeenCalled();
      await expect(compiling).resolves.toMatchObject({ success: true });

      expect(candidate.loadVideoTexture).toHaveBeenCalledOnce();
      expect(oldResources.cleanup).toHaveBeenCalledOnce();
      expect(candidate.cleanup).not.toHaveBeenCalled();
      expect((engine as any).resourceManager).toBe(candidate);
      factory.mockRestore();
    });

    it("cleans a failed replacement candidate without touching the installed resources", async () => {
      const { engine, compiler } = lifecycleEngine();
      const oldResources = (engine as any).resourceManager;
      (engine as any).shaderPath = "/first.slang";
      const candidate = { cleanup: vi.fn(), loadImageTexture: vi.fn(async () => ({})) };
      vi.spyOn(engine as unknown as { createResourceManager(): unknown }, "createResourceManager")
        .mockReturnValue(candidate);
      compiler.compile.mockReturnValueOnce({ success: false, errors: ["broken"] });

      await expect(engine.compileShaderPipeline(imageSource, {
        version: "1", passes: { Image: { inputs: { iChannel0: { type: "texture", path: "broken.png" } } } },
      }, "/broken.slang", {})).resolves.toMatchObject({ success: false });

      expect(candidate.cleanup).toHaveBeenCalledOnce();
      expect(oldResources.cleanup).not.toHaveBeenCalled();
      expect((engine as any).resourceManager).toBe(oldResources);
    });

    it("commits a replacement when retiring its old resources throws", async () => {
      const { engine } = lifecycleEngine();
      const old = (engine as any).resourceManager;
      old.cleanup.mockImplementation(() => {
        throw new Error("retire");
      });
      (engine as any).shaderPath = "/first.slang";
      const candidate = { cleanup: vi.fn(), syncAllVideosToTime: vi.fn(), resumeAllVideos: vi.fn() };
      vi.spyOn(engine as unknown as { createResourceManager(): unknown }, "createResourceManager").mockReturnValue(candidate);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        await expect(engine.compileShaderPipeline(imageSource, null, "/second.slang", {})).resolves.toMatchObject({ success: true });
        expect((engine as any).resourceManager).toBe(candidate);
        expect((engine as any).shaderPath).toBe("/second.slang");
        expect(engine.getPasses()).toHaveLength(1);
        expect(candidate.cleanup).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it("keeps ordinary same-path recompiles on the live resource manager", async () => {
      const { engine } = lifecycleEngine();
      const live = (engine as any).resourceManager;
      (engine as any).shaderPath = "/same.slang";
      const factory = vi.spyOn(engine as unknown as { createResourceManager(): unknown }, "createResourceManager");

      await expect(engine.compileShaderPipeline(imageSource, null, "/same.slang", {})).resolves.toMatchObject({ success: true });

      expect(factory).not.toHaveBeenCalled();
      expect(live.cleanup).not.toHaveBeenCalled();
    });

    it("cleans an in-flight replacement candidate exactly once when disposed", async () => {
      const { engine } = lifecycleEngine();
      const oldResources = (engine as any).resourceManager;
      (engine as any).shaderPath = "/first.slang";
      const imageLoad = deferred<unknown>();
      const candidate = { cleanup: vi.fn(), loadImageTexture: vi.fn(() => imageLoad.promise) };
      vi.spyOn(engine as unknown as { createResourceManager(): unknown }, "createResourceManager")
        .mockReturnValue(candidate);
      const compiling = engine.compileShaderPipeline(imageSource, {
        version: "1", passes: { Image: { inputs: { iChannel0: { type: "texture", path: "late.png" } } } },
      }, "/second.slang", {});
      await vi.waitFor(() => expect(candidate.loadImageTexture).toHaveBeenCalledOnce());

      engine.dispose();
      imageLoad.resolve({});
      await expect(compiling).resolves.toMatchObject({ success: false, superseded: true });
      expect(oldResources.cleanup).toHaveBeenCalledOnce();
      expect(candidate.cleanup).toHaveBeenCalledOnce();
    });

    it("resets time and cleans resources when a different shader file compiles", async () => {
      const { engine, resourceManager } = lifecycleEngine();
      await engine.compileShaderPipeline(imageSource, lifecycleConfig, "/first.slang", {
        BufferA: bufferSource,
      });
      engine.render(1000);
      engine.render(1016);
      expect(engine.getTimeManager().getFrame()).toBeGreaterThan(0);
      resourceManager.cleanup.mockClear();

      const result = await engine.compileShaderPipeline(
        "float4 mainImage(float2 c) { return float4(0, 1, 0, 1); }",
        lifecycleConfig,
        "/second.slang",
        { BufferA: "float4 mainImage(float2 c) { return float4(2); }" },
      );

      expect(result?.success).toBe(true);
      expect(engine.getTimeManager().getFrame()).toBe(0);
      expect(resourceManager.cleanup).toHaveBeenCalledTimes(1);
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
      expect(engine.getPasses().map((pass) => pass.name)).toEqual(["BufferA", "Image"]);

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

    expect(bufferPipeline.rebuildBindGroup).toHaveBeenCalledWith([
      { slot: 0, textureView: { label: "bufferA-previous" } },
    ]);
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

    expect(imagePipeline.rebuildBindGroup).toHaveBeenCalledWith([
      { slot: 0, textureView: { label: "bufferA-current" } },
    ]);
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
    expect(imagePipeline.rebuildBindGroup).toHaveBeenNthCalledWith(1, [
      { slot: 0, textureView: { label: "initial-view" } },
    ]);

    bufferViewToggle = true;
    engine.render(1016);
    expect(imagePipeline.rebuildBindGroup).toHaveBeenNthCalledWith(2, [
      { slot: 0, textureView: { label: "swapped-view" } },
    ]);
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
      first.compiler.compile.mockImplementation((request: any) =>
        request.source === "buf cache failure"
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
      expect(second.compiler.compile).toHaveBeenCalledWith(expect.objectContaining({ source: "buf cache failure", options: expect.objectContaining({ passName: "BufferA" }) }));
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
      expect(second.compiler.compile).toHaveBeenCalledWith(expect.objectContaining({ source: "img channel cache", options: expect.objectContaining({ passName: "Image", channels: [{ slot: 1, key: "iChannel1", kind: "buffer" }] }) }));
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

      expect(second.compiler.compile).toHaveBeenCalledWith(expect.objectContaining({ source: "img channel kind cache", options: expect.objectContaining({ passName: "Image", channels: [{ slot: 0, key: "iChannel0", kind: "cubemap" }] }) }));
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
      expect(compiler.compile.mock.calls[0][0].source).toBe("buf v2");
      expect((engine as any).passPipelines.get("Image")).toBe(firstImage);
      expect(imageDispose).not.toHaveBeenCalled();
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

      compiler.compile.mockImplementation((request: any) =>
        request.source === "buf broken" ? { success: false, errors: ["bad"], diagnostics: [] } : { success: true, wgsl: "wgsl", diagnostics: [] });
      const result = await engine.compileShaderPipeline("img", twoPassConfig, "/s.slang", { BufferA: "buf broken" });

      expect(result?.success).toBe(false);
      expect(imageDispose).not.toHaveBeenCalled();
      expect((engine as any).passPipelines.get("Image")).toBe(firstImage);
      expect((engine as any).passPipelines.get("BufferA")).toBe(firstBufferA);
    });

    it("resizes reused pipelines to the new graph dimensions on success", async () => {
      const { engine, compiler } = cachedSetup();
      await engine.compileShaderPipeline("img", twoPassConfig, "/s.slang", { BufferA: "buf" });
      const image = (engine as any).passPipelines.get("Image");
      const resizeSpy = vi.spyOn(image, "resize");

      (engine as any).canvas = { width: 640, height: 360 };
      await engine.compileShaderPipeline("img", twoPassConfig, "/s.slang", { BufferA: "buf" });

      expect(resizeSpy).toHaveBeenCalledWith(640, 360);
      expect(compiler.compile).toHaveBeenCalledTimes(2); // only the first compile's two calls
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
        // A's own freshly-built BufferA pipeline (not the installed one, and
        // not the shared carried-over Image pipeline) was disposed.
        expect(disposeSpy.mock.instances).not.toContain(installedAfterB_BufferA);
        expect(disposeSpy.mock.instances).not.toContain(baselineImage);
        // Exactly two disposals happened: the baseline BufferA pipeline
        // (replaced when B installed) and A's own fresh BufferA pipeline
        // (discarded as superseded).
        expect(disposeSpy).toHaveBeenCalledTimes(2);
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
  });

  describe("dispose()", () => {
    interface DisposableEngineInternals {
      compiler: { dispose(): void } | null;
      inspectorReadbackBuffer: { destroy(): void } | null;
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
      expect(resources.cleanup).toHaveBeenCalledTimes(1);
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
      expect(resources.cleanup).toHaveBeenCalledTimes(1);
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
      const inspector = { destroy: vi.fn() };
      const firstPipeline = { dispose: vi.fn() };
      const secondPipeline = { dispose: vi.fn() };
      const resources = { cleanup: vi.fn() };
      const device = { destroy: vi.fn() };
      const engine = new WebGPURenderingEngine(assets);
      const internals = disposableInternals(engine);
      internals.compiler = compiler;
      internals.inspectorReadbackBuffer = inspector;
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
      expect(inspector.destroy).toHaveBeenCalledOnce();
      expect(firstPipeline.dispose).toHaveBeenCalledOnce();
      expect(secondPipeline.dispose).toHaveBeenCalledOnce();
      expect(resources.cleanup).toHaveBeenCalledOnce();
      expect(device.destroy).toHaveBeenCalledOnce();
      expect(internals.compiler).toBeNull();
      expect(internals.inspectorReadbackBuffer).toBeNull();
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
      const inspector = { destroy: vi.fn(() => {
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
      internals.inspectorReadbackBuffer = inspector;
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
      expect(inspector.destroy).toHaveBeenCalledOnce();
      expect(failedPipeline.dispose).toHaveBeenCalledOnce();
      expect(successfulPipeline.dispose).toHaveBeenCalledOnce();
      expect(resources.cleanup).toHaveBeenCalledOnce();
      expect(device.destroy).toHaveBeenCalledOnce();
      expect(internals).toMatchObject({
        compiler: null,
        inspectorReadbackBuffer: null,
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
      const rm = engine.getResourceManager()!;
      const loadSpy = vi.spyOn(rm, "loadImageTexture").mockResolvedValue({} as never);

      const result = await engine.compileShaderPipeline(IMAGE_SRC, textureConfig, "/s.slang", {});

      expect(result?.success).toBe(true);
      expect(loadSpy).toHaveBeenCalledWith("/abs/tex.png", {
        filter: "nearest",
        wrap: "clamp",
        vflip: false,
        grayscale: true,
      });
    });

    it("cleans cached texture resources on the next compile after flagReloadOnNextApply", async () => {
      const { engine } = compiledEngine();
      const rm = engine.getResourceManager()!;
      vi.spyOn(rm, "loadImageTexture").mockResolvedValue({} as never);
      await engine.compileShaderPipeline(IMAGE_SRC, textureConfig, "/s.slang", {});
      const cleanupSpy = vi.spyOn(rm, "cleanup");
      const candidate = new ResourceManager(new WebGPUTextureBackend((engine as any).device));
      const candidateLoad = vi.spyOn(candidate, "loadImageTexture").mockResolvedValue({} as never);
      vi.spyOn(engine as unknown as { createResourceManager(): unknown }, "createResourceManager").mockReturnValue(candidate);

      engine.flagReloadOnNextApply();
      const result = await engine.compileShaderPipeline(IMAGE_SRC, textureConfig, "/s.slang", {});

      expect(result?.success).toBe(true);
      expect(cleanupSpy).toHaveBeenCalledTimes(1);
      expect(candidateLoad).toHaveBeenCalledOnce();
      expect(engine.getResourceManager()).toBe(candidate);
    });

    it("renders using the cached texture handle's view and sampler", async () => {
      const { engine, device } = compiledEngine();
      const rm = engine.getResourceManager()!;
      const handle = { view: { tag: "texView" }, sampler: { tag: "texSampler" } };
      vi.spyOn(rm, "getImageTextureCache").mockReturnValue({ "/abs/tex.png": handle as never });

      const result = await engine.compileShaderPipeline(IMAGE_SRC, textureConfig, "/s.slang", {});
      expect(result?.success).toBe(true);
      engine.render(16);

      const bindCalls = (device.createBindGroup as ReturnType<typeof vi.fn>).mock.calls;
      const entries = bindCalls.at(-1)![0].entries;
      expect(entries).toContainEqual({ binding: 1, resource: handle.view });
      expect(entries).toContainEqual({ binding: 2, resource: handle.sampler });
    });

    it("falls back to the default texture when the load failed (cache miss)", async () => {
      const { engine, device } = compiledEngine();
      const rm = engine.getResourceManager()!;
      vi.spyOn(rm, "getImageTextureCache").mockReturnValue({});
      const def = { view: { tag: "defaultView" }, sampler: { tag: "defaultSampler" } };
      vi.spyOn(rm, "getDefaultTexture").mockReturnValue(def as never);

      const result = await engine.compileShaderPipeline(IMAGE_SRC, textureConfig, "/s.slang", {});
      expect(result?.success).toBe(true);
      engine.render(16);

      const entries = (device.createBindGroup as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0].entries;
      expect(entries).toContainEqual({ binding: 1, resource: def.view });
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
      expect(bufferPipeline.rebuildBindGroup).toHaveBeenCalledWith([
        { slot: 0, textureView: { label: "bufferA-previous" } },
      ]);
      expect(imagePipeline.rebuildBindGroup).toHaveBeenCalledWith([
        { slot: 0, textureView: { label: "bufferA-current" } },
        { slot: 1, textureView: textureHandle.view, sampler: textureHandle.sampler },
      ]);
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
