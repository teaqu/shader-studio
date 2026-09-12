import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VariableCaptureManager } from '../lib/VariableCaptureManager';
import type { RenderingEngine } from '../../../rendering/src/types/RenderingEngine';

const wgslShader = `fn mainImage(coord: vec2f) -> vec4f {
  var uv: vec2f = coord / iResolution.xy;
  var col: vec3f = vec3f(uv, 0.5);
  return vec4f(col, 1.0);
}`;

const wgslCompute = `@compute @workgroup_size(8, 8, 1)
fn update(@builtin(global_invocation_id) gid: vec3u) {
  let wave: f32 = f32(gid.x);
  writeOutput(gid.xy, vec4f(wave));
}`;

function mockEngine(language: 'glsl' | 'slang' | 'wgsl') {
  const capturer = {
    setCompileContext: vi.fn(),
    setCustomUniforms: vi.fn(),
    setInputBindings: vi.fn(),
    clearLastError: vi.fn(),
    getLastError: vi.fn<() => string | null>(() => null),
    getCaptureErrors: vi.fn<() => { varName?: string; message: string }[]>(() => []),
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
    debugLine: 2,
    pixelX: null,
    pixelY: null,
    canvasWidth: 320,
    canvasHeight: 180,
    loopMaxIters: new Map<number, number>(),
    customParams: new Map<number, string>(),
    sampleSize: 8,
    refreshMode: 'manual' as const,
    pollingMs: 0,
    filePath: '/shaders/image.wgsl',
  };
}

