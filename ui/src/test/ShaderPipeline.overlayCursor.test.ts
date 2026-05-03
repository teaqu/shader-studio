import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShaderPipeline } from '../lib/ShaderPipeline';
import type { ShaderLocker } from '../lib/ShaderLocker';
import type { ShaderDebugManager } from '../lib/ShaderDebugManager';
import type { Transport } from '../lib/transport/MessageTransport';
import type { RenderingEngine } from '../../../rendering/src/types/RenderingEngine';
import type { CursorPositionMessage } from '@shader-studio/types';

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
