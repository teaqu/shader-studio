import { describe, it, expect, vi } from "vitest";
import { WebGPURenderingEngine } from "../../webgpu/WebGPURenderingEngine";
import { SlangPassPipeline } from "../../webgpu/SlangPassPipeline";
import { TimeManager } from "../../util/TimeManager";

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

  it("render() is a safe no-op before a pipeline exists", () => {
    const engine = new WebGPURenderingEngine(assets);
    engine.initialize(noWebGpuCanvas());
    expect(() => engine.render(0)).not.toThrow();
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
    expect(engine.readPixel()).toBeNull();
    expect(engine.getAudioFFTData()).toBeNull();
  });

  it("throws a clear error if variable capture is attempted", () => {
    const engine = new WebGPURenderingEngine(assets);
    expect(() => engine.createVariableCapturer()).toThrow(/not supported/i);
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
      createBuffer: vi.fn(() => ({})),
      createSampler: vi.fn(() => ({})),
      createBindGroup: vi.fn(() => ({})),
      createTexture: vi.fn(() => ({
        createView: vi.fn(() => ({})),
        destroy: vi.fn(),
      })),
    };
    const compiler = {
      compileImagePass: vi.fn(() => ({ success: true, wgsl: "// wgsl" })),
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
    expect(compiler.compileImagePass).toHaveBeenCalledTimes(2);
    expect(compiler.compileImagePass).toHaveBeenNthCalledWith(1, expect.stringContaining("float4(1)"), {
      passName: "BufferA",
      commonCode: "",
      channels: [],
    });
    expect(compiler.compileImagePass).toHaveBeenNthCalledWith(2, expect.stringContaining("float4(0)"), {
      passName: "Image",
      commonCode: "",
      channels: [{ slot: 0, key: "iChannel0" }],
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
    const compiler = { compileImagePass: vi.fn() };

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
    expect(compiler.compileImagePass).not.toHaveBeenCalled();
    expect(device.createShaderModule).not.toHaveBeenCalled();
    expect(engine.getPasses()).toEqual([]);
  });

  it("disposes discarded pass pipelines on recompile", async () => {
    const engine = new WebGPURenderingEngine(assets);
    const device = {
      createShaderModule: vi.fn(() => ({ getCompilationInfo: vi.fn(async () => ({ messages: [] })) })),
      createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: vi.fn(() => ({})) })),
      createBuffer: vi.fn(() => ({})),
      createSampler: vi.fn(() => ({})),
      createBindGroup: vi.fn(() => ({})),
      createTexture: vi.fn(() => ({
        createView: vi.fn(() => ({})),
        destroy: vi.fn(),
      })),
    };
    const compiler = {
      compileImagePass: vi.fn(() => ({ success: true, wgsl: "// wgsl" })),
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

    await engine.compileShaderPipeline(
      "float4 mainImage(float2 c) { return float4(2); }",
      config,
      "/image.slang",
      buffers,
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
      createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
      createSampler: vi.fn(() => ({})),
      createBindGroup: vi.fn(() => ({})),
      createTexture: vi.fn(() => ({
        createView: vi.fn(() => ({})),
        destroy: vi.fn(),
      })),
    };
    const compiler = {
      compileImagePass: vi.fn(() => ({ success: true, wgsl: "// wgsl" })),
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
      createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
      createSampler: vi.fn(() => ({})),
      createBindGroup: vi.fn(() => ({})),
      createTexture: vi.fn(() => ({
        createView: vi.fn(() => ({})),
        destroy: vi.fn(),
      })),
    };
    const compiler = {
      compileImagePass: vi
        .fn()
        .mockReturnValueOnce({ success: true, wgsl: "// wgsl" }) // BufferA builds fine
        .mockReturnValueOnce({ success: false, errors: ["bad shader"] }), // Image fails
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
      createBuffer: vi.fn(() => ({})),
      createSampler: vi.fn(() => ({})),
      createBindGroup: vi.fn(() => ({})),
      createTexture: vi.fn(() => ({
        createView: vi.fn(() => ({})),
        destroy: vi.fn(),
      })),
    };
    const compiler = {
      compileImagePass: vi.fn(() => ({ success: true, wgsl: "// wgsl" })),
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
          Image: { inputs: { iChannel0: { type: "texture", source: "foo" } } },
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

  describe("handleCanvasResize", () => {
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
    }

    async function compiledEngine() {
      const engine = new WebGPURenderingEngine(assets);
      const device = fullDevice();
      const compiler = { compileImagePass: vi.fn(() => ({ success: true, wgsl: "// wgsl" })) };
      const canvas = { width: 320, height: 180 };

      (engine as any).canvas = canvas;
      (engine as any).device = device;
      (engine as any).compiler = compiler;
      (engine as any).format = "bgra8unorm";
      (engine as any).context = {
        getCurrentTexture: () => ({ createView: () => ({ label: "canvas" }) }),
      };

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

    it("is a safe no-op before any compile", () => {
      const engine = new WebGPURenderingEngine(assets);
      (engine as any).canvas = { width: 320, height: 180 };
      expect(() => engine.handleCanvasResize(640, 360)).not.toThrow();
      expect((engine as any).canvas.width).toBe(640);
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
        channels: [{ slot: 0, key: "iChannel0", source: "BufferA", readFrom: "previous-frame" }],
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
        channels: [{ slot: 0, key: "iChannel0", source: "BufferA", readFrom: "current-frame" }],
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
          { slot: 0, key: "iChannel0", source: "BufferA", readFrom: "current-frame" },
          { slot: 1, key: "iChannel1", source: "BufferB", readFrom: "current-frame" },
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
        channels: [{ slot: 0, key: "iChannel0", source: "BufferA", readFrom: "previous-frame" }],
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
});
