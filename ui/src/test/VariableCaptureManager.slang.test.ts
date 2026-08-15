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
    getLastError: vi.fn<() => string | null>(() => null),
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

  it('submits native Slang plan slots after its hidden execution marker', async () => {
    const { engine, capturer } = mockEngine('slang');
    const manager = new VariableCaptureManager(engine, () => {});
    const plan = {
      workspaceHash: 'hash', rootUri: 'file:///shaders/image.slang', selectedSourceUri: 'file:///shaders/image.slang', executionMarkerSlot: 0,
      captureSlots: [{ index: 0, valueId: 'marker', name: '_marker', typeName: 'bool', hidden: true }, { index: 1, valueId: 'uv', name: 'uv', typeName: 'float2', hidden: false }],
      files: [{ uri: 'file:///shaders/image.slang', path: '/shaders/image.slang', source: 'native capture source', version: 1, moduleName: '', ownerPass: 'Image' }],
    };

    manager.notifyStateChange({ ...captureParams(slangShader), slangCapture: { plan, values: [{ id: 'uv', name: 'uv', typeName: 'float2', sourceUri: plan.rootUri, declarationRange: { start: { line: 2, character: 4 }, end: { line: 2, character: 6 } }, access: 'readwrite' }] } });
    await vi.waitFor(() => expect(capturer.issueCaptureGrid).toHaveBeenCalled());

    const captures = (capturer.issueCaptureGrid.mock.calls[0] as unknown[])[0] as Array<{ varName: string; selectorIndex?: number; slangPlan?: unknown }>;
    expect(captures).toEqual([
      expect.objectContaining({ varName: '_marker', selectorIndex: 0, hidden: true, slangPlan: plan }),
      expect.objectContaining({ varName: 'uv', selectorIndex: 1, slangPlan: plan }),
    ]);
    manager.dispose();
  });

  it('does not fall back to the GLSL capture builder when a Slang plan is unavailable', async () => {
    const { engine, capturer } = mockEngine('slang');
    const manager = new VariableCaptureManager(engine, () => {});

    manager.notifyStateChange({ ...captureParams(slangShader), slangCapture: null });
    await vi.waitFor(() => expect(capturer.issueCaptureGrid).not.toHaveBeenCalled());

    manager.dispose();
  });

  it('reports a native Slang capture planning failure instead of compiling it as GLSL', async () => {
    const { engine, capturer } = mockEngine('slang');
    const errors = vi.fn();
    const manager = new VariableCaptureManager(engine, () => {});
    manager.setErrorCallback(errors);

    manager.notifyStateChange({
      ...captureParams(slangShader),
      activeBufferName: 'ComputeLife',
      slangCapture: null,
      slangCaptureError: 'Native Slang capture planning failed.',
    });

    await vi.waitFor(() => expect(errors).toHaveBeenCalledWith(
      'Native Slang capture planning failed.',
    ));
    expect(capturer.issueCaptureGrid).not.toHaveBeenCalled();
    manager.dispose();
  });

  it('reports native capture failures against the selected imported module', async () => {
    const { engine, capturer } = mockEngine('slang');
    capturer.issueCaptureGrid.mockResolvedValue(0);
    capturer.getLastError.mockReturnValue('/shaders/helper.slang: unexpected token');
    const errors = vi.fn();
    const manager = new VariableCaptureManager(engine, () => {});
    manager.setErrorCallback(errors);
    const plan = {
      workspaceHash: 'hash', rootUri: 'file:///shaders/image.slang', selectedSourceUri: 'file:///shaders/helper.slang', executionMarkerSlot: 0,
      captureSlots: [
        { index: 0, valueId: 'marker', name: '_marker', typeName: 'bool', hidden: true },
        { index: 1, valueId: 'helper-value', name: 'helperValue', typeName: 'float', hidden: false },
      ],
      files: [
        { uri: 'file:///shaders/image.slang', path: '/shaders/image.slang', source: slangShader, version: 1, moduleName: '', ownerPass: 'Image' },
        { uri: 'file:///shaders/helper.slang', path: '/shaders/helper.slang', source: 'module Helper;', version: 1, moduleName: 'Helper', ownerPass: 'Image' },
      ],
    };

    manager.notifyStateChange({
      ...captureParams(slangShader),
      slangCapture: {
        plan,
        values: [{
          id: 'helper-value', name: 'helperValue', typeName: 'float', sourceUri: plan.selectedSourceUri,
          declarationRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 11 } }, access: 'readwrite',
        }],
      },
    });

    await vi.waitFor(() => expect(errors).toHaveBeenCalledWith('Failed to capture variables:\n/shaders/helper.slang: unexpected token'));
    manager.dispose();
  });

  it('publishes user values when the execution marker is set', () => {
    const { engine } = mockEngine('slang');
    const updates = vi.fn();
    const errors = vi.fn();
    const manager = new VariableCaptureManager(engine, updates);
    manager.setErrorCallback(errors);
    (manager as unknown as { lastCaptureMode: string }).lastCaptureMode = 'pixel';

    (manager as unknown as { decodeAndUpdate(results: Array<{ varName: string; varType: string; rgba: Float32Array; hidden?: boolean }>): void }).decodeAndUpdate([
      { varName: '_marker', varType: 'bool', hidden: true, rgba: new Float32Array([1, 0, 0, 1]) },
      { varName: 'uv', varType: 'float2', rgba: new Float32Array([0.25, 0.75, 0, 1]) },
    ]);

    expect(errors).not.toHaveBeenCalledWith('Selected Slang statement was not executed for this capture');
    expect(updates).toHaveBeenLastCalledWith([expect.objectContaining({ varName: 'uv', value: [0.25, 0.75] })]);
    expect(updates.mock.calls.flat().some((value) => (value as { varName?: string }).varName === '_marker')).toBe(false);
    manager.dispose();
  });

  it('hides user values and reports a diagnostic when the execution marker is clear', () => {
    const { engine } = mockEngine('slang');
    const updates = vi.fn();
    const errors = vi.fn();
    const manager = new VariableCaptureManager(engine, updates);
    manager.setErrorCallback(errors);

    (manager as unknown as { decodeAndUpdate(results: Array<{ varName: string; varType: string; rgba: Float32Array; hidden?: boolean }>): void }).decodeAndUpdate([
      { varName: '_marker', varType: 'bool', hidden: true, rgba: new Float32Array([0, 0, 0, 1]) },
      { varName: 'uv', varType: 'float2', rgba: new Float32Array([0.25, 0.75, 0, 1]) },
    ]);

    expect(errors).toHaveBeenLastCalledWith('Selected Slang statement was not executed for this capture');
    expect(updates).toHaveBeenLastCalledWith([]);
    manager.dispose();
  });

  it('keeps grid values when any captured sample executed the selected statement', () => {
    const { engine } = mockEngine('slang');
    const updates = vi.fn();
    const manager = new VariableCaptureManager(engine, updates);

    (manager as unknown as { decodeAndUpdate(results: Array<{ varName: string; varType: string; rgba: Float32Array; hidden?: boolean }>): void }).decodeAndUpdate([
      { varName: '_marker', varType: 'bool', hidden: true, rgba: new Float32Array([0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 1]) },
      { varName: 'value', varType: 'float', rgba: new Float32Array([10, 0, 0, 1, 20, 0, 0, 1, 30, 0, 0, 1, 40, 0, 0, 1]) },
    ]);

    expect(updates).toHaveBeenLastCalledWith([expect.objectContaining({ varName: 'value' })]);
    expect(updates.mock.calls.flat().some((value) => (value as { varName?: string }).varName === '_marker')).toBe(false);
    manager.dispose();
  });
});
