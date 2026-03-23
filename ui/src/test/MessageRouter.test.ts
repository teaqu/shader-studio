import { describe, it, expect, vi } from 'vitest';
import { MessageRouter } from '../lib/MessageRouter';

describe('MessageRouter', () => {
  function createRouter() {
    const shaderStudio = {
      handleShaderMessage: vi.fn(),
      getIsLocked: vi.fn(() => false),
    };

    const callbacks = {
      onError: vi.fn(),
      onMessageError: vi.fn(),
      onFileContents: vi.fn(),
      onShaderSource: vi.fn(),
      onToggleEditorOverlay: vi.fn(),
      onResetLayout: vi.fn(),
      onManualCompile: vi.fn(),
      onCompilationResult: vi.fn(),
      onLockStateChanged: vi.fn(),
      onCustomUniformValues: vi.fn(),
    };

    const router = new MessageRouter(() => shaderStudio as any, callbacks);
    router.markInitialized();

    return { router, shaderStudio, callbacks };
  }

  it('routes manualCompile messages to onManualCompile without delegating to ShaderStudio', async () => {
    const { router, shaderStudio, callbacks } = createRouter();

    await router.handleMessage({
      data: { type: 'manualCompile' },
    } as any);

    expect(callbacks.onManualCompile).toHaveBeenCalledTimes(1);
    expect(shaderStudio.handleShaderMessage).not.toHaveBeenCalled();
    expect(callbacks.onCompilationResult).not.toHaveBeenCalled();
  });
});
