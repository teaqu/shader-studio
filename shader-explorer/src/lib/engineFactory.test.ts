import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockWebGLEngine,
  mockWebGPUEngine,
  mockSlangAssets,
  MockWebGLRenderingEngine,
  MockWebGPURenderingEngine,
  mockGetSlangAssetUrls,
} = vi.hoisted(() => {
  const mockWebGLEngine = { kind: 'webgl' };
  const mockWebGPUEngine = { kind: 'webgpu' };
  const mockSlangAssets = {
    scriptUrl: 'vscode-webview://shader/slang.js',
    wasmUrl: 'vscode-webview://shader/slang.wasm',
    workerUrl: 'vscode-webview://shader/slang-worker.js',
    debugTimings: true,
  };

  return {
    mockWebGLEngine,
    mockWebGPUEngine,
    mockSlangAssets,
    MockWebGLRenderingEngine: vi.fn(() => mockWebGLEngine),
    MockWebGPURenderingEngine: vi.fn(() => mockWebGPUEngine),
    mockGetSlangAssetUrls: vi.fn(() => mockSlangAssets),
  };
});

vi.mock('../../../rendering/src/webgl/RenderingEngine', () => ({
  RenderingEngine: MockWebGLRenderingEngine,
}));

vi.mock('../../../rendering/src/webgpu/WebGPURenderingEngine', () => ({
  WebGPURenderingEngine: MockWebGPURenderingEngine,
}));

vi.mock('./slangAssets', () => ({
  getSlangAssetUrls: mockGetSlangAssetUrls,
}));

import { createEngineForLanguage } from './engineFactory';

describe('createEngineForLanguage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a WebGL engine for GLSL', () => {
    expect(createEngineForLanguage('glsl')).toBe(mockWebGLEngine);
    expect(MockWebGLRenderingEngine).toHaveBeenCalledTimes(1);
    expect(MockWebGPURenderingEngine).not.toHaveBeenCalled();
    expect(mockGetSlangAssetUrls).not.toHaveBeenCalled();
  });

  it('creates a WebGL engine when the language is undefined', () => {
    expect(createEngineForLanguage(undefined)).toBe(mockWebGLEngine);
    expect(MockWebGLRenderingEngine).toHaveBeenCalledTimes(1);
    expect(MockWebGPURenderingEngine).not.toHaveBeenCalled();
    expect(mockGetSlangAssetUrls).not.toHaveBeenCalled();
  });

  it('creates a WebGPU engine with the exact Slang asset object', () => {
    expect(createEngineForLanguage('slang')).toBe(mockWebGPUEngine);
    expect(mockGetSlangAssetUrls).toHaveBeenCalledTimes(1);
    expect(MockWebGPURenderingEngine).toHaveBeenCalledTimes(1);
    expect(MockWebGPURenderingEngine).toHaveBeenCalledWith(mockSlangAssets);
    expect(MockWebGLRenderingEngine).not.toHaveBeenCalled();
  });

  it('propagates asset lookup errors without constructing either engine', () => {
    const lookupError = new Error('Missing Slang asset metadata for worker');
    mockGetSlangAssetUrls.mockImplementationOnce(() => {
      throw lookupError;
    });

    expect(() => createEngineForLanguage('slang')).toThrow(lookupError);
    expect(MockWebGLRenderingEngine).not.toHaveBeenCalled();
    expect(MockWebGPURenderingEngine).not.toHaveBeenCalled();
  });
});
