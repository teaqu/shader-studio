import { describe, expect, it, vi, afterEach } from 'vitest';
import { requestShaderCode } from './shaderCodeRequest';

describe('requestShaderCode', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('clears the timeout after a successful shader code response', async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const vscodeApi = {
      postMessage: vi.fn((message: { type: string; path: string; requestId: number }) => {
        setTimeout(() => {
          window.dispatchEvent(new MessageEvent('message', {
            data: {
              type: 'shaderCode',
              path: message.path,
              requestId: message.requestId,
              code: 'void mainImage(out vec4 o, vec2 u) { o = vec4(1); }',
              config: null,
              buffers: {},
            },
          }));
        }, 0);
      }),
    };

    const result = requestShaderCode({
      vscodeApi,
      path: '/test/shader.glsl',
      target: window,
      timeoutMs: 5000,
      onTimeout,
    });

    await vi.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toMatchObject({
      code: expect.stringContaining('mainImage'),
      config: null,
      buffers: {},
      language: 'glsl',
    });

    await vi.advanceTimersByTimeAsync(5000);

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('receives a synchronous response sent during postMessage', async () => {
    const vscodeApi = {
      postMessage: vi.fn((message: { type: string; path: string; requestId: number }) => {
        window.dispatchEvent(new MessageEvent('message', {
          data: {
            type: 'shaderCode',
            path: message.path,
            requestId: message.requestId,
            code: 'void mainImage(out vec4 o, vec2 u) { o = vec4(1); }',
            config: { common: '/test/common.glsl' },
            buffers: { BufferA: 'void mainImage(out vec4 o, vec2 u) { o = vec4(0); }' },
          },
        }));
      }),
    };

    await expect(requestShaderCode({
      vscodeApi,
      path: '/test/shader.glsl',
      target: window,
    })).resolves.toMatchObject({
      config: { common: '/test/common.glsl' },
      buffers: { BufferA: expect.stringContaining('mainImage') },
      language: 'glsl',
    });
  });

  it('ignores a stale same-path response with a different request ID', async () => {
    let requestId = 0;
    const vscodeApi = {
      postMessage: vi.fn((message: { requestId: number }) => {
        requestId = message.requestId;
      }),
    };
    const result = requestShaderCode({
      vscodeApi,
      path: '/test/shader.glsl',
      target: window,
    });
    let resolved = false;
    void result.then(() => { resolved = true; });

    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'shaderCode',
        path: '/test/shader.glsl',
        requestId: requestId - 1,
        code: 'stale',
      },
    }));
    await Promise.resolve();
    expect(resolved).toBe(false);

    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'shaderCode',
        path: '/test/shader.glsl',
        requestId,
        code: 'current',
      },
    }));
    await expect(result).resolves.toMatchObject({ code: 'current' });
  });

  it('cancels and removes its listener when aborted', async () => {
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(window, 'removeEventListener');
    const result = requestShaderCode({
      vscodeApi: { postMessage: vi.fn() },
      path: '/test/shader.glsl',
      target: window,
      signal: controller.signal,
    });

    controller.abort();

    await expect(result).rejects.toThrow('Shader code request cancelled');
    expect(removeEventListener).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('returns custom uniform declarations and type metadata', async () => {
    const vscodeApi = {
      postMessage: vi.fn((message: { type: string; path: string; requestId: number }) => {
        window.dispatchEvent(new MessageEvent('message', {
          data: {
            type: 'shaderCode',
            path: message.path,
            requestId: message.requestId,
            code: 'shader code using uFloat',
            config: { script: './uniforms.ts' },
            buffers: {},
            customUniformDeclarations: 'uniform float uFloat;',
            customUniformInfo: [{ name: 'uFloat', type: 'float' }],
          },
        }));
      }),
    };

    await expect(requestShaderCode({
      vscodeApi,
      path: '/test/shader.glsl',
      target: window,
    })).resolves.toMatchObject({
      customUniformDeclarations: 'uniform float uFloat;',
      customUniformInfo: [{ name: 'uFloat', type: 'float' }],
    });
  });

  it('returns custom uniform script errors', async () => {
    const vscodeApi = {
      postMessage: vi.fn((message: { type: string; path: string; requestId: number }) => {
        window.dispatchEvent(new MessageEvent('message', {
          data: {
            type: 'shaderCode',
            path: message.path,
            requestId: message.requestId,
            code: 'shader code',
            config: { script: './uniforms.ts' },
            buffers: {},
            scriptBundleError: 'bundle failed',
          },
        }));
      }),
    };

    await expect(requestShaderCode({
      vscodeApi,
      path: '/test/shader.glsl',
      target: window,
    })).resolves.toMatchObject({ scriptBundleError: 'bundle failed' });
  });

  it.each([
    ['slang', 'slang'],
    ['glsl', 'glsl'],
    [undefined, 'glsl'],
    ['hlsl', 'glsl'],
  ])('normalizes response language %s to %s', async (language, expectedLanguage) => {
    const vscodeApi = {
      postMessage: vi.fn((message: { type: string; path: string; requestId: number }) => {
        window.dispatchEvent(new MessageEvent('message', {
          data: {
            type: 'shaderCode',
            path: message.path,
            requestId: message.requestId,
            code: 'shader code',
            config: null,
            buffers: {},
            language,
          },
        }));
      }),
    };

    await expect(requestShaderCode({
      vscodeApi,
      path: '/test/shader',
      target: window,
    })).resolves.toMatchObject({
      code: 'shader code',
      config: null,
      buffers: {},
      language: expectedLanguage,
    });
  });
});
