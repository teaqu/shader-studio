import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ResolutionSessionController } from '../../lib/resolution/ResolutionSessionController.svelte';
import type { ControllerDeps } from '../../lib/resolution/ResolutionSessionController.svelte';
import type { ShaderConfig } from '@shader-studio/types';
import type { ShaderDebugState } from '../../lib/types/ShaderDebugState';

const defaultDebugState: ShaderDebugState = {
  isEnabled: false,
  currentLine: null,
  lineContent: null,
  filePath: null,
  isActive: false,
  functionContext: null,
  isLineLocked: false,
  isInlineRenderingEnabled: false,
  normalizeMode: 'off',
  isStepEnabled: false,
  stepEdge: 0.5,
  debugError: null,
  isVariableInspectorEnabled: false,
  capturedVariables: [],
  activeBufferName: 'Image',
};

const baseConfig: ShaderConfig = {
  version: '1.0',
  passes: { Image: { inputs: {} } },
};

function makeTransport() {
  return {
    postMessage: vi.fn(),
    onMessage: vi.fn(),
    dispose: vi.fn(),
    getType: vi.fn(() => 'vscode' as const),
    isConnected: vi.fn(() => true),
  };
}

function makeDeps(overrides: Partial<ControllerDeps> = {}): ControllerDeps {
  let config: ShaderConfig | null = baseConfig;
  return {
    get currentConfig() {
      return config;
    },
    get debugState() {
      return defaultDebugState;
    },
    resolutionStore: {
      setFromConfig: vi.fn(),
      setSessionSettings: vi.fn(),
    },
    aspectRatioStore: {
      setFromConfig: vi.fn(),
      setSessionMode: vi.fn(),
    },
    setCurrentConfig: vi.fn((c) => {
      config = c;
    }),
    getShaderPath: vi.fn(() => '/shader.glsl'),
    getBufferPathMap: vi.fn(() => ({})),
    getCurrentAspectRatioMode: vi.fn(() => 'fill' as const),
    isInitialized: vi.fn(() => true),
    hasShader: vi.fn(() => true),
    updatePipelineConfig: vi.fn(),
    recompileCurrentShader: vi.fn(),
    setShaderContext: vi.fn(),
    setEditorConfig: vi.fn(),
    transport: makeTransport(),
    ...overrides,
  };
}

function postedPayloads(deps: ControllerDeps): Array<{ config: ShaderConfig; text: string; shaderPath: string; skipRefresh: boolean }> {
  const post = vi.mocked(deps.transport.postMessage);
  return post.mock.calls
    .filter((call) => call[0]?.type === 'updateConfig')
    .map((call) => call[0].payload);
}

describe('ResolutionSessionController — syncWithConfig persistence', () => {
  it('defaults syncWithConfig to true', () => {
    const ctrl = new ResolutionSessionController(makeDeps());
    expect(ctrl.menuVM.syncWithConfig).toBe(true);
  });

  it('setSyncWithConfig(false) is reflected in menuVM', () => {
    const ctrl = new ResolutionSessionController(makeDeps());
    ctrl.setSyncWithConfig(false);
    expect(ctrl.menuVM.syncWithConfig).toBe(false);
  });

  it('syncWithConfig persists after handleShaderLoaded with isSameShader=false (new shader)', () => {
    const ctrl = new ResolutionSessionController(makeDeps());
    ctrl.setSyncWithConfig(false);

    ctrl.handleShaderLoaded(baseConfig, false);

    expect(ctrl.menuVM.syncWithConfig).toBe(false);
  });

  it('syncWithConfig persists after handleShaderLoaded with isSameShader=true', () => {
    const ctrl = new ResolutionSessionController(makeDeps());
    ctrl.setSyncWithConfig(false);

    ctrl.handleShaderLoaded(baseConfig, true);

    expect(ctrl.menuVM.syncWithConfig).toBe(false);
  });
});

