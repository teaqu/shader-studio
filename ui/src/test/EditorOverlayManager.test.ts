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

  it('does not attempt a buffer-only recompile for a vertex source', async () => {
    const { manager, renderingEngine } = createManager();

    manager.handleConfigFileSelect('__shader_studio_vertex__:Image', '/test/shader.glsl');
    await manager.handleEditorCodeChange('void mainVertex() {}');
    await manager.compileCurrentCode();

    expect(renderingEngine.updateBufferAndRecompile).not.toHaveBeenCalled();
  });

  it('loads and recompiles a compute pass from the editor overlay', async () => {
    const { manager, transport, renderingEngine, callbacks } = createManager();
    renderingEngine.updateBufferAndRecompile.mockResolvedValue({ success: true });
    manager.setConfig({
      version: '1',
      passes: { Image: {}, ComputeParticles: { type: 'compute', path: 'particles.slang', inputs: {} } },
    });

    manager.handleConfigFileSelect('ComputeParticles', '/test/shader.slang');
    await manager.handleEditorCodeChange('[shader("compute")] void computeMain() {}');
    await manager.compileCurrentCode();

    expect(manager.getState().bufferNames).toContain('ComputeParticles');
    expect(transport.postMessage).toHaveBeenCalledWith({
      type: 'requestFileContents',
      payload: { bufferName: 'ComputeParticles', shaderPath: '/test/shader.slang' },
    });
    expect(renderingEngine.updateBufferAndRecompile).toHaveBeenCalledWith(
      'ComputeParticles',
      '[shader("compute")] void computeMain() {}',
    );
    expect(callbacks.onClearErrors).toHaveBeenCalled();
    expect(callbacks.onStartRenderLoop).toHaveBeenCalled();
  });
});
