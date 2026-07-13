import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { ShaderConfig } from "@shader-studio/types";
import { WebGPURenderingEngine } from "../../webgpu/WebGPURenderingEngine";
import { SlangPassPipeline } from "../../webgpu/SlangPassPipeline";
import { sharedSlangWgslCache } from "../../webgpu/SlangWgslCache";
import { TimeManager } from "../../util/TimeManager";
import { ResourceManager } from "../../resources/ResourceManager";
import { WebGPUTextureBackend } from "../../webgpu/WebGPUTextureBackend";

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

  /** Engine with a BufferA→Image pass graph, stubbed device, and a controllable mouse. */
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

    return { engine, bufferPipeline, imagePipeline, mouse };
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

  it("remembers the config from the last compile", async () => {
    const engine = new WebGPURenderingEngine(assets);
    engine.initialize(noWebGpuCanvas());
    const config = { passes: {} } as never;
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
    expect(compiler.compile).toHaveBeenNthCalledWith(1, expect.stringContaining("float4(1)"), {
      passName: "BufferA",
      commonCode: "",
      channels: [],
    });
    expect(compiler.compile).toHaveBeenNthCalledWith(2, expect.stringContaining("float4(0)"), {
      passName: "Image",
      commonCode: "",
      channels: [{ slot: 0, key: "iChannel0", kind: "buffer" }],
    });
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
          Image: { inputs: { iChannel0: { type: "audio", path: "foo.mp3" } } },
        },
      },
      "/image.slang",
      {},
    );

    expect(result?.success).toBe(true);
    expect(result?.warnings?.[0]).toMatch(/unsupported/i);
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

    it("falls back to the default texture when a cubemap texture cache lookup misses", async () => {
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

      expect(resourceManager.getDefaultTexture).toHaveBeenCalled();
      expect(device.createBindGroup.mock.calls[0][0].entries).toEqual([
        { binding: 0, resource: { buffer: expect.anything() } },
        { binding: 1, resource: defaultHandle.view },
        { binding: 2, resource: defaultHandle.sampler },
      ]);
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
        expect.stringContaining("float4(9)"),
        expect.objectContaining({ passName: "BufferA" }),
      );
      expect(engine.getPasses().map((pass: { name: string }) => pass.name)).toEqual(["BufferA", "Image"]);
    });

    it("keeps the previous pipelines when the recompile fails", async () => {
      const { engine, compiler } = await compiledEngine();
      const pipelinesBefore = new Map((engine as any).passPipelines as Map<string, unknown>);
      compiler.compile.mockReturnValue({ success: false, errors: ["syntax error"] });

      const result = await engine.updateBufferAndRecompile("BufferA", "broken {");

      expect(result?.success).toBe(false);
      expect(result?.errors?.[0]).toMatch(/syntax error/);
      expect((engine as any).passPipelines).toEqual(pipelinesBefore);
      expect(engine.getPasses().map((pass: { name: string }) => pass.name)).toEqual(["BufferA", "Image"]);
    });

    it("uses the updated content on subsequent updates too", async () => {
      const { engine, compiler } = await compiledEngine();

      await engine.updateBufferAndRecompile("BufferA", "float4 mainImage(float2 c) { return float4(7); }");
      compiler.compile.mockClear();
      await engine.updateBufferAndRecompile("BufferA", "float4 mainImage(float2 c) { return float4(8); }");

      expect(compiler.compile).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining("float4(8)"),
        expect.objectContaining({ passName: "BufferA" }),
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
        channels: [{ slot: 1, key: "iChannel1", kind: "buffer" }],
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

    it("cleans cached texture resources on the next compile after flagForceCleanupOnNextApply", async () => {
      const { engine } = compiledEngine();
      const rm = engine.getResourceManager()!;
      const loadSpy = vi.spyOn(rm, "loadImageTexture").mockResolvedValue({} as never);
      const cleanupSpy = vi.spyOn(rm, "cleanup");

      engine.flagForceCleanupOnNextApply();
      const result = await engine.compileShaderPipeline(IMAGE_SRC, textureConfig, "/s.slang", {});

      expect(result?.success).toBe(true);
      expect(cleanupSpy).toHaveBeenCalledTimes(1);
      expect(cleanupSpy.mock.invocationCallOrder[0]).toBeLessThan(loadSpy.mock.invocationCallOrder[0]);
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
