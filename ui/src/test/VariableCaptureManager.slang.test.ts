import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VariableCaptureManager } from '../lib/VariableCaptureManager';
import { CaptureDecoder } from '../../../rendering/src/capture/CaptureDecoder';
import type { RenderingEngine } from '../../../rendering/src/types/RenderingEngine';

const slangShader = `float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float3 col = float3(uv, 0.5);
    return float4(col, 1.0);
}`;

function mockEngine(language: 'glsl' | 'slang') {
  const capturer = {
    setCompileContext: vi.fn(),
    setCustomUniforms: vi.fn(),
    setInputBindings: vi.fn(),
    clearLastError: vi.fn(),
    getLastError: vi.fn(() => null),
    issueCaptureAtPixel: vi.fn(async () => 1),
    issueCaptureGrid: vi.fn(async () => 1),
    collectResults: vi.fn(() => []),
    cancelPendingCaptures: vi.fn(),
    dispose: vi.fn(),
  };
  const engine = {
    createVariableCapturer: vi.fn(() => capturer),
    getVariableCaptureCompileContext: vi.fn(() => ({ commonCode: '' })),
    getCaptureUniforms: vi.fn(() => ({
      time: 0, timeDelta: 0, frameRate: 60, frame: 0,
      res: [320, 180, 1], mouse: [0, 0, 0, 0], date: [0, 0, 0, 0],
      cameraPos: [0, 0, 0], cameraDir: [0, 0, -1],
    })),
    getCustomUniformInfo: vi.fn(() => []),
    getCustomUniformDeclarations: vi.fn(() => ''),
    getCurrentCustomUniforms: vi.fn(() => []),
    getShaderLanguage: vi.fn(() => language),
  } as unknown as RenderingEngine;
  return { engine, capturer };
}

function captureParams(code: string) {
  return {
    code,
    debugLine: 3,
    pixelX: null,
    pixelY: null,
    canvasWidth: 320,
    canvasHeight: 180,
    loopMaxIters: new Map<number, number>(),
    customParams: new Map<number, string>(),
    sampleSize: 8,
    refreshMode: 'manual' as const,
    pollingMs: 0,
    filePath: '/shaders/image.slang',
  };
}

describe('CaptureDecoder - Slang types', () => {
  it('decodes Slang vector types with the right component counts', () => {
    const rgba = new Float32Array([1, 2, 3, 4]);
    expect(CaptureDecoder.decodePixel(rgba, 'float2')).toEqual([1, 2]);
    expect(CaptureDecoder.decodePixel(rgba, 'float3')).toEqual([1, 2, 3]);
    expect(CaptureDecoder.decodePixel(rgba, 'float4')).toEqual([1, 2, 3, 4]);
    expect(CaptureDecoder.decodePixel(rgba, 'float2x2')).toEqual([1, 2, 3, 4]);
  });
});

describe('VariableCaptureManager - Slang engine', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      setTimeout(() => cb(performance.now()), 0) as unknown as number);
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(handle));
  });

  it('issues grid captures with Slang-typed variables from a Slang shader', async () => {
    const { engine, capturer } = mockEngine('slang');
    const manager = new VariableCaptureManager(engine, () => {});

    manager.notifyStateChange(captureParams(slangShader));
    await vi.waitFor(() => {
      expect(capturer.issueCaptureGrid).toHaveBeenCalled();
    });

    const captures = (capturer.issueCaptureGrid.mock.calls[0] as unknown[])[0] as Array<{ varName: string; varType: string; captureShader: string }>;
    const names = captures.map(c => c.varName);
    expect(names).toContain('uv');
    expect(names).toContain('col');
    expect(captures.find(c => c.varName === 'col')!.varType).toBe('float3');
    // Slang capture shader: selector returns, no GLSL uniform declarations
    expect(captures[0].captureShader).toContain('_dbgVarIndex');
    expect(captures[0].captureShader).not.toContain('uniform ');
    expect(captures[0].captureShader).not.toContain('vec4(');
    expect(engine.getVariableCaptureCompileContext).toHaveBeenCalledWith(
      slangShader,
      undefined,
      '/shaders/image.slang',
    );
    manager.dispose();
  });
});
