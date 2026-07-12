import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockWebGLEngine,
  mockWebGPUEngine,
  MockWebGLRenderingEngine,
  MockWebGPURenderingEngine,
  mockGetSlangAssetUrls,
} = vi.hoisted(() => {
  const mockWebGLEngine = { kind: 'webgl' };
  const mockWebGPUEngine = { kind: 'webgpu' };
  return {
    mockWebGLEngine,
    mockWebGPUEngine,
    MockWebGLRenderingEngine: vi.fn(() => mockWebGLEngine),
    MockWebGPURenderingEngine: vi.fn(() => mockWebGPUEngine),
    mockGetSlangAssetUrls: vi.fn(() => ({ scriptUrl: '/mock/slang-wasm.js', wasmUrl: '/mock/slang-wasm.wasm' })),
  };
});

vi.mock('../../../rendering/src/webgl/RenderingEngine', () => ({
  RenderingEngine: MockWebGLRenderingEngine,
}));

vi.mock('../../../rendering/src/webgpu/WebGPURenderingEngine', () => ({
  WebGPURenderingEngine: MockWebGPURenderingEngine,
}));

vi.mock('../lib/slangAssets', () => ({
  getSlangAssetUrls: () => mockGetSlangAssetUrls(),
}));

import { createEngineForLanguage } from '../lib/engineFactory';

describe('createEngineForLanguage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a WebGL engine for glsl', () => {
    const engine = createEngineForLanguage('glsl');

    expect(engine).toBe(mockWebGLEngine);
    expect(MockWebGLRenderingEngine).toHaveBeenCalledTimes(1);
    expect(MockWebGPURenderingEngine).not.toHaveBeenCalled();
  });

  it('creates a WebGPU engine with Slang asset URLs for slang', () => {
    const engine = createEngineForLanguage('slang');

    expect(engine).toBe(mockWebGPUEngine);
    expect(MockWebGPURenderingEngine).toHaveBeenCalledWith(mockGetSlangAssetUrls());
    expect(MockWebGLRenderingEngine).not.toHaveBeenCalled();
  });

  it('defaults to a WebGL engine when language is undefined', () => {
    const engine = createEngineForLanguage(undefined);

    expect(engine).toBe(mockWebGLEngine);
    expect(MockWebGPURenderingEngine).not.toHaveBeenCalled();
  });
});
