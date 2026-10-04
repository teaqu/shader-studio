import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureWgslProjectReference, captureWgslProjectTrace, type WgslProjectTraceSnapshot } from '../../trace/WgslProjectTraceCapture';
import type { RenderPassNode } from '../../types/PassGraph';
import { captureWgslTrace } from '../../trace/WgslTraceCapture';

function gpuHarness() {
  const buffers: Array<ReturnType<typeof buffer>> = [];
  const textures: Array<{ destroy: ReturnType<typeof vi.fn>; createView: ReturnType<typeof vi.fn> }> = [];
  function buffer(descriptor: GPUBufferDescriptor) {
    const bytes = new ArrayBuffer(descriptor.size);
    return { size: descriptor.size, bytes, destroy: vi.fn(), mapAsync: vi.fn(async () => {}), unmap: vi.fn(), getMappedRange: () => bytes };
  }
  const render = { setPipeline: vi.fn(), setBindGroup: vi.fn(), setVertexBuffer: vi.fn(), setIndexBuffer: vi.fn(), draw: vi.fn(), drawIndexed: vi.fn(), end: vi.fn() };
  const compute = { setPipeline: vi.fn(), setBindGroup: vi.fn(), dispatchWorkgroups: vi.fn(), end: vi.fn() };
  const encoder = {
    beginRenderPass: vi.fn(() => render), beginComputePass: vi.fn(() => compute), finish: vi.fn(() => ({})),
    copyTextureToBuffer: vi.fn(), copyTextureToTexture: vi.fn(),
    copyBufferToBuffer: vi.fn((source: ReturnType<typeof buffer>, sourceOffset: number, destination: ReturnType<typeof buffer>, destinationOffset: number, size: number) => {
      new Uint8Array(destination.bytes, destinationOffset, size).set(new Uint8Array(source.bytes, sourceOffset, size));
    }),
  };
  const device = {
    features: new Set<string>(), limits: {}, destroy: vi.fn(),
    createBuffer: vi.fn((descriptor: GPUBufferDescriptor) => {
      const result = buffer(descriptor); buffers.push(result); return result; 
    }),
    createTexture: vi.fn(() => {
      const result = { destroy: vi.fn(), createView: vi.fn(() => ({})) }; textures.push(result); return result; 
    }),
    createCommandEncoder: vi.fn(() => encoder), createSampler: vi.fn(() => ({})), createBindGroup: vi.fn(() => ({})),
    createBindGroupLayout: vi.fn(() => ({})), createPipelineLayout: vi.fn(() => ({})),
    createShaderModule: vi.fn((_descriptor: GPUShaderModuleDescriptor) => ({ getCompilationInfo: vi.fn(async () => ({ messages: [] as Array<{ type: string; message: string }> })) })),
    createRenderPipelineAsync: vi.fn(async () => ({ getBindGroupLayout: () => ({}) })), createComputePipelineAsync: vi.fn(async () => ({ getBindGroupLayout: () => ({}) })),
    queue: { submit: vi.fn(), writeBuffer: vi.fn((target: ReturnType<typeof buffer>, offset: number, value: ArrayBuffer | ArrayBufferView) => {
      const bytes = ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : new Uint8Array(value);
      new Uint8Array(target.bytes, offset, bytes.length).set(bytes);
    }) },
    pushErrorScope: vi.fn(), popErrorScope: vi.fn(async () => null as { message: string } | null),
  };
  return { device, encoder, render, compute, buffers, textures };
}

function snapshot(device: unknown, changes: Partial<RenderPassNode> = {}): WgslProjectTraceSnapshot {
  return {
    device: device as GPUDevice,
    pass: { name: 'Image', source: 'fn mainImage(p: vec2f) -> vec4f { let value = p.x; return vec4f(value); }', language: 'wgsl', geometry: 'fullscreen', kind: 'render', output: 'canvas', outputLayers: 1, dispatchCount: 1, dispatchOnce: false, workgroupSize: [1, 1, 1], width: 16, height: 12, channels: [], ...changes },
    storage: [], storageBuffers: new Map(), channelResources: [], uniformData: new ArrayBuffer(256), commonCode: '', customUniformInfo: [], sourcePath: '/image.wgsl',
  };
}

