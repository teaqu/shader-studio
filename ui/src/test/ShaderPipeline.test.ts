import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShaderPipeline } from '../lib/ShaderPipeline';
import type { ShaderLocker } from '../lib/ShaderLocker';
import type { ShaderDebugManager } from '../lib/ShaderDebugManager';
import type { Transport } from '../lib/transport/MessageTransport';
import type { RenderingEngine } from '../../../rendering/src/types/RenderingEngine';
import type { CursorPositionMessage } from '@shader-studio/types';
import { ShaderCompilationState } from '../lib/state/ShaderCompilationState.svelte';

vi.mock('../lib/state/editorOverlayState.svelte', () => ({
  getEditorOverlayVisible: vi.fn(() => false),
}));

import { getEditorOverlayVisible } from '../lib/state/editorOverlayState.svelte';

function makeMocks() {
  const transport: Transport = {
    postMessage: vi.fn(),
    onMessage: vi.fn(),
    dispose: vi.fn(),
    getType: () => 'vscode' as const,
    isConnected: () => true,
  };

  const renderEngine = {
    getCurrentConfig: vi.fn(() => null),
    getPasses: vi.fn(() => []),
    cleanup: vi.fn(),
  } as unknown as RenderingEngine;

  const shaderLocker = {
    isLocked: vi.fn(() => false),
    getLockedShaderPath: vi.fn(() => undefined),
  } as unknown as ShaderLocker;

  const debugState = {
    isActive: false,
    isEnabled: false,
    currentLine: 0,
    lineContent: '',
    filePath: null,
    activeBufferName: 'Image',
    functionContext: null,
    isLineLocked: false,
    isInlineRenderingEnabled: true,
    normalizeMode: 'off' as const,
    isStepEnabled: false,
    stepEdge: 0.5,
    debugError: null,
    debugNotice: null,
    isVariableInspectorEnabled: false,
    isErrorsEnabled: false,
    capturedVariables: [],
  };

  const shaderDebugManager = {
    updateDebugLine: vi.fn(),
    getState: vi.fn(() => ({ ...debugState })),
    setShaderContext: vi.fn(),
    getDebugTarget: vi.fn(),
    modifyShaderForDebugging: vi.fn(() => null),
    setStateCallback: vi.fn(),
    setRecompileCallback: vi.fn(),
    setCaptureStateCallback: vi.fn(),
    setOriginalCode: vi.fn(),
  } as unknown as ShaderDebugManager;

  return { transport, renderEngine, shaderLocker, shaderDebugManager, debugState };
}

