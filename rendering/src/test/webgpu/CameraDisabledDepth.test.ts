import { describe, expect, it, vi } from 'vitest';
import { SlangPassPipeline } from '../../webgpu/SlangPassPipeline';

describe('mesh depth at the clip boundary', () => {
  it.each([
    { useViewerCamera: undefined, expected: 'less' },
    { useViewerCamera: true, expected: 'less' },
    { useViewerCamera: false, expected: 'less-equal' },
  ])('uses $expected depth comparison when viewer camera is $useViewerCamera', async ({ useViewerCamera, expected }) => {
    const createRenderPipeline = vi.fn((_descriptor: GPURenderPipelineDescriptor) => ({ getBindGroupLayout: vi.fn(() => ({})) }));
    const device = {
      createShaderModule: vi.fn(() => ({ getCompilationInfo: async () => ({ messages: [] }) })),
      createRenderPipeline,
      createBindGroupLayout: vi.fn(() => ({})),
      createPipelineLayout: vi.fn(() => ({})),
      createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
      createTexture: vi.fn(() => ({ createView: vi.fn(() => ({})), destroy: vi.fn() })),
      createSampler: vi.fn(() => ({})),
      createBindGroup: vi.fn(() => ({})),
      pushErrorScope: vi.fn(),
      popErrorScope: vi.fn(async () => null),
    } as unknown as GPUDevice;
    const pipeline = new SlangPassPipeline(device, 'bgra8unorm', {
      name: 'Image', width: 64, height: 64, output: 'canvas', geometry: 'cube', channels: [],
      ...{ useViewerCamera },
    });
    try {
      expect(await pipeline.rebuild('// compiled shader')).toEqual([]);
      expect(createRenderPipeline.mock.calls[0]?.[0]).toMatchObject({
        depthStencil: { depthWriteEnabled: true, depthCompare: expected },
      });
    } finally {
      pipeline.dispose();
    }
  });
});
