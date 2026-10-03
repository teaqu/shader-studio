import { afterEach, describe, expect, it, vi } from 'vitest';
import { WgslTraceLaunchManager } from '../lib/WgslTraceLaunchManager.svelte';
import { getWgslTraceState, resetWgslTraceState } from '../lib/state/wgslTraceState.svelte';
import { setInspectorState } from '../lib/state/pixelInspectorState.svelte';

const selectedPixel = () => setInspectorState({
  isEnabled: true, isActive: true, isLocked: true, mouseX: 0, mouseY: 0,
  pixelRGB: { r: 0, g: 0, b: 0 }, fragCoord: { x: 12, y: 24 },
  canvasPosition: { x: 12, y: 39 }, region: null,
});

describe('WgslTraceLaunchManager', () => {
  afterEach(() => {
    resetWgslTraceState();
    setInspectorState({ isEnabled: false, isActive: false, isLocked: false, mouseX: 0, mouseY: 0,
      pixelRGB: null, fragCoord: null, canvasPosition: null, region: null });
  });

  function create(overrides: Record<string, unknown> = {}) {
    const transport = { getType: () => 'vscode' as const, postMessage: vi.fn() };
    const engine = {
      getShaderLanguage: () => 'wgsl',
      getCaptureUniforms: () => ({ time: 1.25, timeDelta: 0.016, frameRate: 60, frame: 75,
        res: [64, 64, 1], mouse: [1, 2, 3, 4], date: [2026, 10, 3, 12],
        cameraPos: [0, 0, 0], cameraDir: [0, 0, -1], sampleRate: 48_000 }),
      getCurrentCustomUniforms: () => [{ name: 'gain', type: 'float', value: 0.5 }],
    };
    const session = { source: 'fn mainImage(p: vec2f) -> vec4f { return vec4f(1.0); }', path: '/shader.wgsl', config: null, isCurrentPreviewSource: true };
    const manager = new WgslTraceLaunchManager({ transport, getEngine: () => engine, getViewerSession: () => session, ...overrides });
    return { manager, transport, engine, session };
  }

  it('sends the selected top-left pixel and an atomic viewer-uniform snapshot', () => {
    selectedPixel();
    const { manager, transport } = create();

    manager.start();

    expect(transport.postMessage).toHaveBeenCalledWith({
      type: 'startWgslTrace',
      payload: expect.objectContaining({
        program: '/shader.wgsl', source: 'fn mainImage(p: vec2f) -> vec4f { return vec4f(1.0); }', pixel: [12, 39], width: 64, height: 64,
        time: 1.25, frame: 75, capacity: 4096,
        customUniforms: [{ name: 'gain', type: 'float', value: 0.5 }],
        uniforms: { timeDelta: 0.016, frameRate: 60, mouse: [1, 2, 3, 4], date: [2026, 10, 3, 12],
          cameraPos: [0, 0, 0], cameraDir: [0, 0, -1], sampleRate: 48_000 },
      }),
    });
    manager.dispose();
  });

  it.each([
    ['a WebGPU WGSL Image preview', { getEngine: () => ({ getShaderLanguage: () => 'glsl' }) }],
    ['a selected pixel', { getViewerSession: () => ({ source: 'fn mainImage() {}', path: '/shader.wgsl', config: null, isCurrentPreviewSource: true }) }],
  ])('refuses tracing without %s', (_label, overrides) => {
    const { manager, transport } = create(overrides);
    manager.start();
    expect(transport.postMessage).not.toHaveBeenCalled();
    expect(getWgslTraceState().reason).not.toBeNull();
    manager.dispose();
  });

  it('refuses configured resources instead of tracing a mismatched preview', () => {
    selectedPixel();
    const { manager, transport } = create({ getViewerSession: () => ({
      source: 'fn mainImage() {}', path: '/shader.wgsl', config: { storage: { values: {} }, passes: { Image: {} } }, isCurrentPreviewSource: true,
    }) });

    manager.start();

    expect(transport.postMessage).not.toHaveBeenCalled();
    expect(getWgslTraceState().reason).toContain('without resources');
    manager.dispose();
  });

  it('refuses a stale preview source before it can disagree with the editor', () => {
    selectedPixel();
    const { manager, transport } = create({ getViewerSession: () => ({
      source: 'fn mainImage() {}', path: '/shader.wgsl', config: null, isCurrentPreviewSource: false,
    }) });

    manager.start();

    expect(transport.postMessage).not.toHaveBeenCalled();
    expect(getWgslTraceState().reason).toContain('Refresh the Image preview');
    manager.dispose();
  });

  it('uses the shared launch validation before sending a resolution the trace cannot render', () => {
    selectedPixel();
    const { manager, transport } = create({ getEngine: () => ({
      getShaderLanguage: () => 'wgsl',
      getCaptureUniforms: () => ({ time: 0, timeDelta: 0, frameRate: 60, frame: 0, res: [2049, 64, 1],
        mouse: [0, 0, 0, 0], date: [0, 0, 0, 0], cameraPos: [0, 0, 0], cameraDir: [0, 0, 0], sampleRate: 44_100 }),
      getCurrentCustomUniforms: () => [],
    }) });

    manager.start();

    expect(transport.postMessage).not.toHaveBeenCalled();
    expect(getWgslTraceState().reason).toBe('Trace width and height must be integers from 1 to 2048.');
    manager.dispose();
  });

  it('copies explicit custom uniform components before posting the trace launch', () => {
    selectedPixel();
    const uniform = { name: 'offset', type: 'vec2', value: [0.25, 0.5] };
    const { manager, transport } = create({ getEngine: () => ({
      getShaderLanguage: () => 'wgsl',
      getCaptureUniforms: () => ({ time: 0, timeDelta: 0, frameRate: 60, frame: 0, res: [64, 64, 1],
        mouse: [0, 0, 0, 0], date: [0, 0, 0, 0], cameraPos: [0, 0, 0], cameraDir: [0, 0, 0], sampleRate: 44_100 }),
      getCurrentCustomUniforms: () => [uniform],
    }) });

    manager.start();
    uniform.value[0] = 99;

    const payload = (transport.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].payload;
    expect(payload.customUniforms[0].value).toEqual([0.25, 0.5]);
    manager.dispose();
  });

  it('shows the shared validator error for custom uniform types the trace cannot pack', () => {
    selectedPixel();
    const { manager, transport } = create({ getEngine: () => ({
      getShaderLanguage: () => 'wgsl',
      getCaptureUniforms: () => ({ time: 0, timeDelta: 0, frameRate: 60, frame: 0, res: [64, 64, 1],
        mouse: [0, 0, 0, 0], date: [0, 0, 0, 0], cameraPos: [0, 0, 0], cameraDir: [0, 0, 0], sampleRate: 44_100 }),
      getCurrentCustomUniforms: () => [{ name: 'matrix', type: 'mat4', value: [0, 0, 0, 0] }],
    }) });

    manager.start();

    expect(transport.postMessage).not.toHaveBeenCalled();
    expect(getWgslTraceState().reason).toBe('Unsupported trace custom uniform type: mat4.');
    manager.dispose();
  });
});