describe('ShaderPipeline — overlay cursor gate', () => {
  let pipeline: ShaderPipeline;
  let mocks: ReturnType<typeof makeMocks>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = makeMocks();
    pipeline = new ShaderPipeline(
      mocks.transport,
      mocks.renderEngine,
      mocks.shaderLocker,
      mocks.shaderDebugManager,
    );
  });

  const cursorMsg = (filePath = '/shader.glsl'): CursorPositionMessage => ({
    type: 'cursorPosition',
    payload: { line: 5, character: 0, lineContent: 'float x = 1.0;', filePath },
  });

  describe('handleCursorPositionMessage', () => {
    it('calls updateDebugLine when overlay is hidden', () => {
      vi.mocked(getEditorOverlayVisible).mockReturnValue(false);

      pipeline.handleCursorPositionMessage(cursorMsg());

      expect(mocks.shaderDebugManager.updateDebugLine).toHaveBeenCalledWith(
        5, 'float x = 1.0;', '/shader.glsl',
      );
    });

    it('skips updateDebugLine when overlay is visible', () => {
      vi.mocked(getEditorOverlayVisible).mockReturnValue(true);

      pipeline.handleCursorPositionMessage(cursorMsg());

      expect(mocks.shaderDebugManager.updateDebugLine).not.toHaveBeenCalled();
    });

    it('ignores cursor updates from files outside the current shader when unlocked', () => {
      vi.mocked(getEditorOverlayVisible).mockReturnValue(false);
      const config = {
        passes: {
          Image: { inputs: [] },
          BufferA: { path: '/project/bufferA.glsl', inputs: [] },
        },
      };
      vi.mocked(mocks.renderEngine.getCurrentConfig).mockReturnValue(config as any);
      (pipeline as any).lastEvent = {
        data: {
          type: 'shaderSource',
          path: '/project/current.glsl',
          config,
          buffers: { BufferA: 'void mainImage() {}' },
        },
      } as MessageEvent;

      pipeline.handleCursorPositionMessage(cursorMsg('/project/other.glsl'));

      expect(mocks.shaderDebugManager.updateDebugLine).not.toHaveBeenCalled();
    });
  });

  describe('handleOverlayCursor', () => {
    it('calls updateDebugLine with shader path for Image buffer', () => {
      const fakeEvent = {
        data: {
          type: 'shader',
          code: 'void mainImage() {}',
          path: '/my/shader.glsl',
          config: { passes: { Image: { inputs: [] } } },
          buffers: {},
        },
      } as unknown as MessageEvent;
      (pipeline as any).lastEvent = fakeEvent;

      pipeline.handleOverlayCursor(10, 'vec3 col = vec3(1.0);', 'Image');

      expect(mocks.shaderDebugManager.updateDebugLine).toHaveBeenCalledWith(
        10, 'vec3 col = vec3(1.0);', '/my/shader.glsl',
      );
    });

    it('calls updateDebugLine with buffer config path for a named buffer', () => {
      vi.mocked(mocks.renderEngine.getCurrentConfig).mockReturnValue({
        passes: {
          Image: { inputs: [] },
          BufferA: { path: '/my/bufferA.glsl', inputs: [] },
        },
      } as any);

      pipeline.handleOverlayCursor(3, 'float t = iTime;', 'BufferA');

      expect(mocks.shaderDebugManager.updateDebugLine).toHaveBeenCalledWith(
        3, 'float t = iTime;', '/my/bufferA.glsl',
      );
    });

    it('falls back to bufferName as path identifier when no config resolves', () => {
      vi.mocked(mocks.renderEngine.getCurrentConfig).mockReturnValue(null);

      pipeline.handleOverlayCursor(1, 'void mainImage() {}', 'BufferB');

      expect(mocks.shaderDebugManager.updateDebugLine).toHaveBeenCalledWith(
        1, 'void mainImage() {}', 'BufferB',
      );
    });

    it('skips updateDebugLine when shader is locked and path does not match', () => {
      vi.mocked(mocks.shaderLocker.isLocked).mockReturnValue(true);
      vi.mocked(mocks.shaderLocker.getLockedShaderPath).mockReturnValue('/locked.glsl');
      vi.mocked(mocks.renderEngine.getCurrentConfig).mockReturnValue(null);

      pipeline.handleOverlayCursor(2, 'float x = 1.0;', 'BufferC');

      expect(mocks.shaderDebugManager.updateDebugLine).not.toHaveBeenCalled();
    });

    it('allows updateDebugLine when shader is locked and path matches locked path', () => {
      const fakeEvent = {
        data: { type: 'shader', code: '', path: '/locked.glsl', config: { passes: { Image: { inputs: [] } } }, buffers: {} },
      } as unknown as MessageEvent;
      (pipeline as any).lastEvent = fakeEvent;

      vi.mocked(mocks.shaderLocker.isLocked).mockReturnValue(true);
      vi.mocked(mocks.shaderLocker.getLockedShaderPath).mockReturnValue('/locked.glsl');

      pipeline.handleOverlayCursor(5, 'float x = 1.0;', 'Image');

      expect(mocks.shaderDebugManager.updateDebugLine).toHaveBeenCalledWith(
        5, 'float x = 1.0;', '/locked.glsl',
      );
    });

    it('triggers debugCompile when debug is active and shader code is present', () => {
      mocks.shaderDebugManager.getState = vi.fn(() => ({ ...mocks.debugState, isActive: true }));
      (pipeline as any).shaderProcessor = {
        getImageShaderCode: vi.fn(() => 'void mainImage() {}'),
        recompile: vi.fn(() => Promise.resolve({ success: true, errors: [], warnings: [] })),
        setShaderContext: vi.fn(),
      };
      const fakeEvent = {
        data: { type: 'shader', code: '', path: '/my.glsl', config: { passes: { Image: { inputs: [] } } }, buffers: {} },
      } as unknown as MessageEvent;
      (pipeline as any).lastEvent = fakeEvent;
      const debugCompileSpy = vi.fn();
      (pipeline as any).debugCompile = debugCompileSpy;

      pipeline.handleOverlayCursor(5, 'float x = 1.0;', 'Image');

      expect(debugCompileSpy).toHaveBeenCalled();
    });

    it('does not trigger debugCompile when debug is inactive', () => {
      mocks.shaderDebugManager.getState = vi.fn(() => ({ ...mocks.debugState, isActive: false }));
      (pipeline as any).shaderProcessor = {
        getImageShaderCode: vi.fn(() => 'void mainImage() {}'),
      };
      const debugCompileSpy = vi.fn();
      (pipeline as any).debugCompile = debugCompileSpy;

      pipeline.handleOverlayCursor(5, 'float x = 1.0;', 'Image');

      expect(debugCompileSpy).not.toHaveBeenCalled();
    });
  });
});

