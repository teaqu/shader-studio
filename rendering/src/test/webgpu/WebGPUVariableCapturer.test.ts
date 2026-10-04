import { engineOwners } from "./engineOwners";
import { getSlangChannels } from "../../webgpu/SlangBindingPlan";
import { describe, it, expect, vi } from "vitest";
import type { DebugInstrumentationPlan } from "@shader-studio/types";
import type { AsyncSlangCompiler } from "../../webgpu/AsyncSlangCompiler";
import { WebGPUVariableCapturer } from "../../webgpu/WebGPUVariableCapturer";
import type { CaptureUniforms } from "../../capture/VariableCapturer";
import type { StorageBindingNode } from "../../types/PassGraph";
import { createShaderToyUniformLayout, SHADERTOY_UNIFORM_SIZE, UNIFORM_OFFSETS } from "../../webgpu/SlangPrelude";
import { allowNonUniformDerivatives } from "../../webgpu/wgslDiagnostics";
import { captureCounters } from "../../capture/captureDiagnostics";

function resetCaptureCounters(): void {
  for (const key of Object.keys(captureCounters) as Array<keyof typeof captureCounters>) {
    captureCounters[key] = 0;
  }
}

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
  compiler: AsyncSlangCompiler & {
    compile: ReturnType<typeof vi.fn<AsyncSlangCompiler["compile"]>>;
    dispose: ReturnType<typeof vi.fn<AsyncSlangCompiler["dispose"]>>;
  };
  writeBuffer: ReturnType<typeof vi.fn>;
  submit: ReturnType<typeof vi.fn>;
  copyTextureToBuffer: ReturnType<typeof vi.fn>;
  copyBufferToBuffer: ReturnType<typeof vi.fn>;
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
  const copyBufferToBuffer = vi.fn();
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
      copyBufferToBuffer,
      finish: vi.fn(() => ({})),
    })),
    pushErrorScope: vi.fn(),
    popErrorScope: vi.fn(async () => null),
  } as unknown as GPUDevice;

  const compiler = {
    compile: vi.fn<AsyncSlangCompiler["compile"]>(async () => ({ success: true, wgsl: "// wgsl" })),
    dispose: vi.fn<AsyncSlangCompiler["dispose"]>(),
  };

  return {
    device,
    compiler,
    writeBuffer,
    submit,
    copyTextureToBuffer,
    copyBufferToBuffer,
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

  it.each([
    [{ vertexCount: 6 }, 6],
    [{}, 0],
  ])("packs iVertexCount from the capture uniforms (%j)", async (extra, expected) => {
    const gpu = mockGpu();
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler);

    await capturer.issueCaptureGrid(captures, { ...uniforms, ...extra }, 8, 4);

    const packed = gpu.writeBuffer.mock.calls[0][2] as ArrayBuffer;
    expect(new DataView(packed).getUint32(UNIFORM_OFFSETS.iVertexCount, true)).toBe(expected);
  });

  it("packs the capture uniforms' camera matrices, or identity without them", async () => {
    const camera = { view: new Float32Array(16).fill(1), projection: new Float32Array(16).fill(2), viewProjection: new Float32Array(16).fill(3) };
    const withCamera = mockGpu();
    await new WebGPUVariableCapturer(withCamera.device, withCamera.compiler).issueCaptureGrid(captures, { ...uniforms, camera }, 8, 4);
    const packed = new Float32Array(withCamera.writeBuffer.mock.calls[0][2] as ArrayBuffer);
    expect(packed[UNIFORM_OFFSETS.iViewMatrix / 4]).toBe(1);
    expect(packed[UNIFORM_OFFSETS.iProjectionMatrix / 4 + 15]).toBe(2);
    expect(packed[UNIFORM_OFFSETS.iViewProjection / 4 + 7]).toBe(3);

    const withoutCamera = mockGpu();
    await new WebGPUVariableCapturer(withoutCamera.device, withoutCamera.compiler).issueCaptureGrid(captures, uniforms, 8, 4);
    const identity = new Float32Array(withoutCamera.writeBuffer.mock.calls[0][2] as ArrayBuffer);
    expect(Array.from(identity.subarray(UNIFORM_OFFSETS.iViewProjection / 4, UNIFORM_OFFSETS.iViewProjection / 4 + 16)))
      .toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  });

  it.each([
    [{ instanceCount: 5 }, 5],
    [{}, 1],
  ])("packs iInstanceCount from the capture uniforms (%j)", async (extra, expected) => {
    const gpu = mockGpu();
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler);

    await capturer.issueCaptureGrid(captures, { ...uniforms, ...extra }, 8, 4);

    const packed = gpu.writeBuffer.mock.calls[0][2] as ArrayBuffer;
    expect(new DataView(packed).getUint32(UNIFORM_OFFSETS.iVertexCount + 4, true)).toBe(expected);
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
    const submittedWork = deferred<undefined>();
    gpu.device.queue.onSubmittedWorkDone = vi.fn(() => submittedWork.promise);
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler);

    await capturer.issueCaptureGrid(captures, uniforms, 8, 4);

    const target = (gpu.device.createTexture as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(gpu.submit).toHaveBeenCalledTimes(2);
    expect(gpu.device.queue.onSubmittedWorkDone).toHaveBeenCalledTimes(1);
    expect(target.destroy).not.toHaveBeenCalled();

    submittedWork.resolve(undefined);
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

  it("shares channel bindings in capture and appends the capture uniform after them", async () => {
    const gpu = mockGpu();
    const channels = getSlangChannels(Array.from({ length: 24 }, (_, slot) => ({
      kind: "keyboard" as const, slot, key: `tex${slot}`,
    })));
    const textureView = {} as GPUTextureView;
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, { slangChannels: channels },
      () => channels.map(channel => ({ slot: channel.slot, textureView })));
    await capturer.issueCaptureGrid(captures, uniforms, 8, 4);
    expect(gpu.compiler.compile).toHaveBeenCalledWith("shader-a", expect.objectContaining({ channels }));
    const layout = gpu.createBindGroupLayout.mock.calls[0][0].entries;
    expect(layout.map((entry: GPUBindGroupLayoutEntry) => entry.binding)).toEqual([0, 1, 2, 3]);
    const entries = gpu.createBindGroup.mock.calls[0][0].entries;
    expect(entries.map((entry: GPUBindGroupEntry) => entry.binding)).toEqual([0, 1, 2, 3]);
    expect(entries[1].resource).toBe(textureView);
    capturer.dispose();
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

  it("freezes channel views before the capture pipeline compile", async () => {
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
    // is compiling. This issue remains bound to the resource it started with.
    currentView = freshView;
    compileGate.resolve();
    await issued;

    for (const [descriptor] of gpu.createBindGroup.mock.calls) {
      expect(descriptor.entries).toContainEqual({ binding: 1, resource: staleView });
    }
  });

  it("uses the issue-time channel view when channels stop resolving during compile", async () => {
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

    expect(count).toBe(captures.length);
    expect(gpu.submit).toHaveBeenCalledTimes(captures.length);
    expect(capturer.getLastError()).toBeNull();
  });

  it("defers instead of failing when the resolver returns an empty list for slots the plan needs", async () => {
    // getChannelResources can report "resolved, nothing yet" as an empty
    // array rather than null - e.g. mid pass-switch, before that pass's
    // textures are bound. The null check above does not catch this: the
    // plan still expects its channel slots, and the bind group build must
    // treat the shortfall as a retry, not a silent, unattributed failure.
    const gpu = mockGpu();
    const capturer = new WebGPUVariableCapturer(
      gpu.device,
      gpu.compiler,
      { commonCode: "", slangChannels: [{ slot: 0, key: "iChannel0" }] },
      () => [],
    );

    const count = await capturer.issueCaptureGrid(captures, uniforms, 8, 4);

    expect(count).toBe(0);
    expect(gpu.submit).not.toHaveBeenCalled();
    expect(capturer.issueDeferred()).toBe(true);
  });

  it("marks a capture deferred when resources are not ready, and not when a compile fails", async () => {
    const gpu = mockGpu();
    let resources: Array<{ slot: number; textureView: GPUTextureView }> | null = null;
    const capturer = new WebGPUVariableCapturer(
      gpu.device,
      gpu.compiler,
      { commonCode: "", slangChannels: [{ slot: 0, key: "iChannel0" }] },
      () => resources,
    );

    expect(await capturer.issueCaptureGrid(captures, uniforms, 8, 4)).toBe(0);
    expect(capturer.issueDeferred()).toBe(true);

    // The resources arrive but the shader itself will not compile: that is a
    // real failure the panel has to report, not something to retry silently.
    resources = [{ slot: 0, textureView: {} as GPUTextureView }];
    gpu.compiler.compile.mockResolvedValue({ success: false as const, errors: ["compile failed"] });

    expect(await capturer.issueCaptureGrid(captures, uniforms, 8, 4)).toBe(0);
    expect(capturer.issueDeferred()).toBe(false);
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
    const entries = gpu.createBindGroup.mock.calls[0][0].entries;
    expect(entries).toEqual([
      { binding: 0, resource: { buffer: expect.anything() } },
      { binding: 1, resource: textureView },
      { binding: 2, resource: sampler },
      { binding: 3, resource: { buffer: expect.anything() } },
      { binding: 4, resource: { buffer: expect.anything() } },
      { binding: 5, resource: { buffer: expect.anything() } },
    ]);
    expect(entries[3].resource.buffer).not.toBe(positions);
    expect(entries[4].resource.buffer).not.toBe(particles);
    expect(gpu.copyBufferToBuffer).toHaveBeenCalledWith(positions, 0, entries[3].resource.buffer, 0, 64);
    expect(gpu.copyBufferToBuffer).toHaveBeenCalledWith(particles, 0, entries[4].resource.buffer, 0, 128);
  });

  it("uses a writable capture binding for storage structs containing atomics", async () => {
    const gpu = mockGpu();
    const counter = {
      ...storageB,
      name: "counter",
      binding: 0,
      elementType: "Counter",
      stride: 4,
      containsAtomic: true,
    };
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, {
      slangStorage: [counter],
      slangStorageBuffers: new Map([[counter.name, {} as GPUBuffer]]),
    });

    expect(await capturer.issueCaptureGrid(captures.slice(0, 1), uniforms, 8, 4)).toBe(1);
    expect(gpu.createBindGroupLayout.mock.calls[0][0].entries[1]).toEqual({
      binding: 1,
      visibility: GPUShaderStage.FRAGMENT,
      buffer: { type: "storage" },
    });
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
    expect(gpu.createBindGroup.mock.calls.at(-1)![0].entries.find((entry: GPUBindGroupEntry) => entry.binding === 1)!.resource.buffer)
      .not.toBe(positions);
  });

  it("retires every storage clone when a later snapshot allocation fails", async () => {
    const gpu = mockGpu();
    let allocations = 0;
    (gpu.device.createBuffer as ReturnType<typeof vi.fn>).mockImplementation((desc: { size: number }) => {
      allocations++;
      if (allocations === 3) {
        throw new Error("out of capture storage");
      }
      const buffer = {
        size: desc.size,
        mapAsync: vi.fn(),
        getMappedRange: vi.fn(),
        unmap: vi.fn(),
        destroy: vi.fn(),
      };
      gpu.createdBuffers.push(buffer);
      return buffer;
    });
    resetCaptureCounters();
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, {
      slangStorage: [storageA, storageB],
      slangStorageBuffers: new Map([[storageA.name, {} as GPUBuffer], [storageB.name, {} as GPUBuffer]]),
    });

    expect(await capturer.issueCaptureGrid(captures, uniforms, 8, 4)).toBe(0);
    for (const buffer of gpu.createdBuffers) {
      expect(buffer.destroy).toHaveBeenCalledOnce();
    }
    expect(captureCounters.gpuBuffersCreated).toBe(2);
    expect(captureCounters.gpuBuffersDestroyed).toBe(2);
  });

  it("releases channel, mesh, and storage snapshots when target allocation throws", async () => {
    const gpu = mockGpu();
    const destroyChannels = vi.fn();
    resetCaptureCounters();
    (gpu.device.createTexture as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("capture target allocation failed");
    });
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, {
      slangStorage: [storageA],
      slangStorageBuffers: new Map([[storageA.name, {} as GPUBuffer]]),
      captureChannelSnapshot: () => ({ resources: [], textureCount: 2, destroy: destroyChannels }),
      nativeRender: {
        vertexEntryPoint: "sceneVertex", fragmentEntryPoint: "sceneFragment", geometry: "model",
        width: 8, height: 4, draw: vi.fn(), meshUniformData: () => new Float32Array(64),
      },
    });

    await expect(capturer.issueCaptureGrid([{ ...captures[0], debugPlan: { workspaceHash: "allocation-failure", rootUri: "/image.wgsl", selectedSourceUri: "/image.wgsl", files: [], captureSlots: [], executionMarkerSlot: 0, nativeRender: { fragmentEntryPoint: "sceneFragment", output: 0 } } }], uniforms, 8, 4)).resolves.toBe(0);
    expect(destroyChannels).toHaveBeenCalledOnce();
    expect(gpu.createdBuffers[0].destroy).toHaveBeenCalledOnce();
    expect(gpu.createdBuffers[1].destroy).toHaveBeenCalledOnce();
    expect(captureCounters.gpuBuffersCreated).toBe(4);
    expect(captureCounters.gpuBuffersDestroyed).toBe(2);
    expect(captureCounters.gpuTexturesCreated).toBe(2);
    expect(captureCounters.gpuTexturesDestroyed).toBe(2);
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
    expect(gpu.createBindGroup.mock.calls.at(-1)![0].entries.find((entry: GPUBindGroupEntry) => entry.binding === 1)!.resource.buffer)
      .not.toBe(replacement);

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

    const issued = await capturer.issueCaptureGrid([{ ...captures[0], debugPlan: plan }], uniforms, 8, 4);

    expect(issued).toBe(0);
    expect(capturer.getLastError()).toBe("/shaders/helper.slang: unexpected token");
  });

  it("forwards native stages and uses the original mesh raster pipeline for capture", async () => {
    const gpu = mockGpu();
    const draw = vi.fn();
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, {
      nativeRender: {
        vertexEntryPoint: "sceneVertex", fragmentEntryPoint: "sceneFragment", geometry: "model",
        width: 640, height: 360, draw, meshUniformData: () => new Float32Array(64),
      },
    });
    const plan: DebugInstrumentationPlan = {
      workspaceHash: "native-raster", rootUri: "/shaders/image.wgsl", selectedSourceUri: "/shaders/image.wgsl",
      executionMarkerSlot: 0, captureSlots: [], nativeRender: { fragmentEntryPoint: "debugFragment" },
      files: [{ uri: "/shaders/image.wgsl", path: "/shaders/image.wgsl", source: "instrumented native root", version: 1, moduleName: "", ownerPass: "Image" }],
    };

    await capturer.issueCaptureGrid([{ ...captures[0], captureShader: "instrumented native root", debugPlan: plan }], uniforms, 3, 2);

    expect(gpu.compiler.compile).toHaveBeenCalledWith("instrumented native root", expect.objectContaining({
      captureMode: true, renderEntryPoints: { vertex: "sceneVertex", fragment: "debugFragment" },
    }));
    const pipeline = (gpu.device.createRenderPipeline as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(pipeline.vertex).toMatchObject({ entryPoint: "sceneVertex", buffers: [{ arrayStride: 32 }] });
    expect(pipeline.fragment).toMatchObject({ entryPoint: "debugFragment" });
    expect(pipeline.depthStencil).toMatchObject({ format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" });
    const layoutEntries = (gpu.device.createBindGroupLayout as ReturnType<typeof vi.fn>).mock.calls[0]![0].entries;
    expect(layoutEntries.map((entry: GPUBindGroupLayoutEntry) => entry.binding)).toEqual([0, 1, 2]);
    const bindEntries = gpu.createBindGroup.mock.calls[0]![0].entries;
    expect(bindEntries.map((entry: GPUBindGroupEntry) => entry.binding)).toEqual([0, 1, 2]);
    expect((bindEntries[1]!.resource as { buffer: unknown }).buffer).not.toBe((bindEntries[2]!.resource as { buffer: unknown }).buffer);
    expect(draw).toHaveBeenCalledOnce();
    const pass = gpu.beginRenderPass.mock.results[0]!.value;
    expect(pass.draw).not.toHaveBeenCalled();
    expect(pass.setBindGroup).toHaveBeenCalledOnce();
    expect(gpu.copyTextureToBuffer).toHaveBeenCalledTimes(6);
  });

  it("copies native pixel captures at the original top-left integer canvas coordinate", async () => {
    const gpu = mockGpu();
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, {
      nativeRender: { vertexEntryPoint: "sceneVertex", fragmentEntryPoint: "sceneFragment", geometry: "fullscreen", width: 320, height: 180, draw: vi.fn() },
    });
    const plan: DebugInstrumentationPlan = {
      workspaceHash: "native-pixel", rootUri: "/shaders/image.wgsl", selectedSourceUri: "/shaders/image.wgsl",
      executionMarkerSlot: 0, captureSlots: [], nativeRender: { fragmentEntryPoint: "debugFragment" },
      files: [{ uri: "/shaders/image.wgsl", path: "/shaders/image.wgsl", source: "instrumented", version: 1, moduleName: "", ownerPass: "Image" }],
    };
    await capturer.issueCaptureAtPixel([{ ...captures[0], debugPlan: plan }], 10, 20, 320, 180, uniforms);
    expect(gpu.copyTextureToBuffer.mock.calls[0]![0]).toMatchObject({ origin: { x: 10, y: 20 } });
  });

  it("diagnoses a native debug plan when no matching native raster context is installed", async () => {
    const gpu = mockGpu();
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler);
    const plan: DebugInstrumentationPlan = {
      workspaceHash: "orphan-native", rootUri: "/shaders/image.wgsl", selectedSourceUri: "/shaders/image.wgsl",
      executionMarkerSlot: 0, captureSlots: [], nativeRender: { fragmentEntryPoint: "debugFragment" },
      files: [{ uri: "/shaders/image.wgsl", path: "/shaders/image.wgsl", source: "instrumented", version: 1, moduleName: "", ownerPass: "Image" }],
    };
    expect(await capturer.issueCaptureGrid([{ ...captures[0], debugPlan: plan }], uniforms, 1, 1)).toBe(0);
    expect(capturer.getLastError()).toContain("native raster context");
    expect(gpu.compiler.compile).not.toHaveBeenCalled();
  });

  it("rejects mixed native and hook capture requests before allocating a shared target", async () => {
    const gpu = mockGpu();
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, {
      nativeRender: { vertexEntryPoint: "sceneVertex", fragmentEntryPoint: "sceneFragment", geometry: "fullscreen", width: 100, height: 50, draw: vi.fn() },
    });
    const plan: DebugInstrumentationPlan = { workspaceHash: "mixed", rootUri: "/image.wgsl", selectedSourceUri: "/image.wgsl", executionMarkerSlot: 0, captureSlots: [], nativeRender: { fragmentEntryPoint: "debugFragment" }, files: [] };
    expect(await capturer.issueCaptureGrid([{ ...captures[0], debugPlan: plan }, captures[1]!], uniforms, 1, 1)).toBe(0);
    expect(capturer.getLastError()).toContain("separate batches");
    expect(gpu.compiler.compile).not.toHaveBeenCalled();
  });

  it("invalidates the native pipeline cache when vertex stage or geometry changes", async () => {
    const gpu = mockGpu();
    const plan: DebugInstrumentationPlan = { workspaceHash: "native-cache", rootUri: "/image.wgsl", selectedSourceUri: "/image.wgsl", executionMarkerSlot: 0, captureSlots: [], nativeRender: { fragmentEntryPoint: "debugFragment" }, files: [] };
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, {
      nativeRender: { vertexEntryPoint: "firstVertex", fragmentEntryPoint: "fragment", geometry: "fullscreen", width: 100, height: 50, draw: vi.fn() },
    });
    await capturer.issueCaptureGrid([{ ...captures[0], debugPlan: plan }], uniforms, 1, 1);
    capturer.setCompileContext({ nativeRender: { vertexEntryPoint: "secondVertex", fragmentEntryPoint: "fragment", geometry: "plane", width: 100, height: 50, draw: vi.fn(), meshUniformData: () => new Float32Array(64) } });
    await capturer.issueCaptureGrid([{ ...captures[0], debugPlan: plan }], uniforms, 1, 1);
    expect(gpu.compiler.compile).toHaveBeenCalledTimes(2);
    expect((gpu.device.createRenderPipeline as ReturnType<typeof vi.fn>).mock.calls[1]![0].vertex).toMatchObject({ entryPoint: "secondVertex", buffers: [{ arrayStride: 32 }] });
  });

  it("does not reuse a native capture pipeline across MRT output selections or attachment counts", async () => {
    const gpu = mockGpu();
    const request = { ...captures[0], debugPlan: {
      workspaceHash: "native-mrt-cache", rootUri: "/image.wgsl", selectedSourceUri: "/image.wgsl",
      executionMarkerSlot: 0, captureSlots: [], files: [], nativeRender: { fragmentEntryPoint: "debugFragment", output: 0 },
    } as DebugInstrumentationPlan };
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, {
      nativeRender: { vertexEntryPoint: "sceneVertex", fragmentEntryPoint: "sceneFragment", geometry: "fullscreen", width: 100, height: 50, outputCount: 2, draw: vi.fn() },
    });

    await capturer.issueCaptureGrid([request], uniforms, 1, 1);
    await capturer.issueCaptureGrid([{ ...request, debugPlan: { ...request.debugPlan!, nativeRender: { fragmentEntryPoint: "debugFragment", output: 1 } } }], uniforms, 1, 1);
    capturer.setCompileContext({ nativeRender: { vertexEntryPoint: "sceneVertex", fragmentEntryPoint: "sceneFragment", geometry: "fullscreen", width: 100, height: 50, outputCount: 3, draw: vi.fn() } });
    await capturer.issueCaptureGrid([request], uniforms, 1, 1);

    expect(gpu.compiler.compile).toHaveBeenCalledTimes(3);
    const descriptors = (gpu.device.createRenderPipeline as ReturnType<typeof vi.fn>).mock.calls.map(call => call[0].fragment.targets);
    expect(descriptors).toEqual([
      [{ format: "rgba32float" }, null],
      [null, { format: "rgba32float" }],
      [{ format: "rgba32float" }, null, null],
    ]);
  });

  it("destroys deferred native color and depth targets exactly once on dispose", async () => {
    resetCaptureCounters();
    const gpu = mockGpu();
    let complete!: () => void;
    (gpu.device.queue as any).onSubmittedWorkDone = vi.fn(() => new Promise<void>((resolve) => {
      complete = resolve;
    }));
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, {
      nativeRender: { vertexEntryPoint: "sceneVertex", fragmentEntryPoint: "sceneFragment", geometry: "model", width: 100, height: 50, draw: vi.fn(), meshUniformData: () => new Float32Array(64) },
    });
    const plan: DebugInstrumentationPlan = { workspaceHash: "native-dispose", rootUri: "/image.wgsl", selectedSourceUri: "/image.wgsl", executionMarkerSlot: 0, captureSlots: [], nativeRender: { fragmentEntryPoint: "debugFragment" }, files: [] };
    await capturer.issueCaptureGrid([{ ...captures[0], debugPlan: plan }], uniforms, 1, 1);
    const textures = (gpu.device.createTexture as ReturnType<typeof vi.fn>).mock.results.map(result => result.value);
    capturer.dispose();
    capturer.dispose();
    expect(textures[0].destroy).toHaveBeenCalledOnce();
    expect(textures[1].destroy).toHaveBeenCalledOnce();
    expect(captureCounters.gpuTexturesCreated).toBe(2);
    expect(captureCounters.gpuTexturesDestroyed).toBe(2);
    complete();
    await Promise.resolve();
    expect(textures[0].destroy).toHaveBeenCalledOnce();
    expect(textures[1].destroy).toHaveBeenCalledOnce();
  });

  it("scales native pixel captures to pass resolution and packs that resolution into uniforms", async () => {
    const gpu = mockGpu();
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, {
      nativeRender: { vertexEntryPoint: "sceneVertex", fragmentEntryPoint: "sceneFragment", geometry: "fullscreen", width: 100, height: 50, draw: vi.fn() },
    });
    const plan: DebugInstrumentationPlan = { workspaceHash: "native-resolution", rootUri: "/image.wgsl", selectedSourceUri: "/image.wgsl", executionMarkerSlot: 0, captureSlots: [], nativeRender: { fragmentEntryPoint: "debugFragment" }, files: [] };
    await capturer.issueCaptureAtPixel([{ ...captures[0], debugPlan: plan }], 100, 50, 200, 100, uniforms);
    expect(gpu.copyTextureToBuffer.mock.calls[0]![0]).toMatchObject({ origin: { x: 50, y: 25 } });
    const shaderToyWrite = gpu.writeBuffer.mock.calls.find(call => (call[2] as ArrayBuffer).byteLength > 32)!;
    const values = new Float32Array(shaderToyWrite[2] as ArrayBuffer);
    expect(values[0]).toBe(100);
    expect(values[1]).toBe(50);
  });

  it("reports a native draw failure and releases transient readback, color, and depth resources", async () => {
    const gpu = mockGpu();
    const draw = vi.fn(() => {
      throw new Error("Native raster geometry for 'BufferA' is unavailable.");
    });
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, {
      nativeRender: { vertexEntryPoint: "sceneVertex", fragmentEntryPoint: "sceneFragment", geometry: "model", width: 100, height: 50, draw, meshUniformData: () => new Float32Array(64) },
    });
    const plan: DebugInstrumentationPlan = { workspaceHash: "native-draw-failure", rootUri: "/image.wgsl", selectedSourceUri: "/image.wgsl", executionMarkerSlot: 0, captureSlots: [], nativeRender: { fragmentEntryPoint: "debugFragment" }, files: [] };

    await expect(capturer.issueCaptureGrid([{ ...captures[0], debugPlan: plan }], uniforms, 1, 1)).resolves.toBe(0);

    expect(capturer.getLastError()).toContain("Native raster geometry for 'BufferA' is unavailable.");
    expect(capturer.getCaptureErrors()).toEqual([expect.objectContaining({ varName: "uv", message: expect.stringContaining("Native raster geometry") })]);
    expect(gpu.submit).not.toHaveBeenCalled();
    const textures = (gpu.device.createTexture as ReturnType<typeof vi.fn>).mock.results.map(result => result.value);
    expect(textures[0].destroy).toHaveBeenCalledOnce();
    expect(textures[1].destroy).toHaveBeenCalledOnce();
    const readback = gpu.createdBuffers[gpu.createdBuffers.length - 1]!;
    expect(readback.mapAsync).not.toHaveBeenCalled();
    expect(readback.destroy).toHaveBeenCalledOnce();
  });

  it("compiles a single-file WGSL debug plan through the plan source in captureMode", async () => {
    const gpu = mockGpu();
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, { commonCode: "" });
    const plan: DebugInstrumentationPlan = {
      workspaceHash: "wgsl-hash",
      rootUri: "/shaders/image.wgsl",
      selectedSourceUri: "/shaders/image.wgsl",
      executionMarkerSlot: 0,
      captureSlots: [],
      files: [
        { uri: "/shaders/image.wgsl", path: "/shaders/image.wgsl", source: "instrumented wgsl root", version: 1, moduleName: "", ownerPass: "Image" },
      ],
    };

    await capturer.issueCaptureGrid([{ ...captures[0], captureShader: "instrumented wgsl root", debugPlan: plan }], uniforms, 8, 4);

    // The engine injects the WGSL compiler for WGSL shaders, so the already-
    // WGSL plan source must reach it verbatim with no Slang module plumbing.
    expect(gpu.compiler.compile).toHaveBeenCalledWith(
      "instrumented wgsl root",
      expect.objectContaining({
        captureMode: true,
        passName: "capture",
        commonCode: "",
        modules: [],
        sourcePath: "/shaders/image.wgsl",
      }),
    );
    expect(gpu.device.createShaderModule).toHaveBeenCalledWith({
      code: allowNonUniformDerivatives("// wgsl"),
    });
  });

  it("captures a WGSL compute replay through the render capture pipeline", async () => {
    const gpu = mockGpu();
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, { commonCode: "" });
    const plan: DebugInstrumentationPlan = {
      workspaceHash: "wgsl-compute-hash",
      rootUri: "/shaders/update.wgsl",
      selectedSourceUri: "/shaders/update.wgsl",
      executionMarkerSlot: 0,
      captureSlots: [],
      files: [{
        uri: "/shaders/update.wgsl",
        path: "/shaders/update.wgsl",
        source: "instrumented wgsl compute replay",
        version: 2,
        moduleName: "",
        ownerPass: "ComputeUpdate",
      }],
    };

    await capturer.issueCaptureGrid([{
      ...captures[0],
      captureShader: "instrumented wgsl compute replay",
      debugPlan: plan,
    }], uniforms, 8, 4);

    expect(gpu.compiler.compile).toHaveBeenCalledWith(
      "instrumented wgsl compute replay",
      expect.objectContaining({
        captureMode: true,
        passKind: "render",
        sourcePath: "/shaders/update.wgsl",
        modules: [],
      }),
    );
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

    await capturer.issueCaptureGrid([{ ...captures[0], captureShader: "instrumented root", debugPlan: plan }], uniforms, 8, 4);

    expect(gpu.compiler.compile).toHaveBeenCalledWith(
      "instrumented root",
      expect.objectContaining({
        commonCode: "instrumented common",
        modules: [],
        sourcePath: "/shaders/image.slang",
      }),
    );
  });

  it("compiles WGSL common exactly once when capturing the root", async () => {
    const gpu = mockGpu();
    const capturer = new WebGPUVariableCapturer(gpu.device, gpu.compiler, {
      commonCode: "old common",
      slangSourcePath: "/shaders/image.wgsl",
    });
    const plan: DebugInstrumentationPlan = {
      workspaceHash: "common-hash",
      rootUri: "file:///shaders/image.wgsl",
      selectedSourceUri: "file:///shaders/image.wgsl",
      executionMarkerSlot: 0,
      captureSlots: [],
      files: [
        { uri: "file:///shaders/image.wgsl", path: "/shaders/image.wgsl", source: "instrumented root", version: 2, moduleName: "", ownerPass: "Image" },
        { uri: "file:///shaders/common.wgsl", path: "/shaders/common.wgsl", source: "instrumented common", version: 2, moduleName: "", ownerPass: "Image" },
      ],
    };

    await capturer.issueCaptureGrid([{ ...captures[0], captureShader: "instrumented root", debugPlan: plan }], uniforms, 8, 4);

    expect(gpu.compiler.compile).toHaveBeenCalledWith(
      "instrumented root",
      expect.objectContaining({
        commonCode: "instrumented common",
        modules: [],
        sourcePath: "/shaders/image.wgsl",
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
    expect(gpu.createBindGroup.mock.calls.at(-1)![0].entries.find((entry: GPUBindGroupEntry) => entry.binding === 3)!.resource.buffer)
      .not.toBe(newBuffer);
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
    expect(gpu.createBindGroup.mock.calls.at(-1)![0].entries.find((entry: GPUBindGroupEntry) => entry.binding === 3)!.resource.buffer)
      .not.toBe(newBuffer);
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
    (engineOwners(engine).session as any).passGraph = [
      { name: "BufferA", source: "a", output: "texture", width: 1, height: 1, channels: [] },
      {
        name: "Image", source: "i", output: "canvas", width: 1, height: 1,
        channels: [{
          kind: "buffer", slot: 0, key: "iChannel0", source: "BufferA", readFrom: "current-frame",
        }],
      },
    ];
    (engineOwners(engine).session as any).lastCompile = { code: "i", path: "/i.slang", buffers: { common: "float x;" } };
    const positions = { tag: "positions" } as unknown as GPUBuffer;
    const storageBuffers = new Map([[storageA.name, positions]]);
    (engineOwners(engine).storage as any).storageLayouts = new Map([[storageA.name, storageA]]);
    (engineOwners(engine).storage as any).storageBuffers = storageBuffers;

    const context = engine.getVariableCaptureCompileContext();

    expect(context.commonCode).toBe("float x;");
    expect(context.slangChannels).toEqual([expect.objectContaining({ slot: 0, key: "iChannel0", kind: "buffer" })]);
    expect(context.slangStorage).toEqual([storageA]);
    expect(context.slangStorageBuffers).toBe(storageBuffers);
    expect(context.slangChannels).toEqual([expect.objectContaining({ slot: 0, key: "iChannel0", kind: "buffer" })]);
  });

  it("does not inject configured common code when that common source is itself being captured", async () => {
    const { WebGPURenderingEngine } = await import("../../webgpu/WebGPURenderingEngine");
    const engine = new WebGPURenderingEngine({ scriptUrl: "s.js", wasmUrl: "s.wasm" });
    const commonCode = "float helper(float x) { return x * 2.0; }";
    (engineOwners(engine).session as any).passGraph = [
      { name: "Image", source: "image", output: "canvas", width: 1, height: 1, channels: [] },
    ];
    (engineOwners(engine).session as any).lastCompile = {
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
  float3 sharp = iChannel0.Sample(uv).rgb;
  float3 glow = iChannel1.Sample(uv).rgb;
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
    (engineOwners(engine).session as any).currentConfig = config;
    (engineOwners(engine).session as any).lastCompile = {
      code: imageCode,
      config,
      path: "/slang-multipass-test/flow.slang",
      buffers: {
        BufferA: "float4 mainImage(float2 fragCoord) { return float4(0.0); }",
        BufferB: "float4 mainImage(float2 fragCoord) { return float4(0.0); }",
      },
    };
    (engineOwners(engine).session as any).passGraph = [];

    const context = engine.getVariableCaptureCompileContext(imageCode, "Image");

    expect(context.slangChannels).toEqual([
      expect.objectContaining({ slot: 0, key: "iChannel0", kind: "buffer" }),
      expect.objectContaining({ slot: 1, key: "iChannel1", kind: "buffer" }),
    ]);
    expect(context.slangStorage).toEqual([storageA]);
  });

  it("keeps capture on installed storage until reset publication, then binds the replacement", async () => {
    const { WebGPURenderingEngine } = await import("../../webgpu/WebGPURenderingEngine");
    const gpu = mockGpu();
    const engine = new WebGPURenderingEngine({ scriptUrl: "s.js", wasmUrl: "s.wasm" });
    const firstBuffer = { tag: "positions-1", destroy: vi.fn() } as unknown as GPUBuffer;
    (engine as any).device = gpu.device;
    (engine as any).compiler = gpu.compiler;
    (engineOwners(engine).session as any).passGraph = [
      { name: "Image", source: "i", output: "canvas", width: 1, height: 1, channels: [] },
    ];
    (engineOwners(engine).storage as any).storageLayouts = new Map([[storageA.name, storageA]]);
    (engineOwners(engine).storage as any).storageBuffers = new Map([[storageA.name, firstBuffer]]);
    const capturer = engine.createVariableCapturer();

    await capturer.issueCaptureGrid(captures.slice(0, 1), uniforms, 8, 4);
    expect(gpu.createBindGroup.mock.calls.at(-1)![0].entries.find((entry: GPUBindGroupEntry) => entry.binding === 1)!.resource.buffer)
      .not.toBe(firstBuffer);

    engine.resetTime();
    const resetBuffer = (engineOwners(engine).storage as any).pendingReset.storageBuffers.get(storageA.name) as GPUBuffer;
    await capturer.issueCaptureGrid(captures.slice(0, 1), uniforms, 8, 4);

    expect(gpu.createBindGroup.mock.calls.at(-1)![0].entries.find((entry: GPUBindGroupEntry) => entry.binding === 1)!.resource.buffer)
      .not.toBe(firstBuffer);
    expect((firstBuffer as unknown as { destroy: ReturnType<typeof vi.fn> }).destroy)
      .not.toHaveBeenCalled();

    (engineOwners(engine).storage as any).storageBuffers = new Map([[storageA.name, resetBuffer]]);
    (firstBuffer as unknown as { destroy: () => void }).destroy();
    await capturer.issueCaptureGrid(captures.slice(0, 1), uniforms, 8, 4);

    expect(resetBuffer).not.toBe(firstBuffer);
    expect((firstBuffer as unknown as { destroy: ReturnType<typeof vi.fn> }).destroy)
      .toHaveBeenCalledTimes(1);
    expect(gpu.compiler.compile).toHaveBeenCalledTimes(1);
    expect(gpu.createBindGroup.mock.calls.at(-1)![0].entries.find((entry: GPUBindGroupEntry) => entry.binding === 1)!.resource.buffer)
      .not.toBe(resetBuffer);
  });
});