describe('ResolutionSessionController — new shader load with syncWithConfig=false', () => {
  it('does not fall back to shader config when the image session override is cleared', () => {
    const deps = makeDeps();
    const ctrl = new ResolutionSessionController(deps);
    ctrl.setSyncWithConfig(false);

    ctrl.resetCurrentTarget();
    vi.mocked(deps.resolutionStore.setSessionSettings).mockClear();

    ctrl.handleShaderLoaded({
      version: '1.0',
      passes: {
        Image: {
          inputs: {},
          resolution: { scale: 8, width: 3840, height: 2160 },
        },
      },
    }, false);

    expect(deps.resolutionStore.setSessionSettings).toHaveBeenLastCalledWith({ scale: 1 });
  });

  it('preserves snapshot of old config buffer resolution after reset when loading a new shader', () => {
    const deps = makeDeps({
      get debugState() {
        return {
          ...defaultDebugState,
          isEnabled: true,
          isActive: true,
          isInlineRenderingEnabled: true,
          activeBufferName: 'BufferA',
        };
      },
      currentConfig: {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: {
            path: '/test/bufferA.glsl',
            inputs: {},
            resolution: { width: 64, height: 32 },
          },
        },
      },
    });
    const ctrl = new ResolutionSessionController(deps);
    ctrl.setSyncWithConfig(false);

    ctrl.resetCurrentTarget();
    vi.mocked(deps.resolutionStore.setSessionSettings).mockClear();

    ctrl.handleShaderLoaded({
      version: '1.0',
      passes: {
        Image: { inputs: {} },
        BufferA: {
          path: '/test/bufferA.glsl',
          inputs: {},
          resolution: { width: 3840, height: 2160 },
        },
      },
    }, false);

    expect(deps.resolutionStore.setSessionSettings).toHaveBeenLastCalledWith({
      scale: 1,
      width: 64,
      height: 32,
    });
  });

  it('preserves the image session override when loading a new shader', () => {
    const deps = makeDeps();
    const ctrl = new ResolutionSessionController(deps);
    ctrl.setSyncWithConfig(false);
    ctrl.setImageCustomResolution('1', '1');

    vi.mocked(deps.resolutionStore.setSessionSettings).mockClear();
    ctrl.handleShaderLoaded({
      version: '1.0',
      passes: {
        Image: {
          inputs: {},
          resolution: { scale: 8, width: 3840, height: 2160 },
        },
      },
    }, false);

    expect(deps.resolutionStore.setSessionSettings).toHaveBeenLastCalledWith(expect.objectContaining({
      width: 1,
      height: 1,
    }));
  });

  it('does NOT call recompileCurrentShader when loading a new shader', () => {
    const deps = makeDeps();
    const ctrl = new ResolutionSessionController(deps);
    ctrl.setSyncWithConfig(false);

    vi.mocked(deps.recompileCurrentShader).mockClear();
    ctrl.handleShaderLoaded(baseConfig, false);

    expect(deps.recompileCurrentShader).not.toHaveBeenCalled();
  });

  it('does NOT call updatePipelineConfig when loading a new shader', () => {
    const deps = makeDeps();
    const ctrl = new ResolutionSessionController(deps);
    ctrl.setSyncWithConfig(false);

    vi.mocked(deps.updatePipelineConfig).mockClear();
    ctrl.handleShaderLoaded(baseConfig, false);

    expect(deps.updatePipelineConfig).not.toHaveBeenCalled();
  });

  it('applies the session runtime config after a new shader finishes loading', () => {
    const deps = makeDeps();
    const ctrl = new ResolutionSessionController(deps);
    ctrl.setSyncWithConfig(false);
    ctrl.setImageCustomResolution('1', '1');

    vi.mocked(deps.updatePipelineConfig).mockClear();
    vi.mocked(deps.recompileCurrentShader).mockClear();

    ctrl.handleShaderLoaded({
      version: '1.0',
      passes: {
        Image: {
          inputs: {},
          resolution: { scale: 8, width: 3840, height: 2160 },
        },
      },
    }, false);
    ctrl.handleShaderLoadSucceeded();

    expect(deps.updatePipelineConfig).toHaveBeenLastCalledWith(expect.objectContaining({
      passes: expect.objectContaining({
        Image: expect.objectContaining({
          resolution: expect.objectContaining({
            width: 1,
            height: 1,
          }),
        }),
      }),
    }));
    expect(deps.recompileCurrentShader).toHaveBeenCalled();
  });

  it('DOES call recompileCurrentShader when reloading the same shader with syncWithConfig=false', () => {
    const deps = makeDeps();
    const ctrl = new ResolutionSessionController(deps);
    ctrl.setSyncWithConfig(false);
    ctrl.setImageScale(2);

    vi.mocked(deps.recompileCurrentShader).mockClear();
    ctrl.handleShaderLoaded(baseConfig, true);

    expect(deps.recompileCurrentShader).toHaveBeenCalled();
  });
});