describe('ShaderPipeline — reset', () => {
  let pipeline: ShaderPipeline;
  let mocks: ReturnType<typeof makeMocks>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = makeMocks();
    (mocks.renderEngine as any).resetTime = vi.fn();
    pipeline = new ShaderPipeline(
      mocks.transport,
      mocks.renderEngine,
      mocks.shaderLocker,
      mocks.shaderDebugManager,
    );
  });

  it('does not arm the video resume hold when there is no shader to reset', async () => {
    // Regression: reset() used to call renderEngine.resetTime() unconditionally,
    // arming the WebGL engine's holdVideoResumeForResetCompile latch even when
    // there was no lastEvent to replay. With no onReset ever running to release
    // it, every later compile would pause all videos forever.
    await pipeline.reset();

    expect(mocks.renderEngine.resetTime).not.toHaveBeenCalled();
    expect(mocks.transport.postMessage).toHaveBeenCalledWith({
      type: 'error',
      payload: ['❌ No shader to reset'],
    });
  });

  it('calls resetTime and onReset when a shader is loaded', async () => {
    (pipeline as any).lastEvent = makeShaderEvent('void mainImage(out vec4 o, vec2 u) { o = vec4(1.0); }');
    const onReset = vi.fn();

    await pipeline.reset(onReset);

    expect(mocks.renderEngine.resetTime).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

function makeShaderEvent(code: string, path = '/shader.glsl'): MessageEvent {
  return {
    data: { type: 'shaderSource', code, config: null, path, buffers: {} },
  } as unknown as MessageEvent;
}

function makeConcurrentMocks() {
  let resolveCompile: (() => void) | null = null;

  const compileShaderPipeline = vi.fn(() =>
    new Promise<{ success: boolean }>((resolve) => {
      resolveCompile = () => resolve({ success: true });
    }),
  );

  const renderEngine = {
    getCurrentConfig: vi.fn(() => null),
    getPasses: vi.fn(() => []),
    cleanup: vi.fn(),
    compileShaderPipeline,
    startRenderLoop: vi.fn(),
  } as unknown as RenderingEngine;

  const transport: Transport = {
    postMessage: vi.fn(),
    onMessage: vi.fn(),
    dispose: vi.fn(),
    getType: () => 'vscode' as const,
    isConnected: () => true,
  };

  const shaderLocker = {
    isLocked: vi.fn(() => false),
    getLockedShaderPath: vi.fn(() => undefined),
  } as unknown as ShaderLocker;

  const shaderDebugManager = {
    updateDebugLine: vi.fn(),
    getState: vi.fn(() => ({
      isActive: false, isEnabled: false, currentLine: 0, lineContent: '',
      filePath: null, activeBufferName: 'Image', functionContext: null,
      isLineLocked: false, isInlineRenderingEnabled: true, normalizeMode: 'off' as const,
      isStepEnabled: false, stepEdge: 0.5, debugError: null, debugNotice: null,
      isVariableInspectorEnabled: false, isErrorsEnabled: false, capturedVariables: [],
    })),
    setShaderContext: vi.fn(),
    getDebugTarget: vi.fn((code: string, config: any) => ({ code, config: config ?? null, passName: 'Image' })),
    modifyShaderForDebugging: vi.fn(() => null),
    applyFullShaderPostProcessing: vi.fn(() => null),
    setStateCallback: vi.fn(),
    setRecompileCallback: vi.fn(),
    setCaptureStateCallback: vi.fn(),
    setImageShaderCode: vi.fn(),
    setDebugError: vi.fn(),
  } as unknown as ShaderDebugManager;

  return {
    transport,
    renderEngine,
    shaderLocker,
    shaderDebugManager,
    compileShaderPipeline,
    resolveCompile: () => resolveCompile?.(),
  };
}

describe('ShaderPipeline — concurrent shader messages', () => {
  let pipeline: ShaderPipeline;
  let mocks: ReturnType<typeof makeConcurrentMocks>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = makeConcurrentMocks();
    pipeline = new ShaderPipeline(
      mocks.transport,
      mocks.renderEngine,
      mocks.shaderLocker,
      mocks.shaderDebugManager,
    );
  });

  it('rejects a delayed request after locking at the global watermark', async () => {
    const compilationState = new ShaderCompilationState();
    expect(compilationState.acceptRequest({ requestId: 10 })).toBe(true);
    vi.mocked(mocks.shaderLocker.isLocked).mockReturnValue(true);
    vi.mocked(mocks.shaderLocker.getLockedShaderPath).mockReturnValue('/a.slang');
    pipeline = new ShaderPipeline(
      mocks.transport,
      mocks.renderEngine,
      mocks.shaderLocker,
      mocks.shaderDebugManager,
      compilationState,
    );
    const event = {
      data: {
        ...makeShaderEvent('delayed', '/a.slang').data,
        requestId: 9,
        language: 'slang',
      },
    } as MessageEvent;

    await expect(pipeline.handleShaderMessage(event)).resolves.toBeUndefined();

    expect(mocks.compileShaderPipeline).not.toHaveBeenCalled();
    expect(mocks.shaderDebugManager.setShaderContext).not.toHaveBeenCalled();
  });

  it('compiles the latest shader after a message arrives while a compile is in flight', async () => {
    const first = pipeline.handleShaderMessage(makeShaderEvent('void mainImage(out vec4 o, vec2 u) { o = vec4(1.0); }'));

    void pipeline.handleShaderMessage(makeShaderEvent('void mainImage(out vec4 o, vec2 u) { o = vec4(0.0); }'));

    mocks.resolveCompile();
    await first;

    mocks.resolveCompile();
    await vi.waitFor(() => {
      const codes = mocks.compileShaderPipeline.mock.calls.map((c: any[]) => c[0] as string);
      expect(codes.some((code) => code.includes('vec4(0.0)'))).toBe(true);
    });
  });

  it('resolves a queued shader message after its pending compile finishes', async () => {
    const first = pipeline.handleShaderMessage(makeShaderEvent('void mainImage(out vec4 o, vec2 u) { o = vec4(1.0); }'));

    const queued = pipeline.handleShaderMessage(makeShaderEvent('void mainImage(out vec4 o, vec2 u) { o = vec4(0.0); }'));
    let queuedResult: unknown = 'pending';
    void queued.then((result) => {
      queuedResult = result;
    });

    await Promise.resolve();
    expect(queuedResult).toBe('pending');

    mocks.resolveCompile();
    await first;

    await vi.waitFor(() => {
      expect(mocks.compileShaderPipeline).toHaveBeenCalledTimes(2);
    });
    expect(queuedResult).toBe('pending');

    mocks.resolveCompile();
    await expect(queued).resolves.toEqual({ success: true, warnings: undefined });
  });

  it('only keeps the latest pending message when multiple arrive while compiling', async () => {
    const first = pipeline.handleShaderMessage(makeShaderEvent('void mainImage(out vec4 o, vec2 u) { o = vec4(1.0); }'));

    void pipeline.handleShaderMessage(makeShaderEvent('void mainImage(out vec4 o, vec2 u) { o = vec4(0.5); }'));
    void pipeline.handleShaderMessage(makeShaderEvent('void mainImage(out vec4 o, vec2 u) { o = vec4(0.0); }'));

    mocks.resolveCompile();
    await first;
    mocks.resolveCompile();

    await vi.waitFor(() => {
      expect(mocks.compileShaderPipeline).toHaveBeenCalledTimes(2);
    });

    const codes = mocks.compileShaderPipeline.mock.calls.map((c: any[]) => c[0] as string);
    expect(codes.some((code) => code.includes('vec4(0.5)'))).toBe(false);
    expect(codes.some((code) => code.includes('vec4(0.0)'))).toBe(true);
  });

  it('queues all three roots from one compile generation in deterministic order', async () => {
    const event = (path: string, index: number) => ({
      data: {
        ...makeShaderEvent(`code ${path}`, path).data,
        compileGeneration: { id: 7, rootIndex: index, rootCount: 3, rootPath: path },
      },
    } as MessageEvent);
    const first = pipeline.handleShaderMessage(event('/a.slang', 0));
    const second = pipeline.handleShaderMessage(event('/b.slang', 1));
    const third = pipeline.handleShaderMessage(event('/c.slang', 2));

    mocks.resolveCompile();
    await first;
    await vi.waitFor(() => expect(mocks.compileShaderPipeline).toHaveBeenCalledTimes(2));
    mocks.resolveCompile();
    await second;
    await vi.waitFor(() => expect(mocks.compileShaderPipeline).toHaveBeenCalledTimes(3));
    mocks.resolveCompile();
    await third;

    expect(mocks.compileShaderPipeline.mock.calls.map((call: any[]) => call[2])).toEqual([
      '/a.slang',
      '/b.slang',
      '/c.slang',
    ]);
  });

  it('drains later roots after a duplicate of the currently compiling root', async () => {
    const event = (path: string, index: number) => ({
      data: {
        ...makeShaderEvent(`code ${path}`, path).data,
        compileGeneration: { id: 9, rootIndex: index, rootCount: 2, rootPath: path },
      },
    } as MessageEvent);
    const first = pipeline.handleShaderMessage(event('/a.slang', 0));
    const duplicate = pipeline.handleShaderMessage(event('/a.slang', 0));
    const second = pipeline.handleShaderMessage(event('/b.slang', 1));

    mocks.resolveCompile();
    await first;
    await expect(duplicate).resolves.toBeUndefined();
    await vi.waitFor(() => expect(mocks.compileShaderPipeline).toHaveBeenCalledTimes(2));
    mocks.resolveCompile();
    await second;

    expect(mocks.compileShaderPipeline.mock.calls.map((call: any[]) => call[2])).toEqual([
      '/a.slang',
      '/b.slang',
    ]);
    expect(mocks.transport.postMessage).toHaveBeenCalledTimes(1);
  });

  it('supersedes queued roots and partial results from an older generation', async () => {
    const event = (id: number, path: string, index: number) => ({
      data: {
        ...makeShaderEvent(`generation ${id} ${path}`, path).data,
        compileGeneration: { id, rootIndex: index, rootCount: 2, rootPath: path },
      },
    } as MessageEvent);
    const oldFirst = pipeline.handleShaderMessage(event(10, '/a.slang', 0));
    const oldQueued = pipeline.handleShaderMessage(event(10, '/b.slang', 1));
    const currentFirst = pipeline.handleShaderMessage(event(11, '/a.slang', 0));
    const currentSecond = pipeline.handleShaderMessage(event(11, '/b.slang', 1));

    await expect(oldQueued).resolves.toBeUndefined();
    mocks.resolveCompile();
    await oldFirst;
    await vi.waitFor(() => expect(mocks.compileShaderPipeline).toHaveBeenCalledTimes(2));
    mocks.resolveCompile();
    await currentFirst;
    await vi.waitFor(() => expect(mocks.compileShaderPipeline).toHaveBeenCalledTimes(3));
    mocks.resolveCompile();
    await currentSecond;

    expect(mocks.compileShaderPipeline.mock.calls.map((call: any[]) => call[2])).toEqual([
      '/a.slang',
      '/a.slang',
      '/b.slang',
    ]);
    expect(mocks.transport.postMessage).toHaveBeenCalledTimes(1);
  });

  it('aggregates root diagnostics and reports only after the generation completes', async () => {
    const diagnostic = {
      uri: 'file:///project/helper.slang',
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      severity: 'error' as const,
      message: 'bad helper',
      source: 'slang-compile' as const,
    };
    mocks.compileShaderPipeline
      .mockResolvedValueOnce({ success: false, errors: ['A failed'], diagnostics: [diagnostic] } as any)
      .mockResolvedValueOnce({ success: true } as any)
      .mockResolvedValueOnce({ success: false, errors: ['C failed'] } as any);
    const event = (path: string, index: number) => ({
      data: {
        ...makeShaderEvent(`code ${path}`, path).data,
        compileGeneration: { id: 8, rootIndex: index, rootCount: 3, rootPath: path },
      },
    } as MessageEvent);

    await pipeline.handleShaderMessage(event('/a.slang', 0));
    expect(mocks.transport.postMessage).not.toHaveBeenCalled();
    await pipeline.handleShaderMessage(event('/b.slang', 1));
    expect(mocks.transport.postMessage).not.toHaveBeenCalled();
    await pipeline.handleShaderMessage(event('/c.slang', 2));

    expect(mocks.transport.postMessage).toHaveBeenCalledWith({
      type: 'error',
      payload: ['A failed', 'C failed'],
      diagnostics: [diagnostic],
    });
  });

  it('does not report success for a generation root skipped by a locked panel', async () => {
    vi.mocked(mocks.shaderLocker.isLocked).mockReturnValue(true);
    vi.mocked(mocks.shaderLocker.getLockedShaderPath).mockReturnValue('/a.slang');
    const skipped = {
      data: {
        ...makeShaderEvent('code b', '/b.slang').data,
        compileGeneration: { id: 20, rootIndex: 0, rootCount: 1, rootPath: '/b.slang' },
        compileScope: { rootUris: ['file:///b.slang'], generationId: 20 },
      },
    } as MessageEvent;

    await pipeline.handleShaderMessage(skipped);

    expect(mocks.compileShaderPipeline).not.toHaveBeenCalled();
    expect(mocks.transport.postMessage).not.toHaveBeenCalled();
  });

  it('does not let an irrelevant newer root make the locked root stale', async () => {
    const compilationState = new ShaderCompilationState();
    vi.mocked(mocks.shaderLocker.isLocked).mockReturnValue(true);
    vi.mocked(mocks.shaderLocker.getLockedShaderPath).mockReturnValue('/a.slang');
    mocks.compileShaderPipeline.mockResolvedValue({ success: true });
    pipeline = new ShaderPipeline(
      mocks.transport,
      mocks.renderEngine,
      mocks.shaderLocker,
      mocks.shaderDebugManager,
      compilationState,
    );
    const event = (id: number, path: string) => ({
      data: {
        ...makeShaderEvent(`code ${path}`, path).data,
        requestId: id,
        compileGeneration: { id, rootIndex: 0, rootCount: 1, rootPath: path },
        compileScope: { rootUris: [`file://${path}`], generationId: id },
      },
    } as MessageEvent);

    const slowA = pipeline.handleShaderMessage(event(10, '/a.slang'));
    await pipeline.handleShaderMessage(event(11, '/b.slang'));
    mocks.resolveCompile();
    await expect(slowA).resolves.toEqual({ success: true, warnings: undefined });
    await expect(pipeline.handleShaderMessage(event(9, '/a.slang'))).resolves.toBeUndefined();

    expect(mocks.compileShaderPipeline).toHaveBeenCalledTimes(1);
    expect((mocks.compileShaderPipeline.mock.calls[0] as any[])[2]).toBe('/a.slang');
    expect(mocks.transport.postMessage).toHaveBeenCalledWith({
      type: 'log',
      payload: ['Shader compiled and linked'],
      compileScope: { rootUris: ['file:///a.slang'], generationId: 10 },
    });
  });

  it('reports only the compiled locked root when sibling generation roots are skipped', async () => {
    vi.mocked(mocks.shaderLocker.isLocked).mockReturnValue(true);
    vi.mocked(mocks.shaderLocker.getLockedShaderPath).mockReturnValue('/a.slang');
    mocks.compileShaderPipeline.mockResolvedValue({ success: true });
    const event = (path: string, index: number) => ({
      data: {
        ...makeShaderEvent(`code ${path}`, path).data,
        compileGeneration: { id: 21, rootIndex: index, rootCount: 2, rootPath: path },
        compileScope: { rootUris: [`file://${path}`], generationId: 21 },
      },
    } as MessageEvent);

    await pipeline.handleShaderMessage(event('/a.slang', 0));
    await pipeline.handleShaderMessage(event('/b.slang', 1));

    expect(mocks.transport.postMessage).toHaveBeenCalledTimes(1);
    expect(mocks.transport.postMessage).toHaveBeenCalledWith({
      type: 'log',
      payload: ['Shader compiled and linked'],
      compileScope: { rootUris: ['file:///a.slang'], generationId: 21 },
    });
  });

  it('updates compilation result state when a pending shader message finishes compiling', async () => {
    const compilationState = {
      latest: null as { success: boolean; errors?: string[] } | null,
      setResult(result: { success: boolean; errors?: string[] }) {
        this.latest = result;
      },
    };
    const resolveCompileQueue: Array<() => void> = [];
    pipeline = new ShaderPipeline(
      mocks.transport,
      mocks.renderEngine,
      mocks.shaderLocker,
      mocks.shaderDebugManager,
      compilationState,
    );

    mocks.compileShaderPipeline.mockImplementation(((code: string) =>
      new Promise<{ success: boolean; errors?: string[] }>((resolve) => {
        resolveCompileQueue.push(() => resolve(
          code.includes('BROKEN')
            ? { success: false, errors: ['Pending compile error'] }
            : { success: true },
        ));
      })) as any);

    const first = pipeline.handleShaderMessage(makeShaderEvent('void mainImage(out vec4 o, vec2 u) { o = vec4(1.0); }'));
    void pipeline.handleShaderMessage(makeShaderEvent('void mainImage(out vec4 o, vec2 u) { BROKEN }'));

    resolveCompileQueue.shift()?.();
    await first;

    await vi.waitFor(() => {
      expect(mocks.compileShaderPipeline).toHaveBeenCalledTimes(2);
    });

    resolveCompileQueue.shift()?.();
    await vi.waitFor(() => {
      expect(compilationState.latest).toEqual({
        success: false,
        errors: ['Pending compile error'],
      });
    });
  });

  it('does not report a superseded shader compile as a visible error', async () => {
    const compilationState = {
      latest: null as { success: boolean; errors?: string[] } | null,
      setResult(result: { success: boolean; errors?: string[] }) {
        this.latest = result;
      },
    };
    pipeline = new ShaderPipeline(
      mocks.transport,
      mocks.renderEngine,
      mocks.shaderLocker,
      mocks.shaderDebugManager,
      compilationState,
    );
    mocks.compileShaderPipeline.mockResolvedValueOnce({
      success: false,
      errors: ['Superseded by a newer compile'],
      superseded: true,
    } as any);

    const result = await pipeline.handleShaderMessage(
      makeShaderEvent('void mainImage(out vec4 o, vec2 u) { o = vec4(1.0); }'),
    );

    expect(result).toBeUndefined();
    expect(compilationState.latest).toBeNull();
    expect(mocks.transport.postMessage).not.toHaveBeenCalled();
  });

  it('posts structured compile diagnostics with the legacy error payload', async () => {
    const diagnostic = {
      uri: 'file:///project/helper.slang',
      range: { start: { line: 1, character: 2 }, end: { line: 1, character: 4 } },
      severity: 'error' as const,
      message: 'bad helper',
      source: 'slang-compile' as const,
    };
    mocks.compileShaderPipeline.mockResolvedValueOnce({
      success: false,
      errors: ['legacy error'],
      diagnostics: [diagnostic],
    } as any);

    await pipeline.handleShaderMessage(makeShaderEvent('float4 mainImage(float2 uv) { return helper(); }', '/project/image.slang'));

    expect(mocks.transport.postMessage).toHaveBeenCalledWith({
      type: 'error',
      payload: ['legacy error'],
      diagnostics: [diagnostic],
    });
  });

  it('posts successful structured diagnostics with the success log', async () => {
    const diagnostic = {
      uri: 'file:///project/helper.slang',
      range: { start: { line: 1, character: 2 }, end: { line: 1, character: 4 } },
      severity: 'warning' as const,
      message: 'implicit conversion',
      source: 'slang-compile' as const,
    };
    mocks.compileShaderPipeline.mockResolvedValueOnce({
      success: true,
      diagnostics: [diagnostic],
    } as any);

    await pipeline.handleShaderMessage(makeShaderEvent('float4 mainImage(float2 uv) { return 1; }', '/project/image.slang'));

    expect(mocks.transport.postMessage).toHaveBeenCalledWith({
      type: 'log',
      payload: ['Shader compiled and linked'],
      diagnostics: [diagnostic],
    });
  });
});