const request = { passName: 'Image', pixel: [4, 5] as [number, number], capacity: 8 };

describe('configured WGSL trace resource execution', () => {
  beforeEach(() => {
    vi.stubGlobal('GPUMapMode', { READ: 1 });
    vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 });
    vi.stubGlobal('GPUBufferUsage', { MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128 });
    vi.stubGlobal('GPUTextureUsage', { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('releases every owned resource after a traced frame and reads the requested pixel', async () => {
    const h = gpuHarness();
    const result = await captureWgslProjectTrace(snapshot(h.device), request);
    expect(result.sites.length).toBeGreaterThan(0);
    expect(h.encoder.copyTextureToBuffer).toHaveBeenCalledWith(expect.objectContaining({ origin: [4, 5] }), expect.anything(), [1, 1]);
    expect(h.buffers.every(item => item.destroy.mock.calls.length === 1)).toBe(true);
    expect(h.textures.every(item => item.destroy.mock.calls.length === 1)).toBe(true);
    expect(h.render.draw).toHaveBeenCalledWith(3, 1);
  });

  it('uses configured generated-vertex counts, topology, instances and reversed depth', async () => {
    const h = gpuHarness();
    const frozen = snapshot(h.device, { geometry: 'vertices', space: 'clip', vertexCount: 24, instanceCount: 3, topology: 'line-list', depth: { compare: 'greater', test: true, write: false }, cull: 'front' });
    frozen.meshUniformData = new ArrayBuffer(256);
    await captureWgslProjectTrace(frozen, request);
    expect(h.render.draw).toHaveBeenCalledWith(24, 3);
    expect(h.render.setVertexBuffer).not.toHaveBeenCalled();
    expect(h.device.createRenderPipelineAsync).toHaveBeenCalledWith(expect.objectContaining({ primitive: { topology: 'line-list', frontFace: 'ccw', cullMode: 'front' }, depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'greater' } }));
    expect(h.encoder.beginRenderPass).toHaveBeenCalledWith(expect.objectContaining({ depthStencilAttachment: expect.objectContaining({ depthClearValue: 0 }) }));
  });

  it('resolves blended multisample colour into a readable target', async () => {
    const h = gpuHarness();
    const frozen = snapshot(h.device, { geometry: 'vertices', space: 'clip', samples: 4, blend: 'alpha', clear: [.1, .2, .3, 1] });
    frozen.meshUniformData = new ArrayBuffer(256);
    await captureWgslProjectReference(frozen, request);
    expect(h.device.createRenderPipelineAsync).toHaveBeenCalledWith(expect.objectContaining({ multisample: { count: 4 }, fragment: expect.objectContaining({ targets: [expect.objectContaining({ format: 'rgba16float', blend: expect.anything() })] }) }));
    expect(h.encoder.beginRenderPass).toHaveBeenCalledWith(expect.objectContaining({ colorAttachments: [expect.objectContaining({ resolveTarget: expect.anything(), clearValue: [.1, .2, .3, 1] })] }));
  });

  it('releases snapshots if compilation fails', async () => {
    const h = gpuHarness();
    h.device.createShaderModule.mockImplementation(() => ({ getCompilationInfo: vi.fn(async () => ({ messages: [{ type: 'error', message: 'invalid module' }] })) }));
    await expect(captureWgslProjectTrace(snapshot(h.device), request)).rejects.toThrow('invalid module');
    expect(h.buffers.every(item => item.destroy.mock.calls.length === 1)).toBe(true);
  });

  it('surfaces submission validation failures and still destroys resources', async () => {
    const h = gpuHarness();
    h.device.popErrorScope.mockResolvedValue({ message: 'lost resource' });
    await expect(captureWgslProjectTrace(snapshot(h.device), request)).rejects.toThrow('lost resource');
    expect(h.buffers.every(item => item.destroy.mock.calls.length === 1)).toBe(true);
    expect(h.textures.every(item => item.destroy.mock.calls.length === 1)).toBe(true);
  });

  it.each(['none', 'texture'] as const)('replays every frozen compute sub-dispatch with %s output and preserves live storage', async (output) => {
    const h = gpuHarness();
    const frozen = snapshot(h.device, { kind: 'compute', output, source: '@compute @workgroup_size(1) fn mainCompute() { let value = 1u; }' });
    const live = h.device.createBuffer({ size: 16, usage: 128 });
    new Uint32Array(live.bytes).set([7, 8, 9, 10]);
    frozen.storage = [{ name: 'data', binding: 0, elementType: 'u32', builtin: true, count: 4, stride: 4 }];
    frozen.storageBuffers.set('data', live as unknown as GPUBuffer);
    frozen.dispatchWorkgroups = [2, 3, 4];
    frozen.dispatchUniforms = [new ArrayBuffer(16), new ArrayBuffer(16)];
    const result = await captureWgslProjectTrace(frozen, { ...request, invocation: [1, 2, 3] });
    expect(h.compute.dispatchWorkgroups.mock.calls).toEqual([[2, 3, 4], [2, 3, 4]]);
    expect(h.render.draw).not.toHaveBeenCalled();
    expect(result.storage).toEqual([{ name: 'data', bytes: Array.from(new Uint8Array(live.bytes)) }]);
    expect(Array.from(new Uint32Array(live.bytes))).toEqual([7, 8, 9, 10]);
    expect(live.destroy).not.toHaveBeenCalled();
    expect(h.buffers.filter(item => item !== live).every(item => item.destroy.mock.calls.length === 1)).toBe(true);
  });

  it.each([
    { maxStorageBufferBindingSize: 16 },
    { maxUniformBufferBindingSize: 16 },
  ])('rejects a frozen snapshot exceeding device limits before allocation: %j', async (limits) => {
    const h = gpuHarness();
    Object.assign(h.device.limits, limits);
    await expect(captureWgslProjectTrace(snapshot(h.device), request)).rejects.toThrow(/limit/);
    expect(h.device.createBuffer).not.toHaveBeenCalled();
  });

  it('rejects unavailable required shader features before allocating a trace', async () => {
    const h = gpuHarness();
    const frozen = snapshot(h.device, { source: 'enable f16; fn mainImage(p: vec2f) -> vec4f { return vec4f(p, 0., 1.); }' });
    await expect(captureWgslProjectTrace(frozen, request)).rejects.toThrow('unavailable optional WebGPU features: f16.');
    expect(h.device.createBuffer).not.toHaveBeenCalled();
  });

  it.each(['triangle-list', 'line-list', 'point-list'] as const)('snapshots the correct %s mesh data and never destroys renderer-owned buffers', async (topology) => {
    const h = gpuHarness();
    const frozen = snapshot(h.device, { geometry: 'cube', topology, samples: topology === 'triangle-list' ? 4 : 1, instanceCount: 2 });
    const vertexBuffer = h.device.createBuffer({ size: 128, usage: 32 });
    const indexBuffer = h.device.createBuffer({ size: 24, usage: 16 });
    const edgeIndexBuffer = h.device.createBuffer({ size: 16, usage: 16 });
    frozen.mesh = { vertexBuffer, indexBuffer, edgeIndexBuffer, indexFormat: 'uint32', indexCount: 6, edgeIndexCount: 4, vertexCount: 4 } as unknown as WgslProjectTraceSnapshot['mesh'];
    frozen.meshUniformData = new ArrayBuffer(256);
    await captureWgslProjectTrace(frozen, request);
    const count = topology === 'triangle-list' ? 6 : 4;
    expect(h.render.draw).toHaveBeenCalledWith(count, 2);
    if (topology === 'point-list') {
      expect(h.device.queue.writeBuffer).toHaveBeenCalledWith(expect.anything(), 0, new Uint32Array([0, 1, 2, 3]));
    } else {
      expect(h.encoder.copyBufferToBuffer).toHaveBeenCalledWith(topology === 'line-list' ? edgeIndexBuffer : indexBuffer, 0, expect.anything(), 0, topology === 'line-list' ? 16 : 24);
    }
    expect(vertexBuffer.destroy).not.toHaveBeenCalled();
    expect(indexBuffer.destroy).not.toHaveBeenCalled();
    expect(edgeIndexBuffer.destroy).not.toHaveBeenCalled();
  });

  it('draws an uninstrumented indexed mesh reference without allocating primitive selection', async () => {
    const h = gpuHarness();
    const frozen = snapshot(h.device, { geometry: 'cube' });
    frozen.mesh = { vertexBuffer: h.device.createBuffer({ size: 96, usage: 32 }), indexBuffer: h.device.createBuffer({ size: 12, usage: 16 }), indexFormat: 'uint32', indexCount: 3 } as unknown as WgslProjectTraceSnapshot['mesh'];
    frozen.meshUniformData = new ArrayBuffer(256);
    await captureWgslProjectReference(frozen, request);
    expect(h.render.drawIndexed).toHaveBeenCalledWith(3, 1);
    expect(h.device.createComputePipelineAsync).not.toHaveBeenCalled();
  });

  it('rejects missing frozen geometry and uniforms while cleaning partial snapshots', async () => {
    const h = gpuHarness();
    await expect(captureWgslProjectTrace(snapshot(h.device, { geometry: 'cube' }), request)).rejects.toThrow('needs frozen mesh buffers');
    await expect(captureWgslProjectTrace(snapshot(h.device, { geometry: 'vertices', space: 'world' }), request)).rejects.toThrow('needs a frozen mesh uniform snapshot');
    expect(h.buffers.every(item => item.destroy.mock.calls.length === 1)).toBe(true);
  });

  it.each(['fullscreen', 'vertices', 'cube'] as const)('replays the selected %s vertex and disposes all trace-owned buffers', async (geometry) => {
    const h = gpuHarness();
    const frozen = snapshot(h.device, { geometry, space: 'clip', vertexSrc: 'fn mainVertex(vertexIndex: u32, position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) { *position = vec3f(f32(vertexIndex)); }' });
    frozen.vertexPath = '/image.vert.wgsl';
    frozen.meshUniformData = new ArrayBuffer(256);
    const live = h.device.createBuffer({ size: 128, usage: 32 });
    if (geometry === 'cube') {
      frozen.mesh = { vertexBuffer: live, indexBuffer: live, indexFormat: 'uint32', indexCount: 3 } as unknown as WgslProjectTraceSnapshot['mesh'];
    }
    const result = await captureWgslProjectTrace(frozen, { ...request, stage: 'vertex', vertexIndex: 2 });
    expect(result.path).toBe('/image.vert.wgsl');
    expect(h.compute.dispatchWorkgroups).toHaveBeenCalledWith(1);
    if (geometry === 'cube') {
      expect(h.encoder.copyBufferToBuffer).toHaveBeenCalledWith(live, 64, expect.anything(), 0, 32);
    } else {
      expect(h.encoder.copyBufferToBuffer.mock.calls.some(([source]) => source === live)).toBe(false);
    }
    expect(h.buffers.filter(item => item !== live).every(item => item.destroy.mock.calls.length === 1)).toBe(true);
    expect(live.destroy).not.toHaveBeenCalled();
  });

  it.each([[-1, 5], [16, 5], [4, 12], [4.5, 5]])('rejects pixel %j before allocating resources', async (x, y) => {
    const h = gpuHarness();
    await expect(captureWgslProjectTrace(snapshot(h.device), { ...request, pixel: [x, y] })).rejects.toThrow('Trace pixel must be inside');
    expect(h.device.createBuffer).not.toHaveBeenCalled();
  });

  it('rejects cancellation and stage mismatches before allocating resources', async () => {
    const h = gpuHarness();
    const controller = new AbortController(); controller.abort();
    await expect(captureWgslProjectTrace(snapshot(h.device), request, controller.signal)).rejects.toThrow();
    await expect(captureWgslProjectTrace(snapshot(h.device), { ...request, stage: 'compute' })).rejects.toThrow('not a compute pass');
    await expect(captureWgslProjectTrace(snapshot(h.device, { kind: 'compute' }), { ...request, stage: 'fragment' })).rejects.toThrow('not a render pass');
    expect(h.device.createBuffer).not.toHaveBeenCalled();
  });

  it.each(['success', 'compilation', 'validation', 'cancelled', 'device-lost'] as const)('disposes the dedicated source-only device and snapshots after %s', async (outcome) => {
    const h = gpuHarness();
    const controller = new AbortController();
    vi.stubGlobal('navigator', { gpu: { requestAdapter: vi.fn(async () => ({ requestDevice: vi.fn(async () => h.device) })) } });
    const launch = { source: snapshot(h.device).pass.source, path: '/image.wgsl', width: 16, height: 12, pixel: [4, 5] as [number, number], capacity: 8, time: 0, frame: 0 };
    if (outcome === 'compilation') {
      h.device.createShaderModule.mockImplementation(() => ({ getCompilationInfo: vi.fn(async () => ({ messages: [{ type: 'error', message: 'bad shader' }] })) }));
      await expect(captureWgslTrace(launch)).rejects.toThrow('bad shader');
    } else if (outcome === 'validation') {
      h.device.popErrorScope.mockResolvedValue({ message: 'bad submission' });
      await expect(captureWgslTrace(launch)).rejects.toThrow('bad submission');
    } else if (outcome === 'device-lost') {
      h.device.createRenderPipelineAsync.mockRejectedValue(new Error('device lost'));
      h.device.popErrorScope.mockRejectedValue(new Error('scope unavailable'));
      await expect(captureWgslTrace(launch)).rejects.toThrow('device lost');
    } else if (outcome === 'cancelled') {
      h.device.createRenderPipelineAsync.mockImplementation(async () => {
        controller.abort(); throw new Error('cancelled'); 
      });
      await expect(captureWgslTrace(launch, controller.signal)).rejects.toThrow('cancelled');
    } else {
      expect((await captureWgslTrace(launch)).path).toBe('/image.wgsl');
      expect(h.render.draw).toHaveBeenCalledWith(3);
      expect(h.device.queue.writeBuffer).toHaveBeenCalledWith(expect.anything(), 0, new Float32Array([4.5, 6.5, 0, 0]));
    }
    expect(h.device.destroy).toHaveBeenCalled();
    expect(h.buffers.every(item => item.destroy.mock.calls.length === 1)).toBe(true);
    expect(h.textures.every(item => item.destroy.mock.calls.length === 1)).toBe(true);
  });

  it('reports an unavailable source-only adapter without requesting a device', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: vi.fn(async () => null) } });
    await expect(captureWgslTrace({ source: snapshot(undefined).pass.source, path: '/image.wgsl', width: 16, height: 12, pixel: [4, 5], capacity: 8, time: 0, frame: 0 })).rejects.toThrow('WebGPU is unavailable');
  });
  it('reports primitive selector compilation errors and destroys partial mesh snapshots', async () => {
    const h = gpuHarness();
    const frozen = snapshot(h.device, { geometry: 'cube' });
    frozen.mesh = { vertexBuffer: h.device.createBuffer({ size: 96, usage: 32 }), indexBuffer: h.device.createBuffer({ size: 12, usage: 16 }), indexFormat: 'uint32', indexCount: 3 } as unknown as WgslProjectTraceSnapshot['mesh'];
    frozen.meshUniformData = new ArrayBuffer(256);
    const original = h.device.createShaderModule.getMockImplementation()!;
    h.device.createShaderModule.mockImplementation((descriptor) => {
      if (descriptor.code.includes('return _ss_trace_primitive;')) {
        return { getCompilationInfo: vi.fn(async () => ({ messages: [{ type: 'error', message: 'primitive selector invalid' }] })) };
      }
      return original(descriptor);
    });
    await expect(captureWgslProjectTrace(frozen, request)).rejects.toThrow('primitive selector invalid');
    expect(h.buffers.filter(item => (item as unknown) !== frozen.mesh?.vertexBuffer && (item as unknown) !== frozen.mesh?.indexBuffer).every(item => item.destroy.mock.calls.length === 1)).toBe(true);
  });

});
