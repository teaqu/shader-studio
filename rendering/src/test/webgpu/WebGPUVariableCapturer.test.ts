import { describe, it, expect, vi } from "vitest";
import type { DebugInstrumentationPlan } from "@shader-studio/types";
import { WebGPUVariableCapturer } from "../../webgpu/WebGPUVariableCapturer";
import type { CaptureUniforms } from "../../capture/VariableCapturer";
import type { StorageBindingNode } from "../../types/PassGraph";
import { createShaderToyUniformLayout, SHADERTOY_UNIFORM_SIZE, UNIFORM_OFFSETS } from "../../webgpu/SlangPrelude";

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
  createBindGroupLayout: ReturnType<typeof vi.fn>;
  createdBuffers: Array<{ size: number; mapAsync: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }>;
  flushMaps: () => Promise<void>;
}

function mockGpu(readbackFloats?: (size: number) => Float32Array): MockGpu {
  const writeBuffer = vi.fn();
  const submit = vi.fn();
  const copyTextureToBuffer = vi.fn();
  const createBindGroup = vi.fn(() => ({}));
  const createBindGroupLayout = vi.fn(() => ({}));
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
    createBindGroupLayout,
    createPipelineLayout: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({})),
    createBindGroup,
    createSampler: vi.fn(() => ({})),
    createCommandEncoder: vi.fn(() => ({
      beginRenderPass,
      copyTextureToBuffer,
      finish: vi.fn(() => ({})),
    })),
    pushErrorScope: vi.fn(),
    popErrorScope: vi.fn(async () => null),
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
    createBindGroupLayout,
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

const captures = [
  { varName: "uv", varType: "float2", captureShader: "shader-a", selectorIndex: 0 },
  { varName: "col", varType: "float3", captureShader: "shader-a", selectorIndex: 1 },
];

const storageA: StorageBindingNode = {
  name: "positions",
  binding: 0,
  elementType: "float4",
  builtin: true,
  count: 4,
  stride: 16,
};

const storageB: StorageBindingNode = {
  name: "particles",
  binding: 1,
  elementType: "Particle",
  builtin: false,
  count: 4,
  stride: 32,
};