describe('ResolutionSessionController — syncWithConfig=true rereads shader config', () => {
  it('clears stale buffer preview values when switching to an image shader without resolution config', () => {
    let debugState: ShaderDebugState = {
      ...defaultDebugState,
      isEnabled: true,
      isActive: true,
      isInlineRenderingEnabled: true,
      activeBufferName: 'BufferA',
    };

    const deps = makeDeps({
      get debugState() {
        return debugState;
      },
    });
    const ctrl = new ResolutionSessionController(deps);

    ctrl.handleShaderLoaded({
      version: '1.0',
      passes: {
        Image: { inputs: {} },
        BufferA: {
          path: '/test/bufferA.glsl',
          inputs: {},
          resolution: { width: 64, height: 32 },
        },
      },
    }, false);

    expect(deps.resolutionStore.setSessionSettings).toHaveBeenLastCalledWith({
      scale: 1,
      width: 64,
      height: 32,
    });

    debugState = {
      ...defaultDebugState,
      isEnabled: false,
      isActive: false,
      isInlineRenderingEnabled: false,
      activeBufferName: 'Image',
    };

    ctrl.handleShaderLoaded({
      version: '1.0',
      passes: {
        Image: { inputs: {} },
      },
    }, false);

    expect(deps.resolutionStore.setSessionSettings).toHaveBeenLastCalledWith({ scale: 1 });
  });
});

describe('ResolutionSessionController — enabling syncWithConfig writes session state to config', () => {
  it('persists the current image session override into config when sync is enabled', () => {
    const deps = makeDeps({
      currentConfig: {
        version: '1.0',
        passes: {
          Image: {
            inputs: {},
            resolution: { scale: 4, width: 1920, height: 1080 },
          },
        },
      },
    });
    const ctrl = new ResolutionSessionController(deps);

    ctrl.setSyncWithConfig(false);
    ctrl.setImageCustomResolution('1', '1');

    vi.mocked(deps.transport.postMessage).mockClear();
    vi.mocked(deps.updatePipelineConfig).mockClear();

    ctrl.setSyncWithConfig(true);

    expect(postedPayloads(deps)[0]).toEqual(expect.objectContaining({
      config: expect.objectContaining({
        passes: expect.objectContaining({
          Image: expect.objectContaining({
            resolution: expect.objectContaining({
              width: 1,
              height: 1,
            }),
          }),
        }),
      }),
      skipRefresh: true,
    }));
    expect(deps.updatePipelineConfig).toHaveBeenCalledWith(expect.objectContaining({
      passes: expect.objectContaining({
        Image: expect.objectContaining({
          resolution: expect.objectContaining({
            width: 1,
            height: 1,
          }),
        }),
      }),
    }));
    expect(ctrl.menuVM.syncWithConfig).toBe(true);
  });
});

describe('ResolutionSessionController — persistConfigUpdate ordering', () => {
  it('posts the config update BEFORE mutating reactive currentConfig state', () => {
    const deps = makeDeps();
    const ctrl = new ResolutionSessionController(deps);
    vi.mocked(deps.transport.postMessage).mockClear();
    vi.mocked(deps.setCurrentConfig).mockClear();

    ctrl.setImageScale(2);

    const postOrder = vi.mocked(deps.transport.postMessage).mock.invocationCallOrder[0];
    const setOrder = vi.mocked(deps.setCurrentConfig).mock.invocationCallOrder[0];
    expect(postOrder).toBeDefined();
    expect(setOrder).toBeDefined();
    expect(postOrder).toBeLessThan(setOrder);
  });

  it('posts the config update before updatePipelineConfig and setShaderContext', () => {
    const deps = makeDeps();
    const ctrl = new ResolutionSessionController(deps);
    vi.mocked(deps.transport.postMessage).mockClear();
    vi.mocked(deps.updatePipelineConfig).mockClear();
    vi.mocked(deps.setShaderContext).mockClear();

    ctrl.setAspectRatio('4:3');

    const postOrder = vi.mocked(deps.transport.postMessage).mock.invocationCallOrder[0];
    const pipelineOrder = vi.mocked(deps.updatePipelineConfig).mock.invocationCallOrder[0];
    const ctxOrder = vi.mocked(deps.setShaderContext).mock.invocationCallOrder[0];
    expect(postOrder).toBeLessThan(pipelineOrder);
    expect(postOrder).toBeLessThan(ctxOrder);
  });
});

