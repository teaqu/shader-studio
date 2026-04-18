import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EditorOverlayManager } from '../lib/EditorOverlayManager.svelte';
import type { ShaderSourceMessage } from '@shader-studio/types';

describe('EditorOverlayManager', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  function createManager() {
    const transport = {
      postMessage: vi.fn(),
      onMessage: vi.fn(),
      dispose: vi.fn(),
      getType: () => 'vscode' as const,
      isConnected: () => true,
    };

    const renderingEngine = {
      updateBufferAndRecompile: vi.fn(),
    };

    const callbacks = {
      onStateChanged: vi.fn(),
      onShaderCodeChanged: vi.fn(),
      onErrors: vi.fn(),
      onClearErrors: vi.fn(),
      onStartRenderLoop: vi.fn(),
      getLastShaderEvent: vi.fn(() => ({
        data: {
          type: 'shaderSource',
          path: '/test/shader.glsl',
          code: 'old code',
          config: null,
          buffers: {},
          pathMap: {},
        },
      } as MessageEvent<ShaderSourceMessage>)),
      handleShaderMessage: vi.fn(),
    };

    const manager = new EditorOverlayManager(
      transport as any,
      () => renderingEngine as any,
      callbacks,
    );

    return { manager, transport, renderingEngine, callbacks };
  }

  it('handleEditorCodeChange updates overlay state without compiling immediately', async () => {
    const { manager, callbacks } = createManager();
    callbacks.onStateChanged.mockClear();

    await manager.handleEditorCodeChange('edited code');

    expect(manager.getState().fileCode).toBe('edited code');
    expect(callbacks.onStateChanged).toHaveBeenCalled();
    expect(callbacks.onShaderCodeChanged).not.toHaveBeenCalled();
    expect(callbacks.handleShaderMessage).not.toHaveBeenCalled();
  });

  it('compileCurrentCode recompiles the image shader from the latest overlay code', async () => {
    const { manager, callbacks } = createManager();
    manager.setShaderSource('original code', '/test/shader.glsl');
    await manager.handleEditorCodeChange('compiled code');
    callbacks.onShaderCodeChanged.mockClear();
    callbacks.handleShaderMessage.mockClear();

    await manager.compileCurrentCode();

    expect(manager.currentShaderCode).toBe('compiled code');
    expect(callbacks.onShaderCodeChanged).toHaveBeenCalledWith('compiled code');
    expect(callbacks.handleShaderMessage).toHaveBeenCalledTimes(1);
    const event = callbacks.handleShaderMessage.mock.calls[0][0];
    expect(event.data.code).toBe('compiled code');
  });
});
