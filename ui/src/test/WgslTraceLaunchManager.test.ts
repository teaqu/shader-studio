import type { WgslProjectTraceRequest, WgslTraceRecording } from '@shader-studio/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WgslTraceLaunchManager } from '../lib/WgslTraceLaunchManager.svelte';
import { getWgslTraceState, resetWgslTraceState, selectWgslTraceTarget } from '../lib/state/wgslTraceState.svelte';
import { setInspectorState } from '../lib/state/pixelInspectorState.svelte';

const fragment = { passName: 'Image', stage: 'fragment' as const, path: '/image.wgsl', source: 'image', width: 64, height: 64 };
const compute = { passName: 'Update', stage: 'compute' as const, path: '/update.wgsl', source: 'compute', width: 32, height: 16 };
const selected = () => setInspectorState({ isEnabled: true, isActive: true, isLocked: true, mouseX: 0, mouseY: 0, pixelRGB: { r: 0, g: 0, b: 0 }, fragCoord: { x: 20, y: 20 }, canvasPosition: { x: 20, y: 10 }, region: null });

describe('WgslTraceLaunchManager', () => {
  afterEach(() => {
    resetWgslTraceState(); setInspectorState({ isEnabled: false, isActive: false, isLocked: false, mouseX: 0, mouseY: 0, pixelRGB: null, fragCoord: null, canvasPosition: null, region: null });
  });
  function create(capture: (request: WgslProjectTraceRequest, signal?: AbortSignal) => Promise<WgslTraceRecording> = vi.fn(async () => ({ path: '/image.wgsl', source: 'image', sites: [], events: [], overflow: false, color: [0, 0, 0, 0] }))) {
    const transport = { getType: () => 'vscode' as 'vscode' | 'web', postMessage: vi.fn() };
    const engine = { getShaderLanguage: () => 'wgsl', getWgslTraceTargets: () => [fragment, compute], captureWgslProjectTrace: capture, getCanvas: () => ({ width: 128, height: 64 }), getCaptureUniforms: () => ({ res: [128, 64, 1] }) };
    const session = { isCurrentPreviewSource: true, sources: [{ path: '/image.wgsl', source: 'image' }] };
    const manager = new WgslTraceLaunchManager({ transport, getEngine: () => engine, getViewerSession: () => session });
    return { manager, transport, capture, engine, session };
  }

  it('captures the installed target before sending its immutable recording to DAP', async () => {
    selected(); const { manager, capture, transport } = create();
    await manager.start();
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ passName: 'Image', stage: 'fragment', pixel: [10, 10], capacity: 4096 }), expect.any(AbortSignal));
    expect(transport.postMessage).toHaveBeenCalledWith({ type: 'startWgslTrace', payload: expect.objectContaining({ program: '/image.wgsl', recording: expect.objectContaining({ source: 'image' }) }) });
    manager.dispose();
  });

  it('rejects stale previews, unsupported hosts and unavailable targets before GPU capture', async () => {
    selected(); const { manager, capture, session, transport, engine } = create();
    session.isCurrentPreviewSource = false;
    await manager.start();
    expect(getWgslTraceState().reason).toContain('Refresh');
    session.isCurrentPreviewSource = true;
    transport.getType = () => 'web';
    await manager.start();
    expect(getWgslTraceState().reason).toContain('VS Code');
    transport.getType = () => 'vscode';
    engine.getWgslTraceTargets = () => [];
    await manager.start();
    expect(getWgslTraceState().reason).toContain('no traceable passes');
    expect(capture).not.toHaveBeenCalled();
    manager.dispose();
  });

  it('selects project targets and exposes compute invocation controls', () => {
    selected(); const { manager } = create();
    expect(getWgslTraceState().selectedTarget).toBe('Image:fragment');
    selectWgslTraceTarget('Update:compute');
    expect(getWgslTraceState().selectedTarget).toBe('Update:compute');
    manager.dispose();
  });

  it('reports capture errors and cancels an in-flight recording on disposal', async () => {
    selected(); let abort!: () => void;
    const capture = vi.fn((_request: WgslProjectTraceRequest, signal?: AbortSignal) => new Promise<WgslTraceRecording>((_, reject) => {
      abort = () => reject(new Error('GPU lost')); signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const { manager } = create(capture);
    const pending = manager.start();
    expect(getWgslTraceState().busy).toBe(true);
    await manager.start();
    expect(capture).toHaveBeenCalledTimes(1);
    abort(); await pending;
    expect(getWgslTraceState().reason).toBe('GPU lost');
    const second = manager.start(); manager.dispose(); await second;
  });
});