describe('ResolutionSessionController — sync ON popup setters persist to disk', () => {
  it('setImageScale posts config with the new scale and stripped resolved_path', () => {
    const deps = makeDeps({
      currentConfig: {
        version: '1.0',
        passes: {
          Image: { inputs: {}, resolved_path: '/abs/main.glsl' },
        },
      } as ShaderConfig,
    });
    const ctrl = new ResolutionSessionController(deps);
    vi.mocked(deps.transport.postMessage).mockClear();

    ctrl.setImageScale(2);

    expect(postedPayloads(deps)).toHaveLength(1);
    const payload = postedPayloads(deps)[0]!;
    expect(payload.shaderPath).toBe('/shader.glsl');
    expect(payload.skipRefresh).toBe(true);
    const parsed = JSON.parse(payload.text) as ShaderConfig;
    expect(parsed.passes.Image.resolution?.scale).toBe(2);
    expect(payload.text).not.toContain('resolved_path');
  });

  it('setAspectRatio posts config with the new aspect ratio', () => {
    const deps = makeDeps();
    const ctrl = new ResolutionSessionController(deps);
    vi.mocked(deps.transport.postMessage).mockClear();

    ctrl.setAspectRatio('1:1');

    const payload = postedPayloads(deps)[0]!;
    const parsed = JSON.parse(payload.text) as ShaderConfig;
    expect(parsed.passes.Image.resolution?.aspectRatio).toBe('1:1');
  });

  it('setImageCustomResolution posts config with custom dimensions', () => {
    const deps = makeDeps();
    const ctrl = new ResolutionSessionController(deps);
    vi.mocked(deps.transport.postMessage).mockClear();

    ctrl.setImageCustomResolution('800', '600');

    const payload = postedPayloads(deps)[0]!;
    const parsed = JSON.parse(payload.text) as ShaderConfig;
    const resolution = parsed.passes.Image.resolution as { width?: number; height?: number };
    expect(resolution.width).toBe(800);
    expect(resolution.height).toBe(600);
  });

  it('setBufferScale posts config with buffer scale', () => {
    const deps = makeDeps({
      get debugState() {
        return {
          ...defaultDebugState,
          isEnabled: true,
          isActive: true,
          isInlineRenderingEnabled: true,
          activeBufferName: 'BufferA',
        };
      },
      currentConfig: {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { path: '/b.glsl', inputs: {} },
        },
      },
    });
    const ctrl = new ResolutionSessionController(deps);
    vi.mocked(deps.transport.postMessage).mockClear();

    ctrl.setBufferScale(0.5);

    const payload = postedPayloads(deps)[0]!;
    const parsed = JSON.parse(payload.text) as ShaderConfig;
    const bufferPass = parsed.passes.BufferA as { resolution?: { scale?: number } };
    expect(bufferPass.resolution?.scale).toBe(0.5);
  });

  it('setBufferFixedResolution posts config with width/height', () => {
    const deps = makeDeps({
      get debugState() {
        return {
          ...defaultDebugState,
          isEnabled: true,
          isActive: true,
          isInlineRenderingEnabled: true,
          activeBufferName: 'BufferA',
        };
      },
      currentConfig: {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { path: '/b.glsl', inputs: {} },
        },
      },
    });
    const ctrl = new ResolutionSessionController(deps);
    vi.mocked(deps.transport.postMessage).mockClear();

    ctrl.setBufferFixedResolution('256', '256');

    const payload = postedPayloads(deps)[0]!;
    const parsed = JSON.parse(payload.text) as ShaderConfig;
    const bufferPass = parsed.passes.BufferA as { resolution?: { width?: number; height?: number } };
    expect(bufferPass.resolution?.width).toBe(256);
    expect(bufferPass.resolution?.height).toBe(256);
  });
});

describe('ResolutionSessionController — sync OFF does NOT persist (Local Override)', () => {
  it('setImageScale does not call postConfigUpdate', () => {
    const deps = makeDeps();
    const ctrl = new ResolutionSessionController(deps);
    ctrl.setSyncWithConfig(false);
    vi.mocked(deps.transport.postMessage).mockClear();

    ctrl.setImageScale(2);

    expect(postedPayloads(deps)).toHaveLength(0);
  });

  it('setBufferScale does not call postConfigUpdate', () => {
    const deps = makeDeps({
      get debugState() {
        return {
          ...defaultDebugState,
          isEnabled: true,
          isActive: true,
          isInlineRenderingEnabled: true,
          activeBufferName: 'BufferA',
        };
      },
      currentConfig: {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { path: '/b.glsl', inputs: {} },
        },
      },
    });
    const ctrl = new ResolutionSessionController(deps);
    ctrl.setSyncWithConfig(false);
    vi.mocked(deps.transport.postMessage).mockClear();

    ctrl.setBufferScale(0.5);

    expect(postedPayloads(deps)).toHaveLength(0);
  });
});

