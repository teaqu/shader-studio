import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type WgslProjectTraceSnapshot } from '../../trace/WgslProjectTraceCapture';
import type { RenderPassNode } from '../../types/PassGraph';
import { captureWgslVertexTraceReplay } from '../../trace/WgslVertexTraceReplay';

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
    createShaderModule: vi.fn(() => ({ getCompilationInfo: vi.fn(async () => ({ messages: [] as Array<{ type: string; message: string }> })) })),
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

const request = { passName: 'Image', stage: 'vertex' as const, pixel: [0, 0] as [number, number], capacity: 8 };
function vertexSnapshot(device: unknown, changes: Partial<RenderPassNode> = {}) {
  const frozen = snapshot(device, { vertexSrc: 'fn mainVertex(vertexIndex: u32, position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) { *position = vec3f(f32(vertexIndex)); }', ...changes });
  frozen.vertexPath = '/image.vert.wgsl';
  return frozen;
}
beforeEach(() => {
  vi.stubGlobal('GPUMapMode', { READ: 1 });
  vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 });
  vi.stubGlobal('GPUTextureUsage', { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 });
});
afterEach(() => vi.unstubAllGlobals());

describe('vertex replay frozen resources and failure cleanup', () => {
  it('snapshots mesh vertices, storage and textures without destroying renderer resources', async () => {
    const h = gpuHarness();
    const live = h.device.createBuffer({ size: 96, usage: 128 });
    const texture = { width: 4, height: 4, depthOrArrayLayers: 1, format: 'rgba8unorm', dimension: '2d', mipLevelCount: 1, sampleCount: 1, destroy: vi.fn() };
    const frozen = vertexSnapshot(h.device, { geometry: 'cube', channels: [{ kind: 'texture', slot: 0, key: 'image', path: '/image.png' }] });
    frozen.mesh = { vertexBuffer: live } as unknown as WgslProjectTraceSnapshot['mesh'];
    frozen.meshUniformData = new ArrayBuffer(256);
    frozen.storage = [{ name: 'data', binding: 0, elementType: 'u32', builtin: true, count: 4, stride: 4 }];
    frozen.storageBuffers.set('data', live as unknown as GPUBuffer);
    frozen.channelResources = [{ slot: 0, texture: texture as unknown as GPUTexture, textureView: {} as GPUTextureView }];
    await captureWgslVertexTraceReplay(frozen, { ...request, vertexIndex: 2 });
    expect(h.encoder.copyBufferToBuffer).toHaveBeenCalledWith(live, 64, expect.anything(), 0, 32);
    expect(h.encoder.copyBufferToBuffer).toHaveBeenCalledWith(live, 0, expect.anything(), 0, 16);
    expect(h.encoder.copyTextureToTexture).toHaveBeenCalledOnce();
    expect(h.textures.every(t => t.destroy.mock.calls.length === 1)).toBe(true);
    expect(h.buffers.filter(b => b !== live).every(b => b.destroy.mock.calls.length === 1)).toBe(true);
    expect(live.destroy).not.toHaveBeenCalled();
    expect(texture.destroy).not.toHaveBeenCalled();
  });

  it('reports a channel disappearing before binding and releases frozen resources', async () => {
    const h = gpuHarness();
    const frozen = vertexSnapshot(h.device, { channels: [{ kind: 'texture', slot: 0, key: 'missing', path: '/missing.png' }] });
    await expect(captureWgslVertexTraceReplay(frozen, request)).rejects.toThrow('lost a channel resource');
    expect(h.buffers.every(b => b.destroy.mock.calls.length === 1)).toBe(true);
    expect(h.compute.dispatchWorkgroups).not.toHaveBeenCalled();
  });
  it.each([false, true])('captures a fullscreen vertex with reference=%s and releases readbacks', async (reference) => {
    const h = gpuHarness();
    const result = await captureWgslVertexTraceReplay(vertexSnapshot(h.device), request, undefined, reference);
    expect(result.path).toBe('/image.vert.wgsl');
    expect(result.color).toEqual([0, 0, 0, 0]);
    expect(result.events).toEqual([]);
    expect(h.compute.dispatchWorkgroups).toHaveBeenCalledWith(1);
    expect(h.buffers.every(b => b.destroy.mock.calls.length === 1)).toBe(true);
    expect(h.buffers.filter(b => b.mapAsync.mock.calls.length).every(b => b.unmap.mock.calls.length === 1)).toBe(true);
    if (reference) {
      expect(result.sites).toEqual([]);
    } else {
      expect(result.sites.length).toBeGreaterThan(0);
    }
  });

  it.each(['compilation', 'pipeline', 'validation', 'mapping', 'cancelled'] as const)('releases every allocation after %s failure', async (failure) => {
    const h = gpuHarness();
    const controller = new AbortController();
    if (failure === 'compilation') {
      h.device.createShaderModule.mockImplementation(() => ({ getCompilationInfo: vi.fn(async () => ({ messages: [{ type: 'error', message: 'replay failure' }] })) }));
    }
    if (failure === 'pipeline') {
      h.device.createComputePipelineAsync.mockRejectedValue(new Error('replay failure'));
    }
    if (failure === 'validation') {
      h.device.popErrorScope.mockResolvedValue({ message: 'replay failure' });
    }
    if (failure === 'mapping') {
      const create = h.device.createBuffer.getMockImplementation()!;
      h.device.createBuffer.mockImplementation(descriptor => {
        const result = create(descriptor);
        result.mapAsync.mockRejectedValue(new Error('replay failure'));
        return result;
      });
    }
    if (failure === 'cancelled') {
      h.device.createComputePipelineAsync.mockImplementation(async () => {
        controller.abort(new Error('replay failure')); return { getBindGroupLayout: () => ({}) }; 
      });
    }
    await expect(captureWgslVertexTraceReplay(vertexSnapshot(h.device), request, controller.signal)).rejects.toThrow('replay failure');
    expect(h.buffers.length).toBeGreaterThan(0);
    expect(h.buffers.every(b => b.destroy.mock.calls.length === 1)).toBe(true);
  });

  it('rejects unsupported optional features and missing authored hooks before allocating', async () => {
    const h = gpuHarness();
    await expect(captureWgslVertexTraceReplay(vertexSnapshot(h.device, { source: 'enable f16; fn mainImage(p: vec2f) -> vec4f { return vec4f(p,0.,1.); }' }), request)).rejects.toThrow('unavailable optional WebGPU features');
    const noHook = snapshot(h.device);
    await expect(captureWgslVertexTraceReplay(noHook, request)).rejects.toThrow('no authored vertex hook');
    await expect(captureWgslVertexTraceReplay(vertexSnapshot(h.device, { kind: 'compute' }), request)).rejects.toThrow('no vertex stage');
    expect(h.device.createBuffer).not.toHaveBeenCalled();
  });

  it('rejects missing frozen mesh buffers and uniforms without leaking partial allocations', async () => {
    const h = gpuHarness();
    await expect(captureWgslVertexTraceReplay(vertexSnapshot(h.device, { geometry: 'cube' }), request)).rejects.toThrow('no frozen mesh vertex buffer');
    await expect(captureWgslVertexTraceReplay(vertexSnapshot(h.device, { geometry: 'vertices' }), request)).rejects.toThrow('needs frozen mesh uniforms');
    expect(h.buffers.every(b => b.destroy.mock.calls.length === 1)).toBe(true);
  });

  it('can trace only authored common vertex code and retain its source identity', async () => {
    const h = gpuHarness();
    const frozen = vertexSnapshot(h.device);
    frozen.vertexPath = undefined;
    frozen.commonPath = '/common.wgsl';
    frozen.commonCode = 'fn offset() -> f32 { let value = 1.; return value; }';
    const result = await captureWgslVertexTraceReplay(frozen, { ...request, vertexIndex: 1 });
    expect(result.path).toBe('/image.wgsl');
    expect(result.sites.some(s => s.path === '/common.wgsl')).toBe(true);
    expect(h.buffers.every(b => b.destroy.mock.calls.length === 1)).toBe(true);
  });
});