describe('VariableCaptureManager - WGSL engine', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      setTimeout(() => cb(performance.now()), 0) as unknown as number);
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(handle));
  });

  it('submits native WGSL plan slots after its hidden execution marker', async () => {
    const { engine, capturer } = mockEngine('wgsl');
    const manager = new VariableCaptureManager(engine, () => {});
    const plan = {
      workspaceHash: 'hash', rootUri: '/shaders/image.wgsl', selectedSourceUri: '/shaders/image.wgsl', executionMarkerSlot: 0,
      captureSlots: [{ index: 0, valueId: 'marker', name: '_marker', typeName: 'bool', hidden: true }, { index: 1, valueId: 'uv', name: 'uv', typeName: 'vec2f', hidden: false }],
      files: [{ uri: '/shaders/image.wgsl', path: '/shaders/image.wgsl', source: 'native capture source', version: 1, moduleName: '', ownerPass: 'Image' }],
    };

    manager.notifyStateChange({ ...captureParams(wgslShader), planCapture: { plan, values: [{ id: 'uv', name: 'uv', typeName: 'vec2f', sourceUri: plan.rootUri, declarationRange: { start: { line: 1, character: 6 }, end: { line: 1, character: 8 } }, access: 'readwrite' }] } });
    await vi.waitFor(() => expect(capturer.issueCaptureGrid).toHaveBeenCalled());

    const captures = (capturer.issueCaptureGrid.mock.calls[0] as unknown[])[0] as Array<{ varName: string; selectorIndex?: number; debugPlan?: unknown }>;
    expect(captures).toEqual([
      expect.objectContaining({ varName: '_marker', selectorIndex: 0, hidden: true, debugPlan: plan }),
      expect.objectContaining({ varName: 'uv', selectorIndex: 1, debugPlan: plan }),
    ]);
    // The plan language resolves its compile context against the selected file.
    expect(engine.getVariableCaptureCompileContext).toHaveBeenCalledWith(
      expect.any(String), undefined, '/shaders/image.wgsl',
    );
    manager.dispose();
  });

  it('submits a compute-pass plan against the compute buffer and file', async () => {
    const { engine, capturer } = mockEngine('wgsl');
    const manager = new VariableCaptureManager(engine, () => {});
    const computeUri = '/shaders/life.wgsl';
    // The planner replays a compute entry as a render entry, so the plan the
    // manager receives for a compute pass is shaped like any other WGSL plan;
    // what must differ is the pass name and file it resolves against.
    const plan = {
      workspaceHash: 'hash', rootUri: computeUri, selectedSourceUri: computeUri, executionMarkerSlot: 0,
      captureSlots: [
        { index: 0, valueId: 'marker', name: '_marker', typeName: 'bool', hidden: true },
        { index: 1, valueId: 'wave', name: 'wave', typeName: 'f32', hidden: false },
      ],
      files: [{ uri: computeUri, path: computeUri, source: wgslCompute, version: 1, moduleName: '', ownerPass: 'ComputeLife' }],
    };

    manager.notifyStateChange({
      ...captureParams(wgslCompute),
      filePath: computeUri,
      activeBufferName: 'ComputeLife',
      planCapture: {
        plan,
        values: [{
          id: 'wave', name: 'wave', typeName: 'f32', sourceUri: computeUri,
          declarationRange: { start: { line: 1, character: 6 }, end: { line: 1, character: 10 } }, access: 'readwrite',
        }],
      },
    });
    await vi.waitFor(() => expect(capturer.issueCaptureGrid).toHaveBeenCalled());

    const captures = (capturer.issueCaptureGrid.mock.calls[0] as unknown[])[0] as Array<{ varName: string; selectorIndex?: number; debugPlan?: unknown }>;
    expect(captures).toEqual([
      expect.objectContaining({ varName: '_marker', selectorIndex: 0, hidden: true, debugPlan: plan }),
      expect.objectContaining({ varName: 'wave', selectorIndex: 1, debugPlan: plan }),
    ]);
    expect(engine.getVariableCaptureCompileContext).toHaveBeenCalledWith(
      expect.any(String), 'ComputeLife', computeUri,
    );
    manager.dispose();
  });

  it('does not fall back to the GLSL capture builder when a WGSL plan is unavailable', async () => {
    const { engine, capturer } = mockEngine('wgsl');
    const manager = new VariableCaptureManager(engine, () => {});

    manager.notifyStateChange({ ...captureParams(wgslShader), planCapture: null });
    await vi.waitFor(() => expect(capturer.issueCaptureGrid).not.toHaveBeenCalled());

    manager.dispose();
  });

  it('treats an unavailable WGSL plan without a planning error as an empty scope', async () => {
    const { engine, capturer } = mockEngine('wgsl');
    const errors = vi.fn();
    const updates = vi.fn();
    const manager = new VariableCaptureManager(engine, updates);
    manager.setErrorCallback(errors);

    manager.notifyStateChange({ ...captureParams(wgslShader), planCapture: null });

    await vi.waitFor(() => expect(updates).toHaveBeenCalledWith([]));
    expect(errors).not.toHaveBeenCalledWith(expect.arrayContaining([expect.anything()]));
    expect(capturer.issueCaptureGrid).not.toHaveBeenCalled();
    manager.dispose();
  });

  it('reports a WGSL planning error instead of capturing', async () => {
    const { engine, capturer } = mockEngine('wgsl');
    const errors = vi.fn();
    const manager = new VariableCaptureManager(engine, () => {});
    manager.setErrorCallback(errors);

    manager.notifyStateChange({ ...captureParams(wgslShader), planCapture: null, planCaptureError: 'WGSL debug source path could not be resolved' });

    await vi.waitFor(() => expect(errors).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ message: 'WGSL debug source path could not be resolved' })]),
    ));
    expect(capturer.issueCaptureGrid).not.toHaveBeenCalled();
    manager.dispose();
  });

  it.each([
    ['f32', 1], ['f16', 1], ['i32', 1], ['u32', 1],
    ['vec2f', 2], ['vec3<f32>', 3], ['vec4u', 4], ['vec4<u32>', 4],
  ])('decodes WGSL %s captures with %i components', (varType, componentCount) => {
    const { engine } = mockEngine('wgsl');
    const updates = vi.fn();
    const manager = new VariableCaptureManager(engine, updates);
    (manager as unknown as { lastCaptureMode: string }).lastCaptureMode = 'pixel';

    (manager as unknown as { decodeAndUpdate(results: Array<{ varName: string; varType: string; rgba: Float32Array; hidden?: boolean }>): void }).decodeAndUpdate([
      { varName: 'value', varType, rgba: new Float32Array([0.375, 0.5, 0.75, 1]) },
    ]);

    const value = (updates.mock.calls.at(-1)?.[0][0] as { value: number[] }).value;
    expect(value).toHaveLength(componentCount);
    expect(value).toEqual([0.375, 0.5, 0.75, 1].slice(0, componentCount));
    manager.dispose();
  });
});
