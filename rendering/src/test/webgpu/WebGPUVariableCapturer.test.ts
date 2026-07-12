import { describe, it, expect, vi } from "vitest";
import { WebGPUVariableCapturer } from "../../webgpu/WebGPUVariableCapturer";
import type { CaptureUniforms } from "../../capture/VariableCapturer";

const uniforms: CaptureUniforms = {
  time: 1,
  timeDelta: 0.016,
  frameRate: 60,
  frame: 12,
  res: [320, 180, 1],
  mouse: [0, 0, 0, 0],
  date: [0, 0, 0, 0],
  cameraPos: [0, 0, 0],
  cameraDir: [0, 0, -1],
};

interface MockGpu {
  device: GPUDevice;
  compiler: { compile: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> };
  writeBuffer: ReturnType<typeof vi.fn>;
  submit: ReturnType<typeof vi.fn>;
  copyTextureToBuffer: ReturnType<typeof vi.fn>;
  beginRenderPass: ReturnType<typeof vi.fn>;
  createdBuffers: Array<{ size: number; mapAsync: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }>;
  flushMaps: () => Promise<void>;
}

function mockGpu(readbackFloats?: (size: number) => Float32Array): MockGpu {
  const writeBuffer = vi.fn();
  const submit = vi.fn();
  const copyTextureToBuffer = vi.fn();
  const beginRenderPass = vi.fn(() => ({
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    draw: vi.fn(),
    end: vi.fn(),
  }));
  const createdBuffers: MockGpu["createdBuffers"] = [];
  const mapResolvers: Array<() => void> = [];

  const device = {
    queue: { writeBuffer, submit },
    createBuffer: vi.fn((desc: { size: number }) => {
      const data = readbackFloats?.(desc.size) ?? new Float32Array(desc.size / 4);
      const buffer = {
        size: desc.size,
        mapAsync: vi.fn(() => new Promise<void>((resolve) => { mapResolvers.push(resolve); })),
        getMappedRange: vi.fn(() => data.buffer),
        unmap: vi.fn(),
        destroy: vi.fn(),
      };
      createdBuffers.push(buffer);
      return buffer;
    }),
    createTexture: vi.fn(() => ({ createView: vi.fn(() => ({})), destroy: vi.fn() })),
    createShaderModule: vi.fn(() => ({})),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({})),
    createBindGroup: vi.fn(() => ({})),
    createSampler: vi.fn(() => ({})),
    createCommandEncoder: vi.fn(() => ({
      beginRenderPass,
      copyTextureToBuffer,
      finish: vi.fn(() => ({})),
    })),
  } as unknown as GPUDevice;

  const compiler = {
    compile: vi.fn(async () => ({ success: true as const, wgsl: "// wgsl" })),
    dispose: vi.fn(),
  };

  return {
    device,
    compiler,
    writeBuffer,
    submit,
    copyTextureToBuffer,
    beginRenderPass,
    createdBuffers,
    flushMaps: async () => {
      for (const resolve of mapResolvers.splice(0)) resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

const captures = [
  { varName: "uv", varType: "float2", captureShader: "shader-a", selectorIndex: 0 },
  { varName: "col", varType: "float3", captureShader: "shader-a", selectorIndex: 1 },
];

describe("WebGPUVariableCapturer", () => {
  it("compiles the capture shader once in captureMode and draws once per variable", async () => {
    const gpu = mockGpu();
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, { commonCode: "" });

    const issued = await capturer.issueCaptureGrid(captures, uniforms, 8, 4);

    expect(issued).toBe(2);
    expect(gpu.compiler.compile).toHaveBeenCalledTimes(1);
    expect(gpu.compiler.compile).toHaveBeenCalledWith("shader-a", expect.objectContaining({
      captureMode: true,
      passName: "capture",
    }));
    expect(gpu.beginRenderPass).toHaveBeenCalledTimes(2);
    expect(gpu.copyTextureToBuffer).toHaveBeenCalledTimes(2);
  });

  it("passes the pass channels into the capture compile", async () => {
    const gpu = mockGpu();
    const channels = [{ slot: 0, key: "iChannel0" }];
    const capturer = new WebGPUVariableCapturer(
      gpu.device,
      gpu.compiler,
      { commonCode: "", slangChannels: channels },
      () => [{ slot: 0, textureView: {} as GPUTextureView }],
    );

    await capturer.issueCaptureGrid(captures, uniforms, 8, 4);

    expect(gpu.compiler.compile).toHaveBeenCalledWith("shader-a", expect.objectContaining({
      channels,
    }));
  });

  it("reports an error and issues nothing when channels cannot resolve", async () => {
    const gpu = mockGpu();
    const capturer = new WebGPUVariableCapturer(
      gpu.device,
      gpu.compiler,
      { commonCode: "", slangChannels: [{ slot: 0, key: "iChannel0" }] },
      () => null,
    );

    const issued = await capturer.issueCaptureGrid(captures, uniforms, 8, 4);

    expect(issued).toBe(0);
    expect(capturer.getLastError()).toMatch(/channels/i);
  });

  it("records the compile error and issues nothing when compilation fails", async () => {
    const gpu = mockGpu();
    gpu.compiler.compile.mockResolvedValue({ success: false, errors: ["boom"] });
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, {});

    const issued = await capturer.issueCaptureGrid(captures, uniforms, 8, 4);

    expect(issued).toBe(0);
    expect(capturer.getLastError()).toBe("boom");
  });

  it("collectResults returns only captures whose mapping resolved, with tight rows", async () => {
    // 8 wide → 128 bytes/row padded to 256; fill row starts with row index.
    const gpu = mockGpu((size) => {
      const data = new Float32Array(size / 4);
      const strideFloats = 256 / 4;
      for (let row = 0; row < size / 256; row++) {
        for (let i = 0; i < 8 * 4; i++) {
          data[row * strideFloats + i] = row + i / 100;
        }
      }
      return data;
    });
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, {});

    await capturer.issueCaptureGrid(captures, uniforms, 8, 4);
    expect(capturer.collectResults()).toEqual([]);

    await gpu.flushMaps();
    const results = capturer.collectResults();

    expect(results).toHaveLength(2);
    expect(results[0].varName).toBe("uv");
    expect(results[0].rgba).toHaveLength(8 * 4 * 4);
    // Row 1 starts at tight offset 32 and carries the row marker
    expect(results[0].rgba[32]).toBeCloseTo(1);
    expect(results[1].varName).toBe("col");
  });

  it("writes the selector index per draw into the capture uniforms", async () => {
    const gpu = mockGpu();
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, {});

    await capturer.issueCaptureGrid(captures, uniforms, 8, 4);

    // writeBuffer calls: 1 shadertoy uniforms + 2 capture uniform writes
    const captureWrites = gpu.writeBuffer.mock.calls.filter(
      (call) => (call[2] as ArrayBuffer).byteLength === 32,
    );
    expect(captureWrites).toHaveLength(2);
    const first = new Int32Array(captureWrites[0][2] as ArrayBuffer);
    const second = new Int32Array(captureWrites[1][2] as ArrayBuffer);
    expect(first[4]).toBe(0);
    expect(second[4]).toBe(1);
    // Grid mode
    expect(first[5]).toBe(0);
  });

  it("pixel mode flips Y into ShaderToy fragCoord space and sets isPixelMode", async () => {
    const gpu = mockGpu();
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, {});

    await capturer.issueCaptureAtPixel(captures.slice(0, 1), 10, 20, 320, 180, uniforms);

    const captureWrites = gpu.writeBuffer.mock.calls.filter(
      (call) => (call[2] as ArrayBuffer).byteLength === 32,
    );
    const f32 = new Float32Array(captureWrites[0][2] as ArrayBuffer);
    const i32 = new Int32Array(captureWrites[0][2] as ArrayBuffer);
    expect(f32[0]).toBeCloseTo(10.5);
    expect(f32[1]).toBeCloseTo(180 - 20 - 1 + 0.5);
    expect(i32[5]).toBe(1);
  });

  it("cancelPendingCaptures destroys outstanding readback buffers", async () => {
    const gpu = mockGpu();
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, {});

    await capturer.issueCaptureGrid(captures, uniforms, 8, 4);
    capturer.cancelPendingCaptures();

    const readbacks = gpu.createdBuffers.filter((b) => b.size >= 256);
    expect(readbacks.length).toBeGreaterThan(0);
    for (const buffer of readbacks) {
      expect(buffer.destroy).toHaveBeenCalled();
    }
    await gpu.flushMaps();
    expect(capturer.collectResults()).toEqual([]);
  });

  it("invalidates the pipeline cache when the compile context changes", async () => {
    const gpu = mockGpu();
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, { commonCode: "a" });

    await capturer.issueCaptureGrid(captures, uniforms, 8, 4);
    expect(gpu.compiler.compile).toHaveBeenCalledTimes(1);

    await capturer.issueCaptureGrid(captures, uniforms, 8, 4);
    expect(gpu.compiler.compile).toHaveBeenCalledTimes(1); // cached

    capturer.setCompileContext({ commonCode: "b" });
    await capturer.issueCaptureGrid(captures, uniforms, 8, 4);
    expect(gpu.compiler.compile).toHaveBeenCalledTimes(2);
  });

  it("stops issuing when shouldContinue flips false", async () => {
    const gpu = mockGpu();
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, {});
    let calls = 0;

    const issued = await capturer.issueCaptureGrid(captures, uniforms, 8, 4, () => calls++ < 1);

    expect(issued).toBeLessThan(2);
  });
});

