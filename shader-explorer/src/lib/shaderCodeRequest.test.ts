import { describe, expect, it, vi, afterEach } from 'vitest';
import { requestShaderCode } from './shaderCodeRequest';

describe('requestShaderCode', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('clears the timeout after a successful shader code response', async () => {
        vi.useFakeTimers();
        const onTimeout = vi.fn();
        const vscodeApi = {
            postMessage: vi.fn((message: { type: string; path: string }) => {
                setTimeout(() => {
                    window.dispatchEvent(new MessageEvent('message', {
                        data: {
                            type: 'shaderCode',
                            path: message.path,
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
        });

        await vi.advanceTimersByTimeAsync(5000);

        expect(onTimeout).not.toHaveBeenCalled();
    });

    it('receives a synchronous response sent during postMessage', async () => {
        const vscodeApi = {
            postMessage: vi.fn((message: { type: string; path: string }) => {
                window.dispatchEvent(new MessageEvent('message', {
                    data: {
                        type: 'shaderCode',
                        path: message.path,
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
        });
    });
});
