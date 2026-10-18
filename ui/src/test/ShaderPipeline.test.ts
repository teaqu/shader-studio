import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShaderPipeline } from '../lib/ShaderPipeline';
import type { ShaderLocker } from '../lib/ShaderLocker';
import { ShaderDebugManager } from '../lib/ShaderDebugManager';
import type { Transport } from '../lib/transport/MessageTransport';
import type { RenderingEngine } from '../../../rendering/src/types/RenderingEngine';
import type { CursorPositionMessage, ShaderSourceMessage } from '@shader-studio/types';

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
    stopRenderLoop: vi.fn(),
    startRenderLoop: vi.fn(),
    updateBufferAndRecompile: vi.fn(),
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

  describe('locked shader-source admission', () => {
    it('explicitly previews a linked file standalone without looking for an owner', () => {
      (pipeline as unknown as { lastEvent: MessageEvent }).lastEvent = new MessageEvent('message', { data: {
        type: 'shaderSource', path: '/main.glsl', bufferPathMap: { BufferA: '/linked.glsl' },
      } });
      pipeline.previewFileStandalone('/linked.glsl');
      expect(mocks.transport.postMessage).toHaveBeenCalledWith({ type: 'refresh', payload: { path: '/linked.glsl' } });
      expect(pipeline.getShaderMessageTarget({ path: '/linked.glsl' })).toEqual({ kind: 'main' });
      expect(mocks.shaderLocker.isLocked()).toBe(false);
    });
    it.each(['BufferA', 'common'])('recognizes the current shader’s %s while unlocked, without guessing unrelated owners', passName => {
      (pipeline as unknown as { lastEvent: MessageEvent }).lastEvent = new MessageEvent('message', { data: {
        type: 'shaderSource', path: '/main.glsl', code: 'main',
        bufferPathMap: { Image: '/main.glsl', [passName]: '/linked.glsl' },
      } });
      expect(pipeline.getShaderMessageTarget({ path: '/linked.glsl' })).toEqual({ kind: 'buffer', passName });
      expect(pipeline.getShaderMessageTarget({ path: '/other/linked.glsl' })).toEqual({ kind: 'main' });
      expect(pipeline.getShaderMessageTarget({ path: '/main.glsl' })).toEqual({ kind: 'main' });
      expect(mocks.shaderLocker.isLocked()).toBe(false);
    });

    it.each([
      ['GLSL', '/project/locked.glsl', '/project/other.glsl'],
      ['Slang', '/project/locked.slang', '/project/other.slang'],
    ])('admits only the locked %s main shader', (_name, lockedPath, otherPath) => {
      vi.mocked(mocks.shaderLocker.isLocked).mockReturnValue(true);
      vi.mocked(mocks.shaderLocker.getLockedShaderPath).mockReturnValue(lockedPath);

      expect(pipeline.canHandleShaderMessage({ path: lockedPath })).toBe(true);
      expect(pipeline.canHandleShaderMessage({ path: otherPath })).toBe(false);
    });

    it.each(['glsl', 'slang'])(
      'admits an exact configured .%s buffer without promoting it to main',
      (extension) => {
        const lockedPath = `/project/main.${extension}`;
        const bufferPath = `/project/passes/buffer-a.${extension}`;
        vi.mocked(mocks.shaderLocker.isLocked).mockReturnValue(true);
        vi.mocked(mocks.shaderLocker.getLockedShaderPath).mockReturnValue(lockedPath);
        (pipeline as unknown as { lastEvent: MessageEvent<ShaderSourceMessage> }).lastEvent = {
          data: {
            type: 'shaderSource',
            code: 'main',
            path: lockedPath,
            bufferPathMap: { Image: lockedPath, BufferA: bufferPath },
          },
        } as unknown as MessageEvent<ShaderSourceMessage>;

        expect(pipeline.canHandleShaderMessage({ path: bufferPath })).toBe(true);
        expect(pipeline.canHandleShaderMessage({
          path: `/unrelated/buffer-a.${extension}`,
        })).toBe(false);
      },
    );

    it('classifies a configured vertex source separately from a fragment buffer', () => {
      const lockedPath = '/project/main.glsl';
      const vertexPath = '/project/main.vert.glsl';
      vi.mocked(mocks.shaderLocker.isLocked).mockReturnValue(true);
      vi.mocked(mocks.shaderLocker.getLockedShaderPath).mockReturnValue(lockedPath);
      (pipeline as unknown as { lastEvent: MessageEvent<ShaderSourceMessage> }).lastEvent = {
        data: {
          type: 'shaderSource', code: 'main', path: lockedPath,
          bufferPathMap: { Image: lockedPath, '__shader_studio_vertex__:Image': vertexPath },
        },
      } as unknown as MessageEvent<ShaderSourceMessage>;

      expect(pipeline.getShaderMessageTarget({ path: vertexPath })).toEqual({ kind: 'vertex', passName: 'Image' });
    });

    it('rejects messages when the lock has no shader path', () => {
      vi.mocked(mocks.shaderLocker.isLocked).mockReturnValue(true);
      vi.mocked(mocks.shaderLocker.getLockedShaderPath).mockReturnValue(undefined);

      expect(pipeline.canHandleShaderMessage({ path: '/project/shader.slang' })).toBe(false);
    });

    it('normalizes path separators without accepting a same-basename file', () => {
      vi.mocked(mocks.shaderLocker.isLocked).mockReturnValue(true);
      vi.mocked(mocks.shaderLocker.getLockedShaderPath).mockReturnValue('C:\\project\\main.slang');
      (pipeline as unknown as { lastEvent: MessageEvent<ShaderSourceMessage> }).lastEvent = {
        data: {
          type: 'shaderSource',
          code: 'main',
          path: 'C:\\project\\main.slang',
          bufferPathMap: {
            Image: 'C:\\project\\main.slang',
            BufferA: 'C:\\project\\passes\\buffer-a.slang',
          },
        },
      } as unknown as MessageEvent<ShaderSourceMessage>;

      expect(pipeline.canHandleShaderMessage({
        path: 'C:/project/passes/buffer-a.slang',
      })).toBe(true);
      expect(pipeline.canHandleShaderMessage({
        path: 'C:/unrelated/buffer-a.slang',
      })).toBe(false);
    });

    it.each(['glsl', 'slang'])(
      'processes the locked .%s main shader when only its path separators differ',
      async (extension) => {
        const processMainShaderCompilation = vi.fn().mockResolvedValue({
          success: true,
          errors: [],
          warnings: [],
        });
        (pipeline as unknown as {
          shaderProcessor: {
            isCurrentlyProcessing(): boolean;
            processMainShaderCompilation: typeof processMainShaderCompilation;
          };
        }).shaderProcessor = {
          isCurrentlyProcessing: () => false,
          processMainShaderCompilation,
        };
        vi.mocked(mocks.shaderLocker.isLocked).mockReturnValue(true);
        vi.mocked(mocks.shaderLocker.getLockedShaderPath).mockReturnValue(
          `C:\\project\\main.${extension}`,
        );

        await pipeline.handleShaderMessage({
          data: {
            type: 'shaderSource',
            code: 'main source',
            path: `C:/project/main.${extension}`,
            config: null,
            buffers: {},
          },
        } as MessageEvent<ShaderSourceMessage>);

        expect(processMainShaderCompilation).toHaveBeenCalledOnce();
      },
    );

    it.each(['glsl', 'slang'])(
      'updates an exact configured .%s buffer while preserving the locked main shader',
      async (extension) => {
        const lockedPath = `/project/main.${extension}`;
        const bufferPath = `/project/passes/buffer-a.${extension}`;
        const mainEvent = {
          data: {
            type: 'shaderSource',
            code: 'main code',
            path: lockedPath,
            config: {
              passes: {
                Image: {},
                BufferA: { path: bufferPath, inputs: {} },
              },
            },
            buffers: { BufferA: 'old buffer code' },
            bufferPathMap: { Image: lockedPath, BufferA: bufferPath },
          },
        } as unknown as MessageEvent<ShaderSourceMessage>;
        (pipeline as unknown as { lastEvent: MessageEvent<ShaderSourceMessage> }).lastEvent = mainEvent;
        vi.mocked(mocks.shaderLocker.isLocked).mockReturnValue(true);
        vi.mocked(mocks.shaderLocker.getLockedShaderPath).mockReturnValue(lockedPath);
        vi.mocked(mocks.renderEngine.getCurrentConfig).mockReturnValue(mainEvent.data.config as never);
        vi.mocked(mocks.renderEngine.updateBufferAndRecompile).mockResolvedValue({
          success: true,
        } as never);

        await pipeline.handleShaderMessage({
          data: {
            type: 'shaderSource',
            code: 'updated buffer code',
            path: bufferPath,
            buffers: {},
          },
        } as MessageEvent<ShaderSourceMessage>);

        await vi.waitFor(() => {
          expect(mocks.renderEngine.updateBufferAndRecompile).toHaveBeenCalledWith(
            'BufferA',
            'updated buffer code',
          );
        });
        expect(pipeline.getLastEvent()?.data).toEqual(expect.objectContaining({
          path: lockedPath,
          code: 'main code',
          buffers: { BufferA: 'updated buffer code' },
        }));
        expect(mocks.shaderDebugManager.setShaderContext).toHaveBeenCalledWith(
          mainEvent.data.config,
          lockedPath,
          { BufferA: 'updated buffer code' },
          [],
          mainEvent.data.bufferPathMap,
          [],
        );
      },
    );

    it('updates the exact configured pass when buffer basenames collide', async () => {
      const lockedPath = '/project/main.slang';
      const commonPath = '/project/shared/shared.slang';
      const bufferPath = '/project/passes/shared.slang';
      const config = {
        passes: {
          Image: {},
          common: { path: commonPath, inputs: {} },
          BufferA: { path: bufferPath, inputs: {} },
        },
      };
      (pipeline as unknown as { lastEvent: MessageEvent<ShaderSourceMessage> }).lastEvent = {
        data: {
          type: 'shaderSource',
          code: 'main code',
          path: lockedPath,
          config,
          buffers: {
            common: 'common code',
            BufferA: 'old buffer code',
          },
          bufferPathMap: {
            Image: lockedPath,
            common: commonPath,
            BufferA: bufferPath,
          },
        },
      } as unknown as MessageEvent<ShaderSourceMessage>;
      vi.mocked(mocks.shaderLocker.isLocked).mockReturnValue(true);
      vi.mocked(mocks.shaderLocker.getLockedShaderPath).mockReturnValue(lockedPath);
      vi.mocked(mocks.renderEngine.getCurrentConfig).mockReturnValue(config as never);
      const compile = Promise.withResolvers<{ success: boolean }>();
      vi.mocked(mocks.renderEngine.updateBufferAndRecompile).mockReturnValue(compile.promise);

      let finished = false;
      const updating = pipeline.handleShaderMessage({
        data: {
          type: 'shaderSource',
          code: 'updated buffer code',
          path: bufferPath,
          buffers: {},
        },
      } as MessageEvent<ShaderSourceMessage>).then(() => {
        finished = true;
      });
      await Promise.resolve();
      expect(finished).toBe(false);
      compile.resolve({ success: true });
      await updating;

      await vi.waitFor(() => {
        expect(mocks.renderEngine.updateBufferAndRecompile).toHaveBeenCalledWith(
          'BufferA',
          'updated buffer code',
        );
      });
      expect(mocks.transport.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
        type: 'refresh',
      }));
    });

    it('refreshes the exact common pass when buffer basenames collide', async () => {
      const lockedPath = '/project/main.slang';
      const bufferPath = '/project/passes/shared.slang';
      const commonPath = '/project/shared/shared.slang';
      const config = {
        passes: {
          Image: {},
          BufferA: { path: bufferPath, inputs: {} },
          common: { path: commonPath, inputs: {} },
        },
      };
      (pipeline as unknown as { lastEvent: MessageEvent<ShaderSourceMessage> }).lastEvent = {
        data: {
          type: 'shaderSource',
          code: 'main code',
          path: lockedPath,
          config,
          buffers: {
            BufferA: 'buffer code',
            common: 'old common code',
          },
          bufferPathMap: {
            Image: lockedPath,
            BufferA: bufferPath,
            common: commonPath,
          },
        },
      } as unknown as MessageEvent<ShaderSourceMessage>;
      vi.mocked(mocks.shaderLocker.isLocked).mockReturnValue(true);
      vi.mocked(mocks.shaderLocker.getLockedShaderPath).mockReturnValue(lockedPath);
      vi.mocked(mocks.renderEngine.getCurrentConfig).mockReturnValue(config as never);

      const result = await pipeline.handleShaderMessage({
        data: {
          type: 'shaderSource',
          code: 'updated common code',
          path: commonPath,
          buffers: {},
        },
      } as MessageEvent<ShaderSourceMessage>);

      expect(result).toEqual({ success: true });
      expect(mocks.renderEngine.updateBufferAndRecompile).not.toHaveBeenCalled();
      expect(mocks.transport.postMessage).toHaveBeenCalledWith({
        type: 'refresh',
        payload: { path: lockedPath, refreshRequestId: expect.any(Number) },
      });
    });

    it.each([
      ['GLSL', '/project/locked.glsl', '/project/unrelated.glsl'],
      ['Slang', '/project/locked.slang', '/project/unrelated.slang'],
    ])(
      'rejects unrelated %s without renderer or shader-context side effects',
      async (_label, lockedPath, unrelatedPath) => {
        vi.mocked(mocks.shaderLocker.isLocked).mockReturnValue(true);
        vi.mocked(mocks.shaderLocker.getLockedShaderPath).mockReturnValue(lockedPath);

        await pipeline.handleShaderMessage({
          data: {
            type: 'shaderSource',
            code: 'unrelated code',
            path: unrelatedPath,
            buffers: {},
          },
        } as MessageEvent<ShaderSourceMessage>);

        expect(mocks.renderEngine.stopRenderLoop).not.toHaveBeenCalled();
        expect(mocks.renderEngine.updateBufferAndRecompile).not.toHaveBeenCalled();
        expect(mocks.shaderDebugManager.setShaderContext).not.toHaveBeenCalled();
      },
    );
  });

  describe('handleCursorPositionMessage', () => {
    it('calls updateDebugLine when overlay is hidden', () => {
      vi.mocked(getEditorOverlayVisible).mockReturnValue(false);

      pipeline.handleCursorPositionMessage(cursorMsg());

      expect(mocks.shaderDebugManager.updateDebugLine).toHaveBeenCalledWith(
        5, 'float x = 1.0;', '/shader.glsl',
      );
    });

    it('accepts a configured Buffer cursor while the editor overlay is visible', () => {
      vi.mocked(getEditorOverlayVisible).mockReturnValue(true);
      const config = {
        passes: {
          Image: { inputs: [] },
          BufferA: { path: '/project/bufferA.glsl', inputs: [] },
        },
      };
      (pipeline as any).lastEvent = {
        data: {
          type: 'shaderSource',
          path: '/project/current.glsl',
          config,
          buffers: { BufferA: 'void mainImage() {}' },
        },
      } as MessageEvent;

      pipeline.handleCursorPositionMessage(cursorMsg('/project/bufferA.glsl'));

      expect(mocks.shaderDebugManager.updateDebugLine).toHaveBeenCalledWith(
        5, 'float x = 1.0;', '/project/bufferA.glsl',
      );
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

    it('accepts cursor updates from an imported Slang module', () => {
      vi.mocked(getEditorOverlayVisible).mockReturnValue(false);
      (pipeline as any).lastEvent = {
        data: {
          type: 'shaderSource',
          path: '/project/image.slang',
          config: { passes: { Image: {} } },
          buffers: {},
          slangModules: [{
            moduleName: 'palette',
            path: '/project/palette.slang',
            source: 'module palette;',
            ownerPass: 'Image',
          }],
        },
      } as MessageEvent;

      pipeline.handleCursorPositionMessage(cursorMsg('/project/palette.slang'));

      expect(mocks.shaderDebugManager.updateDebugLine).toHaveBeenCalledWith(
        5, 'float x = 1.0;', '/project/palette.slang',
      );
    });

    it('accepts a locked configured-pass cursor from the current shader message while the renderer is rebuilding', () => {
      vi.mocked(getEditorOverlayVisible).mockReturnValue(false);
      vi.mocked(mocks.shaderLocker.isLocked).mockReturnValue(true);
      vi.mocked(mocks.shaderLocker.getLockedShaderPath).mockReturnValue('/project/image.slang');
      vi.mocked(mocks.renderEngine.getCurrentConfig).mockReturnValue(null);
      (pipeline as any).lastEvent = {
        data: {
          type: 'shaderSource',
          path: '/project/image.slang',
          config: {
            passes: {
              Image: {},
              ComputePattern: { type: 'compute', path: './passes/pattern.compute.slang' },
            },
          },
          buffers: { ComputePattern: 'void buildPattern() {}' },
        },
      } as MessageEvent;

      pipeline.handleCursorPositionMessage(cursorMsg('/project/passes/pattern.compute.slang'));

      expect(mocks.shaderDebugManager.updateDebugLine).toHaveBeenCalledWith(
        5, 'float x = 1.0;', '/project/passes/pattern.compute.slang',
      );
    });
  });

  describe('embedded cursor ordering', () => {
    it('applies a queued shader cursor when the message arrives, not after compilation', () => {
      (pipeline as unknown as {
        shaderProcessor: { isCurrentlyProcessing(): boolean };
      }).shaderProcessor = {
        isCurrentlyProcessing: () => true,
      };
      const message = {
        type: 'shaderSource',
        code: 'void mainImage() {}',
        config: null,
        path: '/project/image.slang',
        buffers: {},
        cursorPosition: {
          line: 0,
          character: 0,
          lineContent: 'void mainImage() {}',
          filePath: '/project/image.slang',
        },
      } satisfies ShaderSourceMessage;

      void pipeline.handleShaderMessage({ data: message } as MessageEvent<ShaderSourceMessage>);

      expect(mocks.shaderDebugManager.updateDebugLine).toHaveBeenCalledWith(
        0,
        'void mainImage() {}',
        '/project/image.slang',
        false,
      );
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

    it('does not recompile for a duplicate cursor position', () => {
      mocks.shaderDebugManager.updateDebugLine = vi.fn(() => false as never);
      mocks.shaderDebugManager.getState = vi.fn(() => ({ ...mocks.debugState, isActive: true }));
      (pipeline as any).shaderProcessor = {
        getImageShaderCode: vi.fn(() => 'void mainImage() {}'),
      };
      (pipeline as any).lastEvent = {
        data: { type: 'shader', code: '', path: '/my.glsl', config: { passes: { Image: {} } }, buffers: {} },
      } as MessageEvent;
      const debugCompileSpy = vi.fn();
      (pipeline as any).debugCompile = debugCompileSpy;

      pipeline.handleOverlayCursor(5, 'float x = 1.0;', 'Image');

      expect(debugCompileSpy).not.toHaveBeenCalled();
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

describe('ShaderPipeline — standalone function debugging', () => {
  it('does not synthesize a GLSL debug entry point for a Slang helper without mainImage', async () => {
    const code = [
      'public float debugWave(float2 uv)',
      '{',
      '    float phase = uv.x * 6.2831853;',
      '    return sin(phase);',
      '}',
    ].join('\n');
    const compiledSources: string[] = [];
    const renderEngine = {
      compileShaderPipeline: vi.fn(async (source: string) => {
        compiledSources.push(source);
        return source.includes('mainImage')
          ? { success: true }
          : { success: false, errors: ['Image: Missing mainImage function'] };
      }),
      flagReloadOnNextApply: vi.fn(),
      startRenderLoop: vi.fn(),
      getCurrentConfig: vi.fn(() => null),
      getPasses: vi.fn(() => []),
      stopRenderLoop: vi.fn(),
      updateBufferAndRecompile: vi.fn(),
      cleanup: vi.fn(),
    } as unknown as RenderingEngine;
    const transport = {
      postMessage: vi.fn(),
      onMessage: vi.fn(),
      dispose: vi.fn(),
      getType: () => 'vscode' as const,
      isConnected: () => true,
    } as Transport;
    const shaderLocker = {
      isLocked: () => false,
      getLockedShaderPath: () => undefined,
    } as unknown as ShaderLocker;
    const shaderDebugManager = new ShaderDebugManager();
    shaderDebugManager.setLanguage('slang');
    shaderDebugManager.toggleEnabled();
    const pipeline = new ShaderPipeline(
      transport,
      renderEngine,
      shaderLocker,
      shaderDebugManager,
    );

    const result = await pipeline.handleShaderMessage({
      data: {
        type: 'shaderSource',
        code,
        config: null,
        path: '/debugmath.slang',
        buffers: {},
        language: 'slang',
        reload: true,
        cursorPosition: {
          line: 1,
          character: 0,
          lineContent: '{',
          filePath: '/debugmath.slang',
        },
      },
    } as MessageEvent<ShaderSourceMessage>);

    expect(result).toMatchObject({ success: false, errors: ['Image: Missing mainImage function'] });
    expect(compiledSources).toHaveLength(1);
    expect(compiledSources[0]).toBe(code);
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
});

describe('ShaderPipeline — owner refresh responses', () => {
  let pipeline: ShaderPipeline;
  let mocks: ReturnType<typeof makeConcurrentMocks>;

  const ownerPath = '/project/owner.wgsl';
  const commonPath = '/project/common.wgsl';
  const vertexPath = '/project/owner.vert.wgsl';
  const otherPath = '/project/other.wgsl';
  const ownerCode = 'fn mainImage(coord: vec2f) -> vec4f { return vec4f(1.0); }';
  const otherCode = 'fn mainImage(coord: vec2f) -> vec4f { return vec4f(0.0); }';
  const vertexCode = 'fn mainVertex(vertexIndex: u32, position: ptr<function, vec3<f32>>) {}';

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = makeConcurrentMocks();
    mocks.compileShaderPipeline.mockResolvedValue({ success: true });
    pipeline = new ShaderPipeline(
      mocks.transport,
      mocks.renderEngine,
      mocks.shaderLocker,
      mocks.shaderDebugManager,
    );
  });

  function sourceEvent(path: string, code: string, extra: Partial<ShaderSourceMessage> = {}): MessageEvent {
    return {
      data: {
        type: 'shaderSource', code, config: null, path, buffers: {},
        bufferPathMap: path === ownerPath
          ? { Image: ownerPath, common: commonPath, '__shader_studio_vertex__:Image': vertexPath }
          : { Image: path },
        ...extra,
      },
    } as unknown as MessageEvent;
  }

  function lastRefreshRequestId(): number {
    const refresh = vi.mocked(mocks.transport.postMessage).mock.calls
      .map(([message]) => message as { type: string; payload?: { refreshRequestId?: number } })
      .filter(message => message.type === 'refresh')
      .at(-1);
    expect(refresh?.payload?.refreshRequestId).toEqual(expect.any(Number));
    return refresh!.payload!.refreshRequestId!;
  }

  async function requestOwnerRefreshFrom(source: 'common' | 'vertex'): Promise<number> {
    await pipeline.handleShaderMessage(sourceEvent(ownerPath, ownerCode));
    await pipeline.handleShaderMessage(source === 'common'
      ? sourceEvent(commonPath, 'fn shared() {}', { bufferPathMap: undefined })
      : sourceEvent(vertexPath, vertexCode, { bufferPathMap: undefined }));
    expect(mocks.transport.postMessage).toHaveBeenCalledWith({
      type: 'refresh',
      payload: { path: ownerPath, refreshRequestId: expect.any(Number) },
    });
    return lastRefreshRequestId();
  }

  it.each(['common', 'vertex'] as const)(
    'ignores a %s owner refresh answered after a newer shader was opened',
    async (source) => {
      const refreshRequestId = await requestOwnerRefreshFrom(source);
      await pipeline.handleShaderMessage(sourceEvent(otherPath, otherCode));
      const compiles = mocks.compileShaderPipeline.mock.calls.length;

      const result = await pipeline.handleShaderMessage(
        sourceEvent(ownerPath, ownerCode, { refreshRequestId }),
      );

      expect(result).toBeUndefined();
      expect(mocks.compileShaderPipeline).toHaveBeenCalledTimes(compiles);
      expect(pipeline.getLastEvent()?.data.path).toBe(otherPath);
    },
  );

  it('ignores a superseded owner refresh even while the newer shader is still compiling', async () => {
    const refreshRequestId = await requestOwnerRefreshFrom('common');
    const compiles = mocks.compileShaderPipeline.mock.calls.length;
    let finishOther!: () => void;
    mocks.compileShaderPipeline.mockImplementationOnce(() => new Promise((resolve) => {
      finishOther = () => resolve({ success: true });
    }));
    const other = pipeline.handleShaderMessage(sourceEvent(otherPath, otherCode));

    const response = pipeline.handleShaderMessage(sourceEvent(ownerPath, ownerCode, { refreshRequestId }));
    finishOther();
    await other;

    await expect(response).resolves.toBeUndefined();
    await Promise.resolve();
    expect(pipeline.getLastEvent()?.data.path).toBe(otherPath);
    // Only the newer shader compiled; the owner's answer never did.
    expect(mocks.compileShaderPipeline).toHaveBeenCalledTimes(compiles + 1);
  });

  it('applies an owner refresh answered before any newer shader arrived', async () => {
    const refreshRequestId = await requestOwnerRefreshFrom('common');
    const compiles = mocks.compileShaderPipeline.mock.calls.length;

    const result = await pipeline.handleShaderMessage(sourceEvent(ownerPath, ownerCode, { refreshRequestId }));

    expect(result).toEqual(expect.objectContaining({ success: true }));
    expect(mocks.compileShaderPipeline).toHaveBeenCalledTimes(compiles + 1);
    expect(pipeline.getLastEvent()?.data.path).toBe(ownerPath);
  });

  it('applies an owner refresh when the newer shader was the owner itself', async () => {
    const refreshRequestId = await requestOwnerRefreshFrom('common');
    await pipeline.handleShaderMessage(sourceEvent(ownerPath, ownerCode));
    const compiles = mocks.compileShaderPipeline.mock.calls.length;

    await pipeline.handleShaderMessage(sourceEvent(ownerPath, ownerCode, { refreshRequestId }));

    expect(mocks.compileShaderPipeline).toHaveBeenCalledTimes(compiles + 1);
    expect(pipeline.getLastEvent()?.data.path).toBe(ownerPath);
  });

  it('still opens the owner when the user navigates back after a dropped refresh', async () => {
    const refreshRequestId = await requestOwnerRefreshFrom('common');
    await pipeline.handleShaderMessage(sourceEvent(otherPath, otherCode));
    await pipeline.handleShaderMessage(sourceEvent(ownerPath, ownerCode, { refreshRequestId }));
    const compiles = mocks.compileShaderPipeline.mock.calls.length;

    await pipeline.handleShaderMessage(sourceEvent(ownerPath, ownerCode));
    // A repeated echo of an already answered request is not a known refresh.
    await pipeline.handleShaderMessage(sourceEvent(ownerPath, ownerCode, { refreshRequestId }));

    expect(mocks.compileShaderPipeline).toHaveBeenCalledTimes(compiles + 2);
    expect(pipeline.getLastEvent()?.data.path).toBe(ownerPath);
  });

  it('applies a locked owner refresh because rejected unrelated shaders do not supersede it', async () => {
    await pipeline.handleShaderMessage(sourceEvent(ownerPath, ownerCode));
    vi.mocked(mocks.shaderLocker.isLocked).mockReturnValue(true);
    vi.mocked(mocks.shaderLocker.getLockedShaderPath).mockReturnValue(ownerPath as never);
    await pipeline.handleShaderMessage(sourceEvent(commonPath, 'fn shared() {}', { bufferPathMap: undefined }));
    const refreshRequestId = lastRefreshRequestId();
    await pipeline.handleShaderMessage(sourceEvent(otherPath, otherCode));
    const compiles = mocks.compileShaderPipeline.mock.calls.length;

    await pipeline.handleShaderMessage(sourceEvent(ownerPath, ownerCode, { refreshRequestId }));

    expect(mocks.compileShaderPipeline).toHaveBeenCalledTimes(compiles + 1);
    expect(pipeline.getLastEvent()?.data.path).toBe(ownerPath);
  });

  it('refuses a superseded owner refresh at admission, consistently on every ask', async () => {
    const refreshRequestId = await requestOwnerRefreshFrom('common');
    await pipeline.handleShaderMessage(sourceEvent(otherPath, otherCode));
    const response = sourceEvent(ownerPath, ownerCode, { refreshRequestId }).data as ShaderSourceMessage;

    expect(pipeline.admitShaderMessage(response)).toBeNull();
    expect(pipeline.admitShaderMessage(response)).toBeNull();
    await expect(pipeline.handleShaderMessage({ data: response } as MessageEvent)).resolves.toBeUndefined();
    expect(pipeline.getLastEvent()?.data.path).toBe(otherPath);
  });

  it('compiles an answered owner refresh the viewer already admitted', async () => {
    const refreshRequestId = await requestOwnerRefreshFrom('common');
    const response = sourceEvent(ownerPath, ownerCode, { refreshRequestId });
    const compiles = mocks.compileShaderPipeline.mock.calls.length;

    expect(pipeline.admitShaderMessage(response.data)).toEqual({ kind: 'main' });
    await pipeline.handleShaderMessage(response);

    expect(mocks.compileShaderPipeline).toHaveBeenCalledTimes(compiles + 1);
    expect(pipeline.getLastEvent()?.data.path).toBe(ownerPath);
  });

  it('admits linked sources without recording them as main arrivals', async () => {
    const refreshRequestId = await requestOwnerRefreshFrom('common');
    const common = sourceEvent(commonPath, 'fn shared() {}', { bufferPathMap: undefined }).data as ShaderSourceMessage;
    expect(pipeline.admitShaderMessage(common)).toEqual({ kind: 'buffer', passName: 'common' });
    const compiles = mocks.compileShaderPipeline.mock.calls.length;

    await pipeline.handleShaderMessage(sourceEvent(ownerPath, ownerCode, { refreshRequestId }));

    expect(mocks.compileShaderPipeline).toHaveBeenCalledTimes(compiles + 1);
  });

  it('does not tag an explicit standalone preview refresh', () => {
    pipeline.previewFileStandalone('/project/linked.wgsl');
    expect(mocks.transport.postMessage).toHaveBeenCalledWith({
      type: 'refresh', payload: { path: '/project/linked.wgsl' },
    });
  });
});

describe('ShaderPipeline — unlocked vertex-source routing', () => {
  let pipeline: ShaderPipeline;
  let mocks: ReturnType<typeof makeMocks>;

  const vertexCode = [
    'fn mainVertex(vertexIndex: u32, position: ptr<function, vec3<f32>>, normal: ptr<function, vec3<f32>>, uv: ptr<function, vec2<f32>>) {',
    '  *uv = *uv * 2.0;',
    '}',
  ].join('\n');
  const fragmentCode = 'fn mainImage(coord: vec2f) -> vec4f { return vec4f(1.0); }';

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

  function lastEventWith(data: unknown): void {
    (pipeline as unknown as { lastEvent: unknown }).lastEvent = { data } as unknown as MessageEvent;
  }

  function shaderEvent(path: string, code: string): MessageEvent {
    return {
      data: { type: 'shaderSource', code, path, config: null, buffers: {} },
    } as unknown as MessageEvent;
  }

  it.each(["glsl", "slang", "wgsl"])("routes a shared %s root as main after a config update", (language) => {
    const path = "/project/shared." + language;
    lastEventWith({ type: "shaderSource", path, code: fragmentCode,
      bufferPathMap: { Image: path, "__shader_studio_vertex__:Image": path } });
    expect(pipeline.getShaderMessageTarget({ path, code: fragmentCode + vertexCode })).toEqual({ kind: "main" });
  });

  it('routes a linked vertex source as vertex when unlocked', () => {
    const ownerPath = '/project/main.wgsl';
    const vertexPath = '/project/main.vert.wgsl';
    lastEventWith({
      type: 'shaderSource', code: 'main', path: ownerPath,
      bufferPathMap: { Image: ownerPath, '__shader_studio_vertex__:Image': vertexPath },
    });

    expect(pipeline.getShaderMessageTarget({ path: vertexPath, code: vertexCode }))
      .toEqual({ kind: 'vertex', passName: 'Image' });
  });

  it('routes a cold vertex activation as vertex without an owner pass', () => {
    expect(pipeline.getShaderMessageTarget({ path: '/wgsl/intellisense.vert.wgsl', code: vertexCode }))
      .toEqual({ kind: 'vertex' });
  });

  it('keeps an oddly named fragment shader with mainImage as main', () => {
    expect(pipeline.getShaderMessageTarget({ path: '/project/vertex.glsl', code: fragmentCode }))
      .toEqual({ kind: 'main' });
  });

  it('keeps a vertex-named file with fragment content as main', () => {
    expect(pipeline.getShaderMessageTarget({ path: '/project/effect.vert', code: fragmentCode }))
      .toEqual({ kind: 'main' });
  });

  it('keeps an ordinary shader as main when unlocked', () => {
    expect(pipeline.getShaderMessageTarget({ path: '/project/shader.wgsl', code: fragmentCode }))
      .toEqual({ kind: 'main' });
  });

  it('forwards explicit script uniform metadata to the debug context', () => {
    const config = { version: '1.0', passes: { Image: {} } };
    lastEventWith({
      type: 'shaderSource',
      code: fragmentCode,
      path: '/project/main.wgsl',
      config,
      buffers: {},
      customUniformInfo: [{ name: 'uGain', type: 'float' }],
    });

    pipeline.updateCurrentConfig(config);

    expect(mocks.shaderDebugManager.setShaderContext).toHaveBeenCalledWith(
      config,
      '/project/main.wgsl',
      {},
      [],
      {},
      [{ name: 'uGain', type: 'float' }],
    );
  });

  it('clears script uniforms for a complete no-script context but preserves them for an omitted context', () => {
    const base = {
      type: 'shaderSource' as const,
      code: fragmentCode,
      path: '/project/main.wgsl',
      config: { version: '1.0', passes: { Image: {} } },
      buffers: {},
    };

    lastEventWith({ ...base, scriptContextOmitted: false });
    pipeline.updateCurrentConfig(base.config);
    expect(mocks.shaderDebugManager.setShaderContext).toHaveBeenLastCalledWith(
      base.config, base.path, base.buffers, [], {}, [],
    );

    lastEventWith({ ...base, scriptContextOmitted: true });
    pipeline.updateCurrentConfig(base.config);
    expect(mocks.shaderDebugManager.setShaderContext).toHaveBeenLastCalledWith(
      base.config, base.path, base.buffers,
    );
  });

  it('refreshes the viewed owner for a linked vertex source', async () => {
    const ownerPath = '/project/main.wgsl';
    const vertexPath = '/project/main.vert.wgsl';
    lastEventWith({
      type: 'shaderSource', code: 'main', path: ownerPath,
      bufferPathMap: { Image: ownerPath, '__shader_studio_vertex__:Image': vertexPath },
    });

    const result = await pipeline.handleShaderMessage(shaderEvent(vertexPath, vertexCode));

    expect(result).toBeUndefined();
    expect(mocks.transport.postMessage).toHaveBeenCalledWith({
      type: 'refresh',
      payload: { path: ownerPath, refreshRequestId: expect.any(Number) },
    });
  });

  it('posts no refresh for a cold vertex activation', async () => {
    const result = await pipeline.handleShaderMessage(
      shaderEvent('/wgsl/intellisense.vert.wgsl', vertexCode),
    );

    expect(result).toBeUndefined();
    expect(mocks.transport.postMessage).not.toHaveBeenCalled();
  });
});
