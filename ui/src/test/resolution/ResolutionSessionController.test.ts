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
    postConfigUpdate: vi.fn(),
    ...overrides,
  };
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
          resolution: { scale: 8, customWidth: '3840', customHeight: '2160', aspectRatio: '16:9' },
        },
      },
    }, false);

    expect(deps.resolutionStore.setSessionSettings).toHaveBeenLastCalledWith(undefined);
  });

  it('does not fall back to shader config for a buffer target when the session override is cleared', () => {
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

    expect(deps.resolutionStore.setSessionSettings).toHaveBeenLastCalledWith({ scale: 1 });
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
          resolution: { scale: 8, customWidth: '3840', customHeight: '2160', aspectRatio: '16:9' },
        },
      },
    }, false);

    expect(deps.resolutionStore.setSessionSettings).toHaveBeenLastCalledWith(expect.objectContaining({
      customWidth: '1',
      customHeight: '1',
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
          resolution: { scale: 8, customWidth: '3840', customHeight: '2160', aspectRatio: '16:9' },
        },
      },
    }, false);
    ctrl.handleShaderLoadSucceeded();

    expect(deps.updatePipelineConfig).toHaveBeenLastCalledWith(expect.objectContaining({
      passes: expect.objectContaining({
        Image: expect.objectContaining({
          resolution: expect.objectContaining({
            customWidth: '1',
            customHeight: '1',
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
      customWidth: '64',
      customHeight: '32',
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

    expect(deps.resolutionStore.setFromConfig).toHaveBeenLastCalledWith(undefined);
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
            resolution: { scale: 4, customWidth: '1920', customHeight: '1080', aspectRatio: '16:9' },
          },
        },
      },
    });
    const ctrl = new ResolutionSessionController(deps);

    ctrl.setSyncWithConfig(false);
    ctrl.setImageCustomResolution('1', '1');

    vi.mocked(deps.postConfigUpdate).mockClear();
    vi.mocked(deps.updatePipelineConfig).mockClear();

    ctrl.setSyncWithConfig(true);

    expect(deps.postConfigUpdate).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        passes: expect.objectContaining({
          Image: expect.objectContaining({
            resolution: expect.objectContaining({
              customWidth: '1',
              customHeight: '1',
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
            customWidth: '1',
            customHeight: '1',
          }),
        }),
      }),
    }));
    expect(ctrl.menuVM.syncWithConfig).toBe(true);
  });
});