describe('ResolutionSessionController — handleConfigUpdated does not post', () => {
  it('does not call postConfigUpdate (it is a state-receive path)', () => {
    const deps = makeDeps();
    const ctrl = new ResolutionSessionController(deps);
    vi.mocked(deps.transport.postMessage).mockClear();

    ctrl.handleConfigUpdated({
      version: '1.0',
      passes: {
        Image: { inputs: {}, resolution: { scale: 4 } },
      },
    });

    expect(postedPayloads(deps)).toHaveLength(0);
  });
});

describe('ResolutionSessionController — resetCurrentTarget with syncWithConfig=false', () => {
  it('resets image override to current config resolution when config has one', () => {
    const deps = makeDeps({
      currentConfig: {
        version: '1.0',
        passes: {
          Image: {
            inputs: {},
            resolution: { scale: 2, customWidth: '1280', customHeight: '720', aspectRatio: '16:9' },
          },
        },
      },
    });
    const ctrl = new ResolutionSessionController(deps);
    ctrl.setSyncWithConfig(false);
    ctrl.setImageCustomResolution('100', '100');

    vi.mocked(deps.updatePipelineConfig).mockClear();
    ctrl.resetCurrentTarget();

    expect(deps.updatePipelineConfig).toHaveBeenLastCalledWith(expect.objectContaining({
      passes: expect.objectContaining({
        Image: expect.objectContaining({
          resolution: expect.objectContaining({
            scale: 2,
            customWidth: '1280',
            customHeight: '720',
            aspectRatio: '16:9',
          }),
        }),
      }),
    }));
  });

  it('clears image override when config has no resolution', () => {
    const deps = makeDeps();
    const ctrl = new ResolutionSessionController(deps);
    ctrl.setSyncWithConfig(false);
    ctrl.setImageCustomResolution('100', '100');

    vi.mocked(deps.updatePipelineConfig).mockClear();
    ctrl.resetCurrentTarget();

    const lastCall = vi.mocked(deps.updatePipelineConfig).mock.calls.at(-1)?.[0];
    expect(lastCall?.passes.Image.resolution).toBeUndefined();
  });

  it('sets aspect ratio to auto when resetting and config has no aspect ratio', () => {
    const deps = makeDeps();
    const ctrl = new ResolutionSessionController(deps);
    ctrl.setSyncWithConfig(false);
    ctrl.setAspectRatio('16:9');

    vi.mocked(deps.aspectRatioStore.setSessionMode).mockClear();
    ctrl.resetCurrentTarget();

    expect(deps.aspectRatioStore.setSessionMode).toHaveBeenLastCalledWith('auto');
  });

  it('resets buffer override to current config resolution when config has one', () => {
    const deps = makeDeps({
      get debugState() {
        return {
          ...defaultDebugState,
          isEnabled: true,
          isActive: true,
          isInlineRenderingEnabled: true,
          activeBufferName: 'BufferA',
        };
      },
      currentConfig: {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: {
            path: '/test/bufferA.glsl',
            inputs: {},
            resolution: { width: 64, height: 32 },
          },
        },
      },
    });
    const ctrl = new ResolutionSessionController(deps);
    ctrl.setSyncWithConfig(false);
    ctrl.setBufferFixedResolution('200', '200');

    vi.mocked(deps.updatePipelineConfig).mockClear();
    ctrl.resetCurrentTarget();

    expect(deps.updatePipelineConfig).toHaveBeenLastCalledWith(expect.objectContaining({
      passes: expect.objectContaining({
        BufferA: expect.objectContaining({
          resolution: { width: 64, height: 32 },
        }),
      }),
    }));
  });

  it('clears buffer override when config has no resolution for that buffer', () => {
    const deps = makeDeps({
      get debugState() {
        return {
          ...defaultDebugState,
          isEnabled: true,
          isActive: true,
          isInlineRenderingEnabled: true,
          activeBufferName: 'BufferA',
        };
      },
      currentConfig: {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: {
            path: '/test/bufferA.glsl',
            inputs: {},
          },
        },
      },
    });
    const ctrl = new ResolutionSessionController(deps);
    ctrl.setSyncWithConfig(false);
    ctrl.setBufferFixedResolution('200', '200');

    vi.mocked(deps.updatePipelineConfig).mockClear();
    ctrl.resetCurrentTarget();

    const lastCall = vi.mocked(deps.updatePipelineConfig).mock.calls.at(-1)?.[0];
    const bufferPass = lastCall?.passes.BufferA as { resolution?: unknown } | undefined;
    expect(bufferPass?.resolution).toBeUndefined();
  });
});