describe("WebGPURenderingEngine capture wiring", () => {
  it("createVariableCapturer throws a clear error before initialization", async () => {
    const { WebGPURenderingEngine } = await import("../../webgpu/WebGPURenderingEngine");
    const engine = new WebGPURenderingEngine({ scriptUrl: "s.js", wasmUrl: "s.wasm" });
    expect(() => engine.createVariableCapturer()).toThrow(/initialized/i);
  });

  it("reports slang as its shader language", async () => {
    const { WebGPURenderingEngine } = await import("../../webgpu/WebGPURenderingEngine");
    const engine = new WebGPURenderingEngine({ scriptUrl: "s.js", wasmUrl: "s.wasm" });
    expect(engine.getShaderLanguage()).toBe("slang");
  });

  it("exposes the Image pass channels in the capture compile context", async () => {
    const { WebGPURenderingEngine } = await import("../../webgpu/WebGPURenderingEngine");
    const engine = new WebGPURenderingEngine({ scriptUrl: "s.js", wasmUrl: "s.wasm" });
    (engine as any).passGraph = [
      { name: "BufferA", source: "a", output: "texture", width: 1, height: 1, channels: [] },
      {
        name: "Image", source: "i", output: "canvas", width: 1, height: 1,
        channels: [{ slot: 0, key: "iChannel0", source: "BufferA", readFrom: "current-frame" }],
      },
    ];
    (engine as any).lastCompile = { code: "i", path: "/i.slang", buffers: { common: "float x;" } };

    const context = engine.getVariableCaptureCompileContext();

    expect(context.commonCode).toBe("float x;");
    expect(context.slangChannels).toEqual([{ slot: 0, key: "iChannel0" }]);
  });

  it("derives Image pass capture channels from compile inputs before the live pass graph is installed", async () => {
    const { WebGPURenderingEngine } = await import("../../webgpu/WebGPURenderingEngine");
    const engine = new WebGPURenderingEngine({ scriptUrl: "s.js", wasmUrl: "s.wasm" });
    const imageCode = `
float4 mainImage(float2 fragCoord) {
  float2 uv = fragCoord / iResolution.xy;
  float3 sharp = sampleIChannel0(uv).rgb;
  float3 glow = sampleIChannel1(uv).rgb;
  return float4(sharp + glow, 1.0);
}`;
    (engine as any).canvas = { width: 1340, height: 753 };
    (engine as any).currentConfig = {
      passes: {
        BufferA: {},
        BufferB: {},
        Image: {
          inputs: {
            iChannel0: { type: "buffer", source: "BufferA" },
            iChannel1: { type: "buffer", source: "BufferB" },
          },
        },
      },
    };
    (engine as any).lastCompile = {
      code: imageCode,
      path: "/slang-multipass-test/flow.slang",
      buffers: {
        BufferA: "float4 mainImage(float2 fragCoord) { return float4(0.0); }",
        BufferB: "float4 mainImage(float2 fragCoord) { return float4(0.0); }",
      },
    };
    (engine as any).passGraph = [];

    const context = engine.getVariableCaptureCompileContext(imageCode, "Image");

    expect(context.slangChannels).toEqual([
      { slot: 0, key: "iChannel0" },
      { slot: 1, key: "iChannel1" },
    ]);
  });
});
