import { describe, it, expect, vi } from "vitest";
import { WebGPUVariableCapturer } from "../../webgpu/WebGPUVariableCapturer";
import type { CaptureUniforms } from "../../capture/VariableCapturer";
import { UNIFORM_OFFSETS } from "../../webgpu/SlangPrelude";

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
  createBindGroup: ReturnType<typeof vi.fn>;
  createdBuffers: Array<{ size: number; mapAsync: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }>;
  flushMaps: () => Promise<void>;
}

function mockGpu(readbackFloats?: (size: number) => Float32Array): MockGpu {
  const writeBuffer = vi.fn();
  const submit = vi.fn();
  const copyTextureToBuffer = vi.fn();
  const createBindGroup = vi.fn(() => ({}));
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
        mapAsync: vi.fn(() => new Promise<void>((resolve) => {
          mapResolvers.push(resolve);
        })),
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
    createBindGroup,
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
    createBindGroup,
    createdBuffers,
    flushMaps: async () => {
      for (const resolve of mapResolvers.splice(0)) {
        resolve();
      }
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
  it("packs date, channel resolutions, and custom values for capture shaders", async () => {
    const gpu = mockGpu();
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler);
    capturer.setCustomUniforms("uniform vec3 tint;\nuniform bool enabled;", [
      { name: "tint", type: "vec3", value: [0.25, 0.5, 0.75] },
      { name: "enabled", type: "bool", value: true },
    ]);

    await capturer.issueCaptureGrid(captures.slice(0, 1), {
      ...uniforms,
      date: [2026, 7, 19, 123],
      channelResolution: [512, 2, 1, 0, 0, 0, 0, 0, 0, 256, 3, 1],
      cameraPos: [1, 2, 3],
      cameraDir: [0.25, 0.5, -0.75],
    } as CaptureUniforms, 8, 4);

    expect(gpu.compiler.compile).toHaveBeenCalledWith(expect.objectContaining({
      source: "shader-a",
      options: expect.objectContaining({ customUniforms: [
        { name: "tint", type: "vec3" },
        { name: "enabled", type: "bool" },
      ] }),
    }));
    const packed = gpu.writeBuffer.mock.calls[0][2] as ArrayBuffer;
    expect(packed.byteLength).toBeGreaterThan(UNIFORM_OFFSETS.iChannelResolution + 64);
    const values = new DataView(packed);
    expect(values.getFloat32(UNIFORM_OFFSETS.iDate, true)).toBe(2026);
    expect(values.getFloat32(UNIFORM_OFFSETS.iChannelResolution, true)).toBe(512);
    expect(values.getFloat32(UNIFORM_OFFSETS.iCameraPos + 8, true)).toBe(3);
    expect(values.getFloat32(UNIFORM_OFFSETS.iCameraDir + 8, true)).toBe(-0.75);
    expect(values.getFloat32(208, true)).toBeCloseTo(0.25);
    expect(values.getInt32(220, true)).toBe(1);
  });

  it("packs provided channel timing, loaded state, and sample rate", async () => {
    const gpu = mockGpu();
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler);
    const audioUniforms = {
      ...uniforms,
      channelTime: [0, 1.75, 0, 0],
      channelLoaded: [0, 1, 0, 0],
      sampleRate: 48000,
    };

    await capturer.issueCaptureGrid(captures, audioUniforms, 8, 4);

    const packed = gpu.writeBuffer.mock.calls[0][2] as ArrayBuffer;
    const view = new DataView(packed);
    expect(view.getFloat32(UNIFORM_OFFSETS.iChannelTime + 4, true)).toBeCloseTo(1.75);
    expect(view.getFloat32(UNIFORM_OFFSETS.iChannelLoaded + 4, true)).toBe(1);
    expect(view.getFloat32(UNIFORM_OFFSETS.iSampleRate, true)).toBe(48000);
  });

  it("compiles the capture shader once in captureMode and draws once per variable", async () => {
    const gpu = mockGpu();
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, { commonCode: "" });

    const issued = await capturer.issueCaptureGrid(captures, uniforms, 8, 4);

    expect(issued).toBe(2);
    expect(gpu.compiler.compile).toHaveBeenCalledTimes(1);
    expect(gpu.compiler.compile).toHaveBeenCalledWith(expect.objectContaining({
      source: "shader-a",
      options: expect.objectContaining({ captureMode: true, passName: "capture" }),
    }));
    expect(gpu.beginRenderPass).toHaveBeenCalledTimes(2);
    expect(gpu.copyTextureToBuffer).toHaveBeenCalledTimes(2);
  });

  it("replaces only the selected root in the workspace and preserves imported dependencies", async () => {
    const gpu = mockGpu();
    const workspace = {
      rootUri: "file:///project",
      files: [
        { uri: "file:///project/image.slang", path: "/workspace/image.slang", source: "original root" },
        { uri: "file:///project/palette.slang", path: "/workspace/palette.slang", source: "module palette;" },
      ],
    };
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, {
      sourceUri: "file:///project/image.slang",
      sourcePath: "/workspace/image.slang",
      workspace,
      slangPassName: "Image",
    });

    await capturer.issueCaptureGrid(captures.slice(0, 1), uniforms, 8, 4);

    expect(gpu.compiler.compile).toHaveBeenCalledWith(expect.objectContaining({
      source: "shader-a",
      sourceUri: "file:///project/image.slang",
      sourcePath: "/workspace/image.slang",
      workspace: {
        rootUri: "file:///project",
        files: [
          { uri: "file:///project/image.slang", path: "/workspace/image.slang", source: "shader-a" },
          { uri: "file:///project/palette.slang", path: "/workspace/palette.slang", source: "module palette;" },
        ],
      },
      options: expect.objectContaining({ passName: "Image" }),
    }));
  });

  it("passes the pass channels into the capture compile", async () => {
    const gpu = mockGpu();
    const channels = [{ slot: 0, key: "iChannel0", kind: "cubemap" as const }];
    const capturer = new WebGPUVariableCapturer(
      gpu.device,
      gpu.compiler,
      { commonCode: "", slangChannels: channels },
      () => [{ slot: 0, textureView: {} as GPUTextureView }],
    );

    await capturer.issueCaptureGrid(captures, uniforms, 8, 4);

    expect(gpu.compiler.compile).toHaveBeenCalledWith(expect.objectContaining({
      source: "shader-a",
      options: expect.objectContaining({ channels }),
    }));
  });

  it("declares cubemap capture channels with a cube texture view dimension", async () => {
    const gpu = mockGpu();
    const capturer = new WebGPUVariableCapturer(
      gpu.device,
      gpu.compiler,
      { slangChannels: [{ slot: 0, key: "iChannel0", kind: "cubemap" }] },
      () => [{ slot: 0, textureView: {} as GPUTextureView }],
    );

    await capturer.issueCaptureGrid(captures, uniforms, 8, 4);

    const createLayout = gpu.device.createBindGroupLayout as ReturnType<typeof vi.fn>;
    expect(createLayout.mock.calls[0][0].entries).toContainEqual({
      binding: 1,
      visibility: 2,
      texture: { sampleType: "float", viewDimension: "cube" },
    });
  });

  it("binds a channel resource's own sampler when provided", async () => {
    const gpu = mockGpu();
    const textureView = { tag: "textureView" } as unknown as GPUTextureView;
    const sampler = { tag: "textureSampler" } as unknown as GPUSampler;
    const capturer = new WebGPUVariableCapturer(
      gpu.device,
      gpu.compiler,
      { commonCode: "", slangChannels: [{ slot: 0, key: "iChannel0" }] },
      () => [{ slot: 0, textureView, sampler }],
    );

    await capturer.issueCaptureGrid(captures, uniforms, 8, 4);

    const entries = gpu.createBindGroup.mock.calls.at(-1)![0].entries;
    expect(entries).toContainEqual({ binding: 1, resource: textureView });
    expect(entries).toContainEqual({ binding: 2, resource: sampler });
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
    expect(gpu.compiler.compile).toHaveBeenCalledTimes(1);
  });

  it("preserves structured compiler diagnostics and clears them with the legacy error", async () => {
    const gpu = mockGpu();
    const diagnostic = {
      uri: "file:///project/helper.slang",
      range: { start: { line: 2, character: 1 }, end: { line: 2, character: 4 } },
      severity: "error" as const,
      code: "E123",
      message: "bad helper",
      source: "slang-compile" as const,
      passName: "Image",
    };
    gpu.compiler.compile.mockResolvedValue({ success: false, errors: ["boom"], diagnostics: [diagnostic] });
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, {});

    await capturer.issueCaptureGrid(captures, uniforms, 8, 4);

    expect(capturer.getLastDiagnostics()).toEqual([diagnostic]);
    capturer.clearLastError();
    expect(capturer.getLastError()).toBeNull();
    expect(capturer.getLastDiagnostics()).toEqual([]);
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

  it("invalidates the capture pipeline when an imported workspace dependency changes", async () => {
    const gpu = mockGpu();
    const makeContext = (helperSource: string) => ({
      sourceUri: "file:///project/image.slang",
      sourcePath: "/workspace/image.slang",
      workspace: {
        rootUri: "file:///project",
        files: [
          { uri: "file:///project/image.slang", path: "/workspace/image.slang", source: "root" },
          { uri: "file:///project/helper.slang", path: "/workspace/helper.slang", source: helperSource },
        ],
      },
    });
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, makeContext("one"));

    await capturer.issueCaptureGrid(captures.slice(0, 1), uniforms, 8, 4);
    capturer.setCompileContext(makeContext("two"));
    await capturer.issueCaptureGrid(captures.slice(0, 1), uniforms, 8, 4);

    expect(gpu.compiler.compile).toHaveBeenCalledTimes(2);
  });

  it("automatically uses the last-good compatible pipeline when a newer dependency compile fails", async () => {
    const gpu = mockGpu();
    const makeContext = (helperSource: string) => ({
      sourceUri: "file:///project/image.slang",
      sourcePath: "/workspace/image.slang",
      workspace: {
        rootUri: "file:///project",
        files: [
          { uri: "file:///project/image.slang", path: "/workspace/image.slang", source: "root" },
          { uri: "file:///project/helper.slang", path: "/workspace/helper.slang", source: helperSource },
        ],
      },
    });
    const good = makeContext("good");
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, good);
    await capturer.issueCaptureGrid(captures.slice(0, 1), uniforms, 8, 4);

    gpu.compiler.compile.mockResolvedValueOnce({ success: false, errors: ["helper.slang: bad dependency"] });
    capturer.setCompileContext(makeContext("bad"));
    expect(await capturer.issueCaptureGrid(captures.slice(0, 1), uniforms, 8, 4)).toBe(1);

    gpu.compiler.compile.mockResolvedValueOnce({ success: true, wgsl: "// fixed", diagnostics: [] });
    capturer.setCompileContext(makeContext("fixed"));
    expect(await capturer.issueCaptureGrid(captures.slice(0, 1), uniforms, 8, 4)).toBe(1);
    expect(gpu.compiler.compile).toHaveBeenCalledTimes(3);
  });

  it.each([
    "createShaderModule",
    "createBindGroupLayout",
    "createPipelineLayout",
    "createRenderPipeline",
  ] as const)("uses the last-good compatible pipeline when %s rejects a rebuilt dependency", async (stage) => {
    const gpu = mockGpu();
    const makeContext = (helperSource: string) => ({
      sourceUri: "file:///project/image.slang",
      sourcePath: "/workspace/image.slang",
      slangPassName: "Image",
      workspace: {
        rootUri: "file:///project",
        files: [
          { uri: "file:///project/image.slang", path: "/workspace/image.slang", source: "root" },
          { uri: "file:///project/helper.slang", path: "/workspace/helper.slang", source: helperSource },
        ],
      },
    });
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, makeContext("good"));
    await capturer.issueCaptureGrid(captures.slice(0, 1), uniforms, 8, 4);
    const failingStage = gpu.device[stage] as ReturnType<typeof vi.fn>;
    failingStage.mockImplementationOnce(() => {
      throw new Error(`${stage} failed`);
    });
    capturer.setCompileContext(makeContext("changed"));

    expect(await capturer.issueCaptureGrid(captures.slice(0, 1), uniforms, 8, 4)).toBe(1);
    expect(capturer.getLastError()).toBe(`${stage} failed`);
    expect(capturer.getLastDiagnostics()).toEqual([expect.objectContaining({
      uri: "file:///project/image.slang",
      source: "webgpu",
      passName: "Image",
      message: `${stage} failed`,
    })]);
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
        channels: [{
          kind: "buffer", slot: 0, key: "iChannel0", source: "BufferA", readFrom: "current-frame",
        }],
      },
    ];
    (engine as any).lastCompile = { code: "i", path: "/i.slang", buffers: { common: "float x;" } };

    const context = engine.getVariableCaptureCompileContext();

    expect(context.commonCode).toBe("float x;");
    expect(context.slangChannels).toEqual([{ slot: 0, key: "iChannel0", kind: "buffer" }]);
  });

  it("exposes canonical source identity and workspace for the selected capture pass", async () => {
    const { WebGPURenderingEngine } = await import("../../webgpu/WebGPURenderingEngine");
    const engine = new WebGPURenderingEngine({ scriptUrl: "s.js", wasmUrl: "s.wasm" });
    const workspace = {
      rootUri: "file:///project",
      files: [
        { uri: "file:///project/image.slang", path: "/workspace/image.slang", source: "image" },
        { uri: "file:///project/helper.slang", path: "/workspace/helper.slang", source: "helper" },
      ],
    };
    (engine as any).passGraph = [
      { name: "Image", path: "image.slang", source: "image", output: "canvas", width: 1, height: 1, channels: [] },
    ];
    (engine as any).lastCompile = { code: "image", path: "/project/image.slang", buffers: {}, workspace };

    const context = engine.getVariableCaptureCompileContext("image", "Image");

    expect(context).toMatchObject({
      sourceUri: "file:///project/image.slang",
      sourcePath: "/workspace/image.slang",
      workspace,
      slangPassName: "Image",
    });
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
      { slot: 0, key: "iChannel0", kind: "buffer" },
      { slot: 1, key: "iChannel1", kind: "buffer" },
    ]);
  });
});