describe("WebGPUVariableCapturer", () => {
  it("uses the captured pass's sparse channel count for its uniform buffer", async () => {
    const gpu = mockGpu();
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, {
      slangChannels: [{ slot: 16, key: "iChannel16", kind: "texture" }],
    }, () => [{ slot: 16, textureView: {} as GPUTextureView }]);

    await capturer.issueCaptureAtPixel([{ varName: "x", varType: "float", captureShader: "float4 mainImage(float2 c) { return 0; }" }], 0, 0, 320, 180, uniforms);

    expect(gpu.createdBuffers.some(({ size }) => size === createShaderToyUniformLayout(17).size)).toBe(true);
  });
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

    expect(gpu.compiler.compile).toHaveBeenCalledWith("shader-a", expect.objectContaining({
      customUniforms: [
        { name: "tint", type: "vec3" },
        { name: "enabled", type: "bool" },
      ],
    }));
    const packed = gpu.writeBuffer.mock.calls[0][2] as ArrayBuffer;
    expect(packed.byteLength).toBeGreaterThan(UNIFORM_OFFSETS.iChannelResolution + 64);
    const values = new DataView(packed);
    expect(values.getFloat32(UNIFORM_OFFSETS.iDate, true)).toBe(2026);
    expect(values.getFloat32(UNIFORM_OFFSETS.iChannelResolution, true)).toBe(512);
    expect(values.getFloat32(UNIFORM_OFFSETS.iCameraPos + 8, true)).toBe(3);
    expect(values.getFloat32(UNIFORM_OFFSETS.iCameraDir + 8, true)).toBe(-0.75);
    expect(values.getFloat32(SHADERTOY_UNIFORM_SIZE, true)).toBeCloseTo(0.25);
    expect(values.getInt32(SHADERTOY_UNIFORM_SIZE + 12, true)).toBe(1);
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
    expect(view.getFloat32(UNIFORM_OFFSETS.iChannelTime + 16, true)).toBeCloseTo(1.75);
    expect(view.getFloat32(UNIFORM_OFFSETS.iChannelLoaded + 16, true)).toBe(1);
    expect(view.getFloat32(UNIFORM_OFFSETS.iSampleRate, true)).toBe(48000);
  });

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

  it("keeps the capture target alive until its submitted draws complete", async () => {
    const gpu = mockGpu();
    const submittedWork = deferred<void>();
    gpu.device.queue.onSubmittedWorkDone = vi.fn(() => submittedWork.promise);
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler);

    await capturer.issueCaptureGrid(captures, uniforms, 8, 4);

    const target = (gpu.device.createTexture as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(gpu.submit).toHaveBeenCalledTimes(2);
    expect(gpu.device.queue.onSubmittedWorkDone).toHaveBeenCalledTimes(1);
    expect(target.destroy).not.toHaveBeenCalled();

    submittedWork.resolve();
    await submittedWork.promise;
    await Promise.resolve();

    expect(target.destroy).toHaveBeenCalledTimes(1);
  });

  it("compiles captures with imported modules and the selected source path", async () => {
    const gpu = mockGpu();
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, {
      commonCode: "",
      slangSourcePath: "/shaders/palette.slang",
      slangModules: [{
        moduleName: "tone_map",
        path: "/shaders/tone-map.slang",
        source: "module tone_map;",
      }],
    });

    await capturer.issueCaptureGrid([
      { varName: "color", varType: "float3", captureShader: "capture shader" },
    ], uniforms, 2, 2);

    expect(gpu.compiler.compile).toHaveBeenCalledWith("capture shader", expect.objectContaining({
      sourcePath: "/shaders/palette.slang",
      modules: [{
        moduleName: "tone_map",
        path: "/shaders/tone-map.slang",
        source: "module tone_map;",
      }],
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

    expect(gpu.compiler.compile).toHaveBeenCalledWith("shader-a", expect.objectContaining({
      channels,
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

  it("re-resolves channel views after the capture pipeline compile", async () => {
    const gpu = mockGpu();
    const staleView = { tag: "stale" } as unknown as GPUTextureView;
    const freshView = { tag: "fresh" } as unknown as GPUTextureView;
    let currentView = staleView;
    const compileGate = deferred<void>();
    gpu.compiler.compile.mockImplementation(async () => {
      await compileGate.promise;
      return { success: true as const, wgsl: "// wgsl" };
    });
    const capturer = new WebGPUVariableCapturer(
      gpu.device,
      gpu.compiler,
      { commonCode: "", slangChannels: [{ slot: 0, key: "iChannel0" }] },
      () => [{ slot: 0, textureView: currentView }],
    );

    const issued = capturer.issueCaptureGrid(captures, uniforms, 8, 4);
    // A pass rebuild replaces its output textures while the capture pipeline
    // is still compiling; the stale view now points at a destroyed texture.
    currentView = freshView;
    compileGate.resolve();
    await issued;

    for (const [descriptor] of gpu.createBindGroup.mock.calls) {
      expect(descriptor.entries).toContainEqual({ binding: 1, resource: freshView });
    }
  });

  it("reports an error and skips the submit when channels stop resolving during the compile", async () => {
    const gpu = mockGpu();
    let resources: Array<{ slot: number; textureView: GPUTextureView }> | null =
      [{ slot: 0, textureView: {} as GPUTextureView }];
    const compileGate = deferred<void>();
    gpu.compiler.compile.mockImplementation(async () => {
      await compileGate.promise;
      return { success: true as const, wgsl: "// wgsl" };
    });
    const capturer = new WebGPUVariableCapturer(
      gpu.device,
      gpu.compiler,
      { commonCode: "", slangChannels: [{ slot: 0, key: "iChannel0" }] },
      () => resources,
    );

    const issued = capturer.issueCaptureGrid(captures, uniforms, 8, 4);
    resources = null;
    compileGate.resolve();
    const count = await issued;

    expect(count).toBe(0);
    expect(gpu.submit).not.toHaveBeenCalled();
    expect(capturer.getLastError()).toBe("Capture channels are not resolvable yet");
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

  it("compiles and binds read-only storage after channels and before capture uniforms", async () => {
    const gpu = mockGpu();
    const textureView = { tag: "texture-view" } as unknown as GPUTextureView;
    const sampler = { tag: "sampler" } as unknown as GPUSampler;
    const positions = { tag: "positions" } as unknown as GPUBuffer;
    const particles = { tag: "particles" } as unknown as GPUBuffer;
    const storageBuffers = new Map([
      [storageA.name, positions],
      [storageB.name, particles],
    ]);
    const capturer = new WebGPUVariableCapturer(
      gpu.device,
      gpu.compiler,
      {
        commonCode: "struct Particle { float4 position; };",
        slangChannels: [{ slot: 2, key: "iChannel2" }],
        slangStorage: [storageA, storageB],
        slangStorageBuffers: storageBuffers,
      },
      () => [{ slot: 2, textureView, sampler }],
    );

    const issued = await capturer.issueCaptureGrid(captures.slice(0, 1), uniforms, 8, 4);

    expect(issued).toBe(1);
    expect(gpu.compiler.compile).toHaveBeenCalledWith("shader-a", expect.objectContaining({
      passKind: "render",
      storage: [storageA, storageB],
      captureMode: true,
    }));
    const layoutEntries = gpu.createBindGroupLayout.mock.calls[0][0].entries;
    expect(layoutEntries.map((entry: GPUBindGroupLayoutEntry) => entry.binding))
      .toEqual([0, 1, 2, 3, 4, 5]);
    expect(layoutEntries.slice(3, 5)).toEqual([
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
    ]);
    expect(layoutEntries[5]).toEqual({
      binding: 5,
      visibility: GPUShaderStage.FRAGMENT,
      buffer: { type: "uniform" },
    });
    expect(gpu.createBindGroup.mock.calls[0][0].entries).toEqual([
      { binding: 0, resource: { buffer: expect.anything() } },
      { binding: 1, resource: textureView },
      { binding: 2, resource: sampler },
      { binding: 3, resource: { buffer: positions } },
      { binding: 4, resource: { buffer: particles } },
      { binding: 5, resource: { buffer: expect.anything() } },
    ]);
  });

  it("skips safely when capture storage is absent and recovers when it appears", async () => {
    const gpu = mockGpu();
    const storageBuffers = new Map<string, GPUBuffer>();
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, {
      slangStorage: [storageA],
      slangStorageBuffers: storageBuffers,
    });

    const missing = await capturer.issueCaptureGrid(captures.slice(0, 1), uniforms, 8, 4);

    expect(missing).toBe(0);
    expect(capturer.getLastError()).toMatch(/storage.*positions/i);
    expect(gpu.compiler.compile).not.toHaveBeenCalled();
    expect(gpu.createBindGroup).not.toHaveBeenCalled();

    const positions = { tag: "positions" } as unknown as GPUBuffer;
    storageBuffers.set(storageA.name, positions);
    const recovered = await capturer.issueCaptureGrid(captures.slice(0, 1), uniforms, 8, 4);

    expect(recovered).toBe(1);
    expect(gpu.createBindGroup.mock.calls.at(-1)![0].entries)
      .toContainEqual({ binding: 1, resource: { buffer: positions } });
  });

  it("reuses capture layout for replacement buffers and invalidates it for storage declarations", async () => {
    const gpu = mockGpu();
    const firstBuffer = { tag: "positions-1" } as unknown as GPUBuffer;
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, {
      slangStorage: [storageA],
      slangStorageBuffers: new Map([[storageA.name, firstBuffer]]),
    });
    await capturer.issueCaptureGrid(captures.slice(0, 1), uniforms, 8, 4);

    const replacement = { tag: "positions-2" } as unknown as GPUBuffer;
    capturer.setCompileContext({
      slangStorage: [storageA],
      slangStorageBuffers: new Map([[storageA.name, replacement]]),
    });
    await capturer.issueCaptureGrid(captures.slice(0, 1), uniforms, 8, 4);

    expect(gpu.compiler.compile).toHaveBeenCalledTimes(1);
    expect(gpu.createBindGroupLayout).toHaveBeenCalledTimes(1);
    expect(gpu.createBindGroup.mock.calls.at(-1)![0].entries)
      .toContainEqual({ binding: 1, resource: { buffer: replacement } });

    const particles = { tag: "particles" } as unknown as GPUBuffer;
    capturer.setCompileContext({
      slangStorage: [storageA, storageB],
      slangStorageBuffers: new Map([
        [storageA.name, replacement],
        [storageB.name, particles],
      ]),
    });
    await capturer.issueCaptureGrid(captures.slice(0, 1), uniforms, 8, 4);

    expect(gpu.compiler.compile).toHaveBeenCalledTimes(2);
    expect(gpu.createBindGroupLayout).toHaveBeenCalledTimes(2);
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

  it("attributes native capture compiler failures to the selected imported module", async () => {
    const gpu = mockGpu();
    gpu.compiler.compile.mockResolvedValue({ success: false, errors: ["unexpected token"] });
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, {});
    const plan: DebugInstrumentationPlan = {
      workspaceHash: "hash",
      rootUri: "file:///shaders/image.slang",
      selectedSourceUri: "file:///shaders/helper.slang",
      executionMarkerSlot: 0,
      captureSlots: [],
      files: [
        { uri: "file:///shaders/image.slang", path: "/shaders/image.slang", source: "root", version: 1, moduleName: "", ownerPass: "Image" },
        { uri: "file:///shaders/helper.slang", path: "/shaders/helper.slang", source: "module Helper;", version: 2, moduleName: "Helper", ownerPass: "Image" },
      ],
    };

    const issued = await capturer.issueCaptureGrid([{ ...captures[0], slangPlan: plan }], uniforms, 8, 4);

    expect(issued).toBe(0);
    expect(capturer.getLastError()).toBe("/shaders/helper.slang: unexpected token");
  });

  it("compiles a selected common debug file as common code instead of a module", async () => {
    const gpu = mockGpu();
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, {
      commonCode: "",
      slangSourcePath: "/shaders/common.slang",
    });
    const plan: DebugInstrumentationPlan = {
      workspaceHash: "common-hash",
      rootUri: "file:///shaders/image.slang",
      selectedSourceUri: "file:///shaders/common.slang",
      executionMarkerSlot: 0,
      captureSlots: [],
      files: [
        { uri: "file:///shaders/image.slang", path: "/shaders/image.slang", source: "instrumented root", version: 2, moduleName: "", ownerPass: "Image" },
        { uri: "file:///shaders/common.slang", path: "/shaders/common.slang", source: "instrumented common", version: 2, moduleName: "", ownerPass: "Image" },
      ],
    };

    await capturer.issueCaptureGrid([{ ...captures[0], captureShader: "instrumented root", slangPlan: plan }], uniforms, 8, 4);

    expect(gpu.compiler.compile).toHaveBeenCalledWith(
      "instrumented root",
      expect.objectContaining({
        commonCode: "instrumented common",
        modules: [],
        sourcePath: "/shaders/image.slang",
      }),
    );
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

  it("waits for outstanding readback maps before destroying cancelled buffers", async () => {
    const gpu = mockGpu();
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, {});

    await capturer.issueCaptureGrid(captures, uniforms, 8, 4);
    capturer.cancelPendingCaptures();

    const readbacks = gpu.createdBuffers.filter((buffer) => buffer.mapAsync.mock.calls.length > 0);
    expect(readbacks.length).toBeGreaterThan(0);
    for (const buffer of readbacks) {
      expect(buffer.destroy).not.toHaveBeenCalled();
    }
    await gpu.flushMaps();
    for (const buffer of readbacks) {
      expect(buffer.destroy).toHaveBeenCalledOnce();
    }
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

  it("abandons a deferred compile when its declaration context becomes stale", async () => {
    const gpu = mockGpu();
    const oldCompile = deferred<{ success: true; wgsl: string }>();
    gpu.compiler.compile.mockImplementationOnce(() => oldCompile.promise);
    const oldBuffer = { tag: "old-positions" } as unknown as GPUBuffer;
    const newBuffer = { tag: "new-positions" } as unknown as GPUBuffer;
    const newStorage: StorageBindingNode = {
      ...storageA,
      elementType: "uint4",
    };
    let channelSlot = 0;
    const textureView = { tag: "texture-view" } as unknown as GPUTextureView;
    const sampler = { tag: "sampler" } as unknown as GPUSampler;
    const capturer = new WebGPUVariableCapturer(
      gpu.device,
      gpu.compiler,
      {
        commonCode: "struct OldContext {};",
        slangChannels: [{ slot: 0, key: "iChannel0" }],
        slangStorage: [storageA],
        slangStorageBuffers: new Map([[storageA.name, oldBuffer]]),
      },
      () => [{ slot: channelSlot, textureView, sampler }],
    );

    const staleIssue = capturer.issueCaptureGrid(captures.slice(0, 1), uniforms, 8, 4);
    await vi.waitFor(() => expect(gpu.compiler.compile).toHaveBeenCalledTimes(1));

    channelSlot = 1;
    capturer.setCompileContext({
      commonCode: "struct NewContext {};",
      slangChannels: [{ slot: 1, key: "iChannel1" }],
      slangStorage: [newStorage],
      slangStorageBuffers: new Map([[newStorage.name, newBuffer]]),
    });
    oldCompile.resolve({ success: true, wgsl: "// old context" });

    expect(await staleIssue).toBe(0);
    expect(gpu.createBindGroup).not.toHaveBeenCalled();
    expect(gpu.device.createRenderPipeline).not.toHaveBeenCalled();

    expect(await capturer.issueCaptureGrid(captures.slice(0, 1), uniforms, 8, 4)).toBe(1);
    expect(gpu.compiler.compile).toHaveBeenCalledTimes(2);
    expect(gpu.compiler.compile).toHaveBeenLastCalledWith("shader-a", expect.objectContaining({
      commonCode: "struct NewContext {};",
      channels: [{ slot: 1, key: "iChannel1" }],
      storage: [newStorage],
    }));
    expect(gpu.createBindGroup.mock.calls.at(-1)![0].entries)
      .toContainEqual({ binding: 3, resource: { buffer: newBuffer } });
  });

  it("abandons a deferred pipeline when its declaration context becomes stale", async () => {
    const gpu = mockGpu();
    const oldPipeline = deferred<GPURenderPipeline>();
    const createRenderPipelineAsync = vi.fn()
      .mockImplementationOnce(() => oldPipeline.promise)
      .mockResolvedValue({ tag: "new-pipeline" } as unknown as GPURenderPipeline);
    Object.assign(gpu.device, { createRenderPipelineAsync });
    const oldBuffer = { tag: "old-positions" } as unknown as GPUBuffer;
    const newBuffer = { tag: "new-positions" } as unknown as GPUBuffer;
    const newStorage: StorageBindingNode = {
      ...storageA,
      elementType: "uint4",
    };
    let channelSlot = 0;
    const textureView = { tag: "texture-view" } as unknown as GPUTextureView;
    const sampler = { tag: "sampler" } as unknown as GPUSampler;
    const capturer = new WebGPUVariableCapturer(
      gpu.device,
      gpu.compiler,
      {
        commonCode: "struct OldContext {};",
        slangChannels: [{ slot: 0, key: "iChannel0" }],
        slangStorage: [storageA],
        slangStorageBuffers: new Map([[storageA.name, oldBuffer]]),
      },
      () => [{ slot: channelSlot, textureView, sampler }],
    );

    const staleIssue = capturer.issueCaptureGrid(captures.slice(0, 1), uniforms, 8, 4);
    await vi.waitFor(() => expect(createRenderPipelineAsync).toHaveBeenCalledTimes(1));

    channelSlot = 1;
    capturer.setCompileContext({
      commonCode: "struct NewContext {};",
      slangChannels: [{ slot: 1, key: "iChannel1" }],
      slangStorage: [newStorage],
      slangStorageBuffers: new Map([[newStorage.name, newBuffer]]),
    });
    oldPipeline.resolve({ tag: "old-pipeline" } as unknown as GPURenderPipeline);

    expect(await staleIssue).toBe(0);
    expect(gpu.createBindGroup).not.toHaveBeenCalled();

    expect(await capturer.issueCaptureGrid(captures.slice(0, 1), uniforms, 8, 4)).toBe(1);
    expect(gpu.compiler.compile).toHaveBeenCalledTimes(2);
    expect(createRenderPipelineAsync).toHaveBeenCalledTimes(2);
    expect(gpu.compiler.compile).toHaveBeenLastCalledWith("shader-a", expect.objectContaining({
      commonCode: "struct NewContext {};",
      channels: [{ slot: 1, key: "iChannel1" }],
      storage: [newStorage],
    }));
    expect(gpu.createBindGroup.mock.calls.at(-1)![0].entries)
      .toContainEqual({ binding: 3, resource: { buffer: newBuffer } });
  });

  it("does not publish a deferred pipeline after disposal", async () => {
    const gpu = mockGpu();
    const deferredPipeline = deferred<GPURenderPipeline>();
    const createRenderPipelineAsync = vi.fn(() => deferredPipeline.promise);
    Object.assign(gpu.device, { createRenderPipelineAsync });
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, {});

    const issue = capturer.issueCaptureGrid(captures.slice(0, 1), uniforms, 8, 4);
    await vi.waitFor(() => expect(createRenderPipelineAsync).toHaveBeenCalledTimes(1));
    capturer.dispose();
    deferredPipeline.resolve({ tag: "disposed-pipeline" } as unknown as GPURenderPipeline);

    expect(await issue).toBe(0);
    expect((capturer as unknown as { pipelineCache: Map<string, unknown> }).pipelineCache.size).toBe(0);
    expect(gpu.createBindGroup).not.toHaveBeenCalled();
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
    const positions = { tag: "positions" } as unknown as GPUBuffer;
    const storageBuffers = new Map([[storageA.name, positions]]);
    (engine as any).storageLayouts = new Map([[storageA.name, storageA]]);
    (engine as any).storageBuffers = storageBuffers;

    const context = engine.getVariableCaptureCompileContext();

    expect(context.commonCode).toBe("float x;");
    expect(context.slangChannels).toEqual([{ slot: 0, key: "iChannel0", kind: "buffer" }]);
    expect(context.slangStorage).toEqual([storageA]);
    expect(context.slangStorageBuffers).toBe(storageBuffers);
    expect(context.slangChannels).toEqual([{ slot: 0, key: "iChannel0", kind: "buffer" }]);
  });

  it("does not inject configured common code when that common source is itself being captured", async () => {
    const { WebGPURenderingEngine } = await import("../../webgpu/WebGPURenderingEngine");
    const engine = new WebGPURenderingEngine({ scriptUrl: "s.js", wasmUrl: "s.wasm" });
    const commonCode = "float helper(float x) { return x * 2.0; }";
    (engine as any).passGraph = [
      { name: "Image", source: "image", output: "canvas", width: 1, height: 1, channels: [] },
    ];
    (engine as any).lastCompile = {
      code: "image",
      path: "/image.slang",
      buffers: { common: commonCode },
      slangModules: [],
    };

    expect(engine.getVariableCaptureCompileContext(commonCode, "common").commonCode).toBe("");
    expect(engine.getVariableCaptureCompileContext(commonCode, "BufferA").commonCode).toBe("");
  });

  it("derives Image pass capture channels from compile inputs before the live pass graph is installed", async () => {
    const { WebGPURenderingEngine } = await import("../../webgpu/WebGPURenderingEngine");
    const engine = new WebGPURenderingEngine({ scriptUrl: "s.js", wasmUrl: "s.wasm" });
    const imageCode = `
float4 mainImage(float2 fragCoord) {
  float2 uv = fragCoord / iResolution.xy;
  float3 sharp = inputs.iChannel0.Sample(uv).rgb;
  float3 glow = inputs.iChannel1.Sample(uv).rgb;
  return float4(sharp + glow, 1.0);
}`;
    (engine as any).canvas = { width: 1340, height: 753 };
    const config = {
      storage: {
        positions: { count: 4, stride: 16, elementType: "float4" },
      },
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
    (engine as any).currentConfig = config;
    (engine as any).lastCompile = {
      code: imageCode,
      config,
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
    expect(context.slangStorage).toEqual([storageA]);
  });

  it("binds reset-created storage through an already-created capture instance", async () => {
    const { WebGPURenderingEngine } = await import("../../webgpu/WebGPURenderingEngine");
    const gpu = mockGpu();
    const engine = new WebGPURenderingEngine({ scriptUrl: "s.js", wasmUrl: "s.wasm" });
    const firstBuffer = { tag: "positions-1", destroy: vi.fn() } as unknown as GPUBuffer;
    (engine as any).device = gpu.device;
    (engine as any).compiler = gpu.compiler;
    (engine as any).passGraph = [
      { name: "Image", source: "i", output: "canvas", width: 1, height: 1, channels: [] },
    ];
    (engine as any).storageLayouts = new Map([[storageA.name, storageA]]);
    (engine as any).storageBuffers = new Map([[storageA.name, firstBuffer]]);
    const capturer = engine.createVariableCapturer();

    await capturer.issueCaptureGrid(captures.slice(0, 1), uniforms, 8, 4);
    expect(gpu.createBindGroup.mock.calls.at(-1)![0].entries)
      .toContainEqual({ binding: 1, resource: { buffer: firstBuffer } });

    engine.resetTime();
    const resetBuffer = (engine as any).storageBuffers.get(storageA.name) as GPUBuffer;
    await capturer.issueCaptureGrid(captures.slice(0, 1), uniforms, 8, 4);

    expect(resetBuffer).not.toBe(firstBuffer);
    expect((firstBuffer as unknown as { destroy: ReturnType<typeof vi.fn> }).destroy)
      .toHaveBeenCalledTimes(1);
    expect(gpu.compiler.compile).toHaveBeenCalledTimes(1);
    expect(gpu.createBindGroup.mock.calls.at(-1)![0].entries)
      .toContainEqual({ binding: 1, resource: { buffer: resetBuffer } });
    expect(gpu.createBindGroup.mock.calls.at(-1)![0].entries)
      .not.toContainEqual({ binding: 1, resource: { buffer: firstBuffer } });
  });
});
