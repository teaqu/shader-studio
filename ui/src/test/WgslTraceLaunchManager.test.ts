import type { WgslProjectTraceRequest, WgslProjectTraceTarget, WgslTraceRecording } from '@shader-studio/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WgslTraceLaunchManager } from '../lib/WgslTraceLaunchManager.svelte';
import { getWgslTraceState, requestWgslTraceStart, resetWgslTraceState, selectWgslTraceTarget, setWgslTraceInvocation, setWgslTraceVertexIndex } from '../lib/state/wgslTraceState.svelte';
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
    const engine = { getShaderLanguage: () => 'wgsl', getWgslTraceTargets: (): WgslProjectTraceTarget[] => [fragment, compute], captureWgslProjectTrace: capture, getCanvas: () => ({ width: 128, height: 64 }), getCaptureUniforms: () => ({ res: [128, 64, 1] }) };
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

  it('captures normalized compute and vertex selections using fallback preview dimensions', async () => {
    selected(); const { manager, capture, engine, session } = create();
    engine.getCanvas = () => ({ width: 0, height: 0 });
    engine.getCaptureUniforms = () => ({ res: [] });
    delete (session as { sources?: unknown }).sources;
    selectWgslTraceTarget('Update:compute'); setWgslTraceInvocation(0, 5); setWgslTraceInvocation(1, -1); setWgslTraceInvocation(2, 1.5);
    manager.refresh();
    expect(getWgslTraceState().selectedTarget).toBe('Update:compute');
    await manager.start();
    expect(capture).toHaveBeenLastCalledWith({ passName: 'Update', stage: 'compute', capacity: 4096, pixel: [20, 10], invocation: [5, 0, 0] }, expect.any(AbortSignal));
    const vertex = { ...fragment, stage: 'vertex' as const };
    engine.getWgslTraceTargets = () => [vertex];
    manager.refresh(); setWgslTraceVertexIndex(-2); expect(getWgslTraceState().vertexIndex).toBe(0);
    setWgslTraceVertexIndex(9); await manager.start();
    expect(capture).toHaveBeenLastCalledWith(expect.objectContaining({ stage: 'vertex', vertexIndex: 9 }), expect.any(AbortSignal));
    manager.dispose();
  });

  it('requires a selected pixel and a ready WGSL capture engine', async () => {
    const transport = { getType: () => 'vscode' as const, postMessage: vi.fn() };
    let engine: ReturnType<ConstructorParameters<typeof WgslTraceLaunchManager>[0]['getEngine']>;
    const manager = new WgslTraceLaunchManager({ transport, getEngine: () => engine, getViewerSession: () => ({ isCurrentPreviewSource: true }) });
    expect(getWgslTraceState().reason).toContain('ready WebGPU');
    engine = { getShaderLanguage: () => 'glsl', getCaptureUniforms: () => ({ res: [] }), captureWgslProjectTrace: vi.fn() };
    await manager.start(); expect(getWgslTraceState().reason).toContain('no traceable');
    engine.getShaderLanguage = () => 'wgsl';
    manager.refresh(); expect(getWgslTraceState().targets).toEqual([]);
    engine.getWgslTraceTargets = () => [fragment];
    await manager.start(); expect(getWgslTraceState().reason).toBe('Select a pixel to trace.');
    manager.dispose();
  });

  it('starts through the shared control and reports non-Error failures', async () => {
    selected(); const { manager, capture } = create(vi.fn(() => Promise.reject('device unavailable')));
    requestWgslTraceStart();
    await vi.waitFor(() => expect(getWgslTraceState().busy).toBe(false));
    expect(getWgslTraceState().reason).toBe('device unavailable');
    manager.dispose(); await manager.start(); requestWgslTraceStart();
    expect(capture).toHaveBeenCalledOnce();
  });

  it('keeps replacement trace controls registered when the prior viewer is disposed', async () => {
    selected(); const previous = create(); const replacement = create();
    previous.manager.dispose();
    selectWgslTraceTarget('Update:compute'); setWgslTraceInvocation(0, 6); setWgslTraceVertexIndex(8);
    expect(getWgslTraceState()).toMatchObject({ selectedTarget: 'Update:compute', invocation: [6, 0, 0], vertexIndex: 8 });
    requestWgslTraceStart();
    await vi.waitFor(() => expect(replacement.capture).toHaveBeenCalledOnce());
    expect(previous.capture).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(replacement.transport.postMessage).toHaveBeenCalledOnce());
    replacement.manager.dispose();
    requestWgslTraceStart();
    expect(replacement.capture).toHaveBeenCalledOnce();
  });

  it('does not hand off a recording completed after disposal', async () => {
    selected(); let resolve!: (recording: WgslTraceRecording) => void;
    const { manager, transport } = create(() => new Promise(done => {
      resolve = done;
    }));
    const pending = manager.start(); manager.dispose();
    resolve({ path: '/image.wgsl', source: 'image', sites: [], events: [], overflow: false, color: [] });
    await pending; expect(transport.postMessage).not.toHaveBeenCalled();
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
