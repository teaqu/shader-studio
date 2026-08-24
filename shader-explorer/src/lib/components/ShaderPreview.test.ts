import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ShaderPreview from './ShaderPreview.svelte';
import type { ShaderFile } from '../types/ShaderFile';

const { mockEngine, createEngineForLanguage } = vi.hoisted(() => ({
    mockEngine: {
        initialize: vi.fn(),
        setInputEnabled: vi.fn(),
        compileShaderPipeline: vi.fn(),
        render: vi.fn(),
        renderForCapture: vi.fn(),
        startRenderLoop: vi.fn(),
        stopRenderLoop: vi.fn(),
        dispose: vi.fn(),
        getShaderLanguage: vi.fn<() => 'glsl' | 'slang'>(() => 'glsl'),
    },
    createEngineForLanguage: vi.fn(),
}));

vi.mock('../engineFactory', () => ({ createEngineForLanguage }));

// jsdom has no WebGL — stub getContext so cleanupRenderer can release GLSL contexts.
const getContextMock = vi.fn<(contextId: string) => WebGL2RenderingContext | null>(() => null);
HTMLCanvasElement.prototype.getContext = getContextMock as unknown as typeof HTMLCanvasElement.prototype.getContext;
const toDataUrlMock = vi.fn<(type?: string, quality?: number) => string>(
    () => 'data:image/png;base64,rendered',
);
HTMLCanvasElement.prototype.toDataURL = toDataUrlMock;

const makeShader = (overrides: Partial<ShaderFile> = {}): ShaderFile => ({
    path: '/test/shader.glsl',
    name: 'shader.glsl',
    relativePath: 'test/shader.glsl',
    hasConfig: false,
    modifiedTime: 1000,
    createdTime: 900,
    ...overrides,
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return { promise, resolve, reject };
}

// vscodeApi that auto-replies to requestShaderCode so loadShaderCode resolves
function makeVscodeApi(
    code = 'void mainImage(out vec4 o,vec2 u){o=vec4(1);}',
    language: 'glsl' | 'slang' = 'glsl',
) {
    return {
        postMessage: vi.fn((msg: any) => {
            if (msg.type === 'requestShaderCode') {
                setTimeout(() => {
                    window.dispatchEvent(new MessageEvent('message', {
                        data: { type: 'shaderCode', path: msg.path, requestId: msg.requestId, code, config: null, buffers: {}, language },
                    }));
                }, 0);
            }
        }),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    getContextMock.mockReturnValue(null);
    toDataUrlMock.mockReturnValue('data:image/png;base64,rendered');
    createEngineForLanguage.mockReset().mockReturnValue(mockEngine);
    mockEngine.initialize.mockReset();
    mockEngine.setInputEnabled.mockReset();
    mockEngine.compileShaderPipeline.mockReset().mockResolvedValue({ success: true, errors: [] });
    mockEngine.render.mockReset();
    mockEngine.renderForCapture.mockReset();
    mockEngine.startRenderLoop.mockReset();
    mockEngine.stopRenderLoop.mockReset();
    mockEngine.dispose.mockReset();
    mockEngine.getShaderLanguage.mockReset().mockReturnValue('glsl');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        cb(0);
        return 0;
    });
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('ShaderPreview - loading state', () => {
    it('shows loading placeholder (not bare canvas) while thumbnail is loading', () => {
        const { container } = render(ShaderPreview, {
            props: { shader: makeShader(), vscodeApi: makeVscodeApi(), width: 320, height: 180 },
        });

        expect(container.querySelector('.loading-placeholder')).not.toBeNull();
        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('.shader-error')).toBeNull();
    });

    it('canvas is visible (not offscreen) while thumbnail is rendering', () => {
        const { container } = render(ShaderPreview, {
            props: { shader: makeShader(), vscodeApi: makeVscodeApi(), width: 320, height: 180 },
        });

        const canvas = container.querySelector('canvas');
        expect(canvas).not.toBeNull();
        expect(canvas?.classList.contains('offscreen')).toBe(false);
    });

    it('shows cached thumbnail image immediately when available', () => {
        const shader = makeShader({ cachedThumbnail: 'data:image/png;base64,abc' });

        const { container } = render(ShaderPreview, {
            props: { shader, vscodeApi: makeVscodeApi(), width: 320, height: 180 },
        });

        const img = container.querySelector('img');
        expect(img).not.toBeNull();
        expect(img?.getAttribute('src')).toBe('data:image/png;base64,abc');
        expect(container.querySelector('.loading-placeholder')).toBeNull();
    });

    it('shows a controlled failure when a custom uniform script cannot be loaded', async () => {
        const onCompilationFailed = vi.fn();
        const vscodeApi = {
            postMessage: vi.fn((msg: { type: string; path: string; requestId: number }) => {
                setTimeout(() => {
                    window.dispatchEvent(new MessageEvent('message', {
                        data: {
                            type: 'shaderCode',
                            path: msg.path,
                            requestId: msg.requestId,
                            code: 'void mainImage(out vec4 color, vec2 coord) { color = vec4(uFloat); }',
                            config: { script: './uniforms.ts' },
                            buffers: {},
                            scriptBundleError: 'bundle failed',
                        },
                    }));
                }, 0);
            }),
        };

        const { container } = render(ShaderPreview, {
            props: { shader: makeShader(), vscodeApi, onCompilationFailed },
        });

        await waitFor(() => expect(container.querySelector('.shader-error')).not.toBeNull());
        expect(mockEngine.compileShaderPipeline).not.toHaveBeenCalled();
        expect(onCompilationFailed).toHaveBeenCalledOnce();
        expect(console.error).toHaveBeenCalledWith(
            'Failed to load shader code:',
            expect.objectContaining({ message: 'bundle failed' }),
        );
    });
});

describe('ShaderPreview - thumbnail resize', () => {
    it('serializes thumbnail rendering while sharing the GLSL canvas', async () => {
        const firstCompile = deferred<{ success: boolean; errors: string[] }>();
        mockEngine.compileShaderPipeline
            .mockImplementationOnce(() => firstCompile.promise)
            .mockResolvedValue({ success: true, errors: [] });

        render(ShaderPreview, {
            props: { shader: makeShader({ path: '/test/first.glsl' }), vscodeApi: makeVscodeApi() },
        });
        render(ShaderPreview, {
            props: { shader: makeShader({ path: '/test/second.glsl' }), vscodeApi: makeVscodeApi() },
        });

        await waitFor(() => expect(mockEngine.compileShaderPipeline).toHaveBeenCalledOnce());
        firstCompile.resolve({ success: true, errors: [] });

        await waitFor(() => expect(mockEngine.compileShaderPipeline).toHaveBeenCalledTimes(2));
        expect(mockEngine.initialize.mock.calls[1][0]).toBe(mockEngine.initialize.mock.calls[0][0]);
        await waitFor(() => expect(toDataUrlMock).toHaveBeenCalledTimes(2));
        await new Promise(resolve => setTimeout(resolve, 0));
    });

    it('replaces a lost shared WebGL context and retries the thumbnail once', async () => {
        const lostContext = {
            isContextLost: vi.fn(() => true),
            getExtension: vi.fn(() => null),
        } as unknown as WebGL2RenderingContext;
        getContextMock.mockReturnValue(lostContext);
        mockEngine.compileShaderPipeline
            .mockResolvedValueOnce({ success: false, errors: ['Image: Compile timed out after 5000ms'] })
            .mockResolvedValueOnce({ success: true, errors: [] });

        const { container } = render(ShaderPreview, {
            props: { shader: makeShader(), vscodeApi: makeVscodeApi() },
        });

        await waitFor(() => expect(container.querySelector('img')).not.toBeNull());

        expect(mockEngine.compileShaderPipeline).toHaveBeenCalledTimes(2);
        expect(mockEngine.initialize.mock.calls[1][0]).not.toBe(mockEngine.initialize.mock.calls[0][0]);
        await waitFor(() => expect(mockEngine.dispose).toHaveBeenCalledTimes(2));
        await new Promise(resolve => setTimeout(resolve, 0));
    });

    it('refreshes the thumbnail at the final grid card dimensions', async () => {
        const { container, rerender } = render(ShaderPreview, {
            props: {
                shader: makeShader(),
                vscodeApi: makeVscodeApi(),
                width: 320,
                height: 180,
            },
        });

        await waitFor(() => expect(mockEngine.compileShaderPipeline).toHaveBeenCalledOnce());
        const initialCanvas = container.querySelector('canvas');

        await rerender({ width: 640, height: 360 });
        await new Promise(resolve => setTimeout(resolve, 550));

        expect(mockEngine.compileShaderPipeline).toHaveBeenCalledTimes(2);
        await waitFor(() => expect(toDataUrlMock).toHaveBeenCalledTimes(2));
        expect(mockEngine.initialize.mock.calls[0][0]).not.toBe(initialCanvas);
        expect(mockEngine.initialize.mock.calls[1][0]).toBe(mockEngine.initialize.mock.calls[0][0]);
        expect(mockEngine.initialize.mock.calls[1][1]).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 0));
    });

    it('coalesces repeated dimension changes into one refresh', async () => {
        const { rerender } = render(ShaderPreview, {
            props: {
                shader: makeShader(),
                vscodeApi: makeVscodeApi(),
                width: 320,
                height: 180,
            },
        });

        await waitFor(() => expect(mockEngine.compileShaderPipeline).toHaveBeenCalledOnce());

        await rerender({ width: 96, height: 54 });
        await rerender({ width: 640, height: 360 });
        await new Promise(resolve => setTimeout(resolve, 550));

        expect(mockEngine.compileShaderPipeline).toHaveBeenCalledTimes(2);
        await waitFor(() => expect(toDataUrlMock).toHaveBeenCalledTimes(2));
        await new Promise(resolve => setTimeout(resolve, 0));
    });

    it('keeps the last successful thumbnail visible when its resize refresh fails', async () => {
        const onCompilationFailed = vi.fn();
        const { container, rerender } = render(ShaderPreview, {
            props: {
                shader: makeShader(),
                vscodeApi: makeVscodeApi(),
                width: 320,
                height: 180,
                onCompilationFailed,
            },
        });

        await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
        mockEngine.compileShaderPipeline.mockResolvedValue({ success: false, errors: ['resize error'] });

        await rerender({ width: 640, height: 360 });
        await new Promise(resolve => setTimeout(resolve, 550));

        expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,rendered');
        expect(container.querySelector('.shader-error')).toBeNull();
        expect(onCompilationFailed).not.toHaveBeenCalled();
        await waitFor(() => expect(mockEngine.dispose).toHaveBeenCalledTimes(2));
        await new Promise(resolve => setTimeout(resolve, 0));
    });
});

describe('ShaderPreview - hover visibility', () => {
    it('reuses one GLSL hover canvas across shader cards', async () => {
        const first = render(ShaderPreview, {
            props: {
                shader: makeShader({ path: '/test/first.glsl', cachedThumbnail: 'data:image/png;base64,first' }),
                vscodeApi: makeVscodeApi(),
            },
        });
        const second = render(ShaderPreview, {
            props: {
                shader: makeShader({ path: '/test/second.glsl', cachedThumbnail: 'data:image/png;base64,second' }),
                vscodeApi: makeVscodeApi(),
            },
        });

        const firstContainer = first.container.querySelector('.shader-preview-container')!;
        await fireEvent.mouseEnter(firstContainer);
        await waitFor(() => expect(first.container.querySelector('.hover-canvas')).not.toBeNull());
        const firstHoverCanvas = first.container.querySelector('.hover-canvas');
        await fireEvent.mouseLeave(firstContainer);

        await fireEvent.mouseEnter(second.container.querySelector('.shader-preview-container')!);
        await waitFor(() => expect(second.container.querySelector('.hover-canvas')).not.toBeNull());

        expect(second.container.querySelector('.hover-canvas')).toBe(firstHoverCanvas);
    });

    it('hover wrapper not visible before mouseenter', async () => {
        const { container } = render(ShaderPreview, {
            props: { shader: makeShader({ cachedThumbnail: 'data:image/png;base64,abc' }), vscodeApi: makeVscodeApi(), width: 320, height: 180 },
        });
        await tick();

        expect(container.querySelector('.hover-canvas-wrapper')?.classList.contains('visible')).toBe(false);
    });

    it('hover wrapper becomes visible after successful render', async () => {
        const { container } = render(ShaderPreview, {
            props: { shader: makeShader({ cachedThumbnail: 'data:image/png;base64,abc' }), vscodeApi: makeVscodeApi(), width: 320, height: 180 },
        });
        await tick();

        await fireEvent.mouseEnter(container.querySelector('.shader-preview-container')!);

        await waitFor(() => {
            expect(container.querySelector('.hover-canvas-wrapper')?.classList.contains('visible')).toBe(true);
        });
    });

    it('does not let the hover canvas capture scroll, keyboard, or mouse input', async () => {
        const { container } = render(ShaderPreview, {
            props: {
                shader: makeShader({ cachedThumbnail: 'data:image/png;base64,abc' }),
                vscodeApi: makeVscodeApi(),
            },
        });

        await fireEvent.mouseEnter(container.querySelector('.shader-preview-container')!);
        const hoverCanvas = await waitFor(() => {
            const element = container.querySelector('.hover-canvas');
            expect(element).not.toBeNull();
            return element as HTMLCanvasElement;
        });

        expect(getComputedStyle(hoverCanvas).pointerEvents).toBe('none');
        expect(hoverCanvas.tabIndex).toBe(-1);
        expect(mockEngine.setInputEnabled).toHaveBeenCalledWith(false);
    });

    it('hover wrapper hidden after mouseleave', async () => {
        const { container } = render(ShaderPreview, {
            props: { shader: makeShader({ cachedThumbnail: 'data:image/png;base64,abc' }), vscodeApi: makeVscodeApi(), width: 320, height: 180 },
        });
        await tick();

        const previewContainer = container.querySelector('.shader-preview-container')!;
        await fireEvent.mouseEnter(previewContainer);
        await waitFor(() => expect(container.querySelector('.hover-canvas-wrapper')?.classList.contains('visible')).toBe(true));

        await fireEvent.mouseLeave(previewContainer);

        expect(container.querySelector('.hover-canvas-wrapper')?.classList.contains('visible')).toBe(false);
    });

    it('hover wrapper stays hidden when shader compilation fails', async () => {
        mockEngine.compileShaderPipeline.mockResolvedValue({ success: false, errors: ['compile error'] });

        const { container } = render(ShaderPreview, {
            props: { shader: makeShader({ cachedThumbnail: 'data:image/png;base64,abc' }), vscodeApi: makeVscodeApi(), width: 320, height: 180 },
        });
        await tick();

        await fireEvent.mouseEnter(container.querySelector('.shader-preview-container')!);
        await new Promise(r => setTimeout(r, 50));

        expect(container.querySelector('.hover-canvas-wrapper')?.classList.contains('visible')).toBe(false);
    });
});

describe('ShaderPreview - renderer selection and cleanup', () => {
    it('selects the GLSL engine and reuses the thumbnail WebGL context', async () => {
        const loseContext = vi.fn();
        const getExtension = vi.fn(() => ({ loseContext }));
        getContextMock.mockReturnValue({ getExtension } as unknown as WebGL2RenderingContext);

        const vscodeApi = makeVscodeApi();
        render(ShaderPreview, {
            props: { shader: makeShader(), vscodeApi },
        });

        await waitFor(() => expect(vscodeApi.postMessage).toHaveBeenCalled());
        await waitFor(() => expect(mockEngine.dispose).toHaveBeenCalled());

        expect(createEngineForLanguage).toHaveBeenCalledWith('glsl');
        expect(mockEngine.setInputEnabled).toHaveBeenCalledWith(false);
        expect(mockEngine.stopRenderLoop).toHaveBeenCalledBefore(mockEngine.dispose);
        expect(getContextMock).toHaveBeenCalledWith('webgl2');
        expect(getExtension).not.toHaveBeenCalled();
        expect(loseContext).not.toHaveBeenCalled();
    });

    it('selects the Slang engine for a Slang thumbnail', async () => {
        const shader = makeShader({ path: '/test/shader.slang', name: 'shader.slang' });
        render(ShaderPreview, {
            props: {
                shader,
                vscodeApi: makeVscodeApi('float4 mainImage(float2 c) { return 1; }', 'slang'),
            },
        });

        await waitFor(() => expect(createEngineForLanguage).toHaveBeenCalledWith('slang'));
        expect(mockEngine.compileShaderPipeline).toHaveBeenCalledWith(
            expect.stringContaining('float4 mainImage'),
            null,
            '/test/shader.slang',
            {},
            undefined,
            undefined,
            undefined,
        );
    });

    it('passes imported Slang modules to the preview compiler', async () => {
        const shader = makeShader({ path: '/test/image.slang', name: 'image.slang' });
        const vscodeApi = {
            postMessage: vi.fn((msg: { type: string; path: string; requestId: number }) => {
                if (msg.type !== 'requestShaderCode') return;
                setTimeout(() => {
                    window.dispatchEvent(new MessageEvent('message', {
                        data: {
                            type: 'shaderCode', path: msg.path, requestId: msg.requestId,
                            code: 'import substep;\nfloat4 mainImage(float2 c) { return float4(substepValue()); }',
                            previewPath: '/test/workspace.slang',
                            config: null, buffers: {}, language: 'slang',
                            slangModules: [{
                                moduleName: 'substep', path: '/test/substep.slang', ownerPass: 'Image',
                                source: 'module substep; public float substepValue() { return 1.0; }',
                            }],
                        },
                    }));
                }, 0);
            }),
        };

        render(ShaderPreview, { props: { shader, vscodeApi } });

        await waitFor(() => expect(mockEngine.compileShaderPipeline).toHaveBeenCalledWith(
            expect.stringContaining('import substep'), null, '/test/workspace.slang', {}, undefined, undefined,
            [{
                moduleName: 'substep', path: '/test/substep.slang', ownerPass: 'Image',
                source: 'module substep; public float substepValue() { return 1.0; }',
            }],
        ));
    });

    it('passes custom uniform declarations and type metadata to the selected engine', async () => {
        const vscodeApi = {
            postMessage: vi.fn((msg: { type: string; path: string; requestId: number }) => {
                if (msg.type !== 'requestShaderCode') return;
                setTimeout(() => {
                    window.dispatchEvent(new MessageEvent('message', {
                        data: {
                            type: 'shaderCode',
                            path: msg.path,
                            requestId: msg.requestId,
                            code: 'void mainImage(out vec4 color, vec2 coord) { color = vec4(uFloat); }',
                            config: { script: './uniforms.ts' },
                            buffers: {},
                            language: 'glsl',
                            customUniformDeclarations: 'uniform float uFloat;',
                            customUniformInfo: [{ name: 'uFloat', type: 'float' }],
                        },
                    }));
                }, 0);
            }),
        };

        render(ShaderPreview, {
            props: { shader: makeShader(), vscodeApi },
        });

        await waitFor(() => expect(mockEngine.compileShaderPipeline).toHaveBeenCalledWith(
            expect.stringContaining('uFloat'),
            { script: './uniforms.ts' },
            '/test/shader.glsl',
            {},
            'uniform float uFloat;',
            [{ name: 'uFloat', type: 'float' }],
            undefined,
        ));
    });

    it('passes custom uniform metadata to the Slang engine', async () => {
        const shader = makeShader({ path: '/test/shader.slang', name: 'shader.slang' });
        const vscodeApi = {
            postMessage: vi.fn((msg: { type: string; path: string; requestId: number }) => {
                if (msg.type !== 'requestShaderCode') return;
                setTimeout(() => {
                    window.dispatchEvent(new MessageEvent('message', {
                        data: {
                            type: 'shaderCode',
                            path: msg.path,
                            requestId: msg.requestId,
                            code: 'float4 mainImage(float2 coord) { return uColor; }',
                            config: { script: './uniforms.ts' },
                            buffers: {},
                            language: 'slang',
                            customUniformDeclarations: 'uniform vec4 uColor;',
                            customUniformInfo: [{ name: 'uColor', type: 'vec4' }],
                        },
                    }));
                }, 0);
            }),
        };

        render(ShaderPreview, { props: { shader, vscodeApi } });

        await waitFor(() => expect(mockEngine.compileShaderPipeline).toHaveBeenCalledWith(
            expect.stringContaining('uColor'),
            { script: './uniforms.ts' },
            '/test/shader.slang',
            {},
            'uniform vec4 uColor;',
            [{ name: 'uColor', type: 'vec4' }],
            undefined,
        ));
        expect(createEngineForLanguage).toHaveBeenCalledWith('slang');
    });

    it('selects the Slang engine again for a cached thumbnail hover preview', async () => {
        const shader = makeShader({
            path: '/test/shader.slang',
            name: 'shader.slang',
            cachedThumbnail: 'data:image/png;base64,abc',
        });
        const { container } = render(ShaderPreview, {
            props: {
                shader,
                vscodeApi: makeVscodeApi('float4 mainImage(float2 c) { return 1; }', 'slang'),
            },
        });

        await fireEvent.mouseEnter(container.querySelector('.shader-preview-container')!);

        await waitFor(() => expect(createEngineForLanguage).toHaveBeenCalledWith('slang'));
        expect(mockEngine.startRenderLoop).toHaveBeenCalledOnce();
    });

    it('does not request a WebGL context while cleaning up a Slang engine', async () => {
        mockEngine.getShaderLanguage.mockReturnValue('slang');
        const shader = makeShader({ path: '/test/shader.slang', name: 'shader.slang' });
        render(ShaderPreview, {
            props: {
                shader,
                vscodeApi: makeVscodeApi('float4 mainImage(float2 c) { return 1; }', 'slang'),
            },
        });

        await waitFor(() => expect(mockEngine.dispose).toHaveBeenCalled());

        expect(mockEngine.getShaderLanguage).toHaveBeenCalledBefore(mockEngine.dispose);
        expect(mockEngine.stopRenderLoop).toHaveBeenCalledBefore(mockEngine.dispose);
        expect(getContextMock).not.toHaveBeenCalledWith('webgl2');
    });

    it('cleans up the selected engine when thumbnail compilation fails', async () => {
        mockEngine.compileShaderPipeline.mockResolvedValue({ success: false, errors: ['compile error'] });
        const onCompilationFailed = vi.fn();

        const { container } = render(ShaderPreview, {
            props: {
                shader: makeShader(),
                vscodeApi: makeVscodeApi(),
                onCompilationFailed,
            },
        });

        await waitFor(() => expect(container.querySelector('.shader-error')).not.toBeNull());
        expect(mockEngine.stopRenderLoop).toHaveBeenCalledOnce();
        expect(mockEngine.dispose).toHaveBeenCalledOnce();
        expect(onCompilationFailed).toHaveBeenCalledOnce();
    });

    it('shows a compilation failure when the engine factory rejects missing metadata', async () => {
        createEngineForLanguage.mockImplementation(() => {
            throw new Error('Missing Slang asset metadata for wasm');
        });
        const onCompilationFailed = vi.fn();
        const shader = makeShader({ path: '/test/shader.slang', name: 'shader.slang' });

        const { container } = render(ShaderPreview, {
            props: {
                shader,
                vscodeApi: makeVscodeApi('float4 mainImage(float2 c) { return 1; }', 'slang'),
                onCompilationFailed,
            },
        });

        await waitFor(() => expect(container.querySelector('.shader-error')).not.toBeNull());
        expect(createEngineForLanguage).toHaveBeenCalledWith('slang');
        expect(mockEngine.compileShaderPipeline).not.toHaveBeenCalled();
        expect(mockEngine.dispose).not.toHaveBeenCalled();
        expect(onCompilationFailed).toHaveBeenCalledOnce();
    });
});

describe('ShaderPreview - asynchronous renderer ownership', () => {
    it('cancels a cached hover before its delayed shader response arrives', async () => {
        const shader = makeShader({
            path: '/test/shader.slang',
            name: 'shader.slang',
            cachedThumbnail: 'data:image/png;base64,abc',
        });
        const vscodeApi = { postMessage: vi.fn() };
        const { container } = render(ShaderPreview, { props: { shader, vscodeApi } });
        const preview = container.querySelector('.shader-preview-container')!;

        await fireEvent.mouseEnter(preview);
        await waitFor(() => expect(vscodeApi.postMessage).toHaveBeenCalledWith({
            type: 'requestShaderCode',
            path: shader.path,
            requestId: expect.any(Number),
        }));
        await fireEvent.mouseLeave(preview);

        window.dispatchEvent(new MessageEvent('message', {
            data: {
                type: 'shaderCode',
                path: shader.path,
                requestId: vscodeApi.postMessage.mock.calls[0][0].requestId,
                code: 'float4 mainImage(float2 c) { return 1; }',
                config: null,
                buffers: {},
                language: 'slang',
            },
        }));
        await new Promise(resolve => setTimeout(resolve, 20));
        await tick();

        expect(createEngineForLanguage).not.toHaveBeenCalled();
        expect(container.querySelector('.hover-canvas-wrapper')?.childElementCount).toBe(0);
    });

    it('disposes a hover engine when mouseleave occurs during compilation', async () => {
        const compilation = deferred<{ success: boolean; errors: string[] }>();
        mockEngine.getShaderLanguage.mockReturnValue('slang');
        mockEngine.compileShaderPipeline.mockReturnValue(compilation.promise);
        const shader = makeShader({
            path: '/test/shader.slang',
            name: 'shader.slang',
            cachedThumbnail: 'data:image/png;base64,abc',
        });
        const { container } = render(ShaderPreview, {
            props: {
                shader,
                vscodeApi: makeVscodeApi('float4 mainImage(float2 c) { return 1; }', 'slang'),
            },
        });
        const preview = container.querySelector('.shader-preview-container')!;

        await fireEvent.mouseEnter(preview);
        await waitFor(() => expect(mockEngine.compileShaderPipeline).toHaveBeenCalledOnce());
        await fireEvent.mouseLeave(preview);

        expect(mockEngine.dispose).toHaveBeenCalledOnce();
        expect(mockEngine.startRenderLoop).not.toHaveBeenCalled();

        compilation.resolve({ success: true, errors: [] });

        await new Promise(resolve => setTimeout(resolve, 20));
        expect(mockEngine.dispose).toHaveBeenCalledOnce();
        expect(mockEngine.startRenderLoop).not.toHaveBeenCalled();
        expect(getContextMock).not.toHaveBeenCalledWith('webgl2');
        expect(container.querySelector('.hover-canvas-wrapper')?.childElementCount).toBe(0);
    });

    it('disposes the engine when initialization throws', async () => {
        mockEngine.initialize.mockImplementation(() => {
            throw new Error('initialization failed');
        });
        mockEngine.stopRenderLoop.mockImplementation(() => {
            throw new Error('renderer was not fully initialized');
        });
        const onCompilationFailed = vi.fn();

        const { container } = render(ShaderPreview, {
            props: { shader: makeShader(), vscodeApi: makeVscodeApi(), onCompilationFailed },
        });

        await waitFor(() => expect(container.querySelector('.shader-error')).not.toBeNull());
        expect(mockEngine.compileShaderPipeline).not.toHaveBeenCalled();
        expect(mockEngine.dispose).toHaveBeenCalledOnce();
        expect(onCompilationFailed).toHaveBeenCalledOnce();
    });

    it('disposes the engine when compilation rejects', async () => {
        mockEngine.compileShaderPipeline.mockRejectedValue(new Error('compilation rejected'));
        const onCompilationFailed = vi.fn();

        const { container } = render(ShaderPreview, {
            props: { shader: makeShader(), vscodeApi: makeVscodeApi(), onCompilationFailed },
        });

        await waitFor(() => expect(container.querySelector('.shader-error')).not.toBeNull());
        expect(mockEngine.dispose).toHaveBeenCalledOnce();
        expect(onCompilationFailed).toHaveBeenCalledOnce();
    });

    it('disposes the engine when capture rendering throws', async () => {
        mockEngine.renderForCapture.mockImplementation(() => {
            throw new Error('render failed');
        });
        const onCompilationFailed = vi.fn();

        const { container } = render(ShaderPreview, {
            props: { shader: makeShader(), vscodeApi: makeVscodeApi(), onCompilationFailed },
        });

        await waitFor(() => expect(container.querySelector('.shader-error')).not.toBeNull());
        expect(toDataUrlMock).not.toHaveBeenCalled();
        expect(mockEngine.dispose).toHaveBeenCalledOnce();
        expect(onCompilationFailed).toHaveBeenCalledOnce();
    });

    it('disposes the hover engine when starting its render loop throws', async () => {
        mockEngine.startRenderLoop.mockImplementation(() => {
            throw new Error('render loop failed');
        });
        const shader = makeShader({ cachedThumbnail: 'data:image/png;base64,abc' });
        const { container } = render(ShaderPreview, {
            props: { shader, vscodeApi: makeVscodeApi() },
        });

        await fireEvent.mouseEnter(container.querySelector('.shader-preview-container')!);

        await waitFor(() => expect(mockEngine.dispose).toHaveBeenCalledOnce());
        expect(container.querySelector('.hover-canvas-wrapper')?.classList.contains('visible')).toBe(false);
        expect(container.querySelector('.hover-canvas-wrapper')?.childElementCount).toBe(0);
    });

    it('disposes an in-flight thumbnail without capture or save after unmount', async () => {
        const compilation = deferred<{ success: boolean; errors: string[] }>();
        mockEngine.getShaderLanguage.mockReturnValue('slang');
        mockEngine.compileShaderPipeline.mockReturnValue(compilation.promise);
        const shader = makeShader({ path: '/test/shader.slang', name: 'shader.slang' });
        const vscodeApi = makeVscodeApi('float4 mainImage(float2 c) { return 1; }', 'slang');
        const onCompilationFailed = vi.fn();
        const { unmount } = render(ShaderPreview, {
            props: { shader, vscodeApi, onCompilationFailed },
        });

        await waitFor(() => expect(mockEngine.compileShaderPipeline).toHaveBeenCalledOnce());
        unmount();

        expect(mockEngine.dispose).toHaveBeenCalledOnce();

        compilation.resolve({ success: true, errors: [] });

        await new Promise(resolve => setTimeout(resolve, 20));
        expect(mockEngine.dispose).toHaveBeenCalledOnce();
        expect(toDataUrlMock).not.toHaveBeenCalled();
        expect(vscodeApi.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'saveThumbnail' }));
        expect(onCompilationFailed).not.toHaveBeenCalled();
        expect(getContextMock).not.toHaveBeenCalledWith('webgl2');
    });
});

describe('ShaderPreview - thumbnail capture presentation', () => {
    it('renders for capture immediately before reading pixels and then cleans up', async () => {
        render(ShaderPreview, {
            props: { shader: makeShader(), vscodeApi: makeVscodeApi() },
        });

        await waitFor(() => expect(mockEngine.dispose).toHaveBeenCalledOnce());

        expect(mockEngine.render).not.toHaveBeenCalled();
        expect(mockEngine.renderForCapture).toHaveBeenCalledOnce();
        expect(mockEngine.renderForCapture).toHaveBeenCalledBefore(toDataUrlMock);
        expect(toDataUrlMock).toHaveBeenCalledBefore(mockEngine.dispose);
    });

    it('renders a Slang presentation immediately before reading its thumbnail pixels', async () => {
        mockEngine.getShaderLanguage.mockReturnValue('slang');
        const shader = makeShader({ path: '/test/shader.slang', name: 'shader.slang' });
        render(ShaderPreview, {
            props: {
                shader,
                vscodeApi: makeVscodeApi('float4 mainImage(float2 c) { return 1; }', 'slang'),
            },
        });

        await waitFor(() => expect(mockEngine.dispose).toHaveBeenCalledOnce());

        expect(createEngineForLanguage).toHaveBeenCalledWith('slang');
        expect(mockEngine.render).not.toHaveBeenCalled();
        expect(mockEngine.renderForCapture).toHaveBeenCalledBefore(toDataUrlMock);
        expect(toDataUrlMock).toHaveBeenCalledBefore(mockEngine.dispose);
        expect(getContextMock).not.toHaveBeenCalledWith('webgl2');
    });

});

describe('ShaderPreview - refreshAll', () => {
    it('shows cached thumbnail as fallback then renders fresh when refreshAll is true', async () => {
        const shader = makeShader({ cachedThumbnail: 'data:image/png;base64,stale' });
        const vscodeApi = makeVscodeApi();

        const { container } = render(ShaderPreview, {
            props: { shader, vscodeApi, width: 320, height: 180, refreshAll: true },
        });

        // Cached thumbnail shown as fallback while fresh render loads
        expect(container.querySelector('img')).not.toBeNull();
        expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,stale');

        // Also renders fresh
        await waitFor(() => expect(mockEngine.compileShaderPipeline).toHaveBeenCalledOnce());
        await waitFor(() => expect(toDataUrlMock).toHaveBeenCalled());

        expect(vscodeApi.postMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: 'saveThumbnail',
        }));
    });
});

describe('ShaderPreview - forceFresh', () => {
    it('shows cached thumbnail as fallback then renders fresh when forceFresh is true', async () => {
        const shader = makeShader({ cachedThumbnail: 'data:image/png;base64,stale' });
        const vscodeApi = makeVscodeApi();

        const { container } = render(ShaderPreview, {
            props: { shader, vscodeApi, width: 320, height: 180, forceFresh: true },
        });

        // Cached thumbnail shown as fallback while fresh render loads
        expect(container.querySelector('img')).not.toBeNull();
        expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,stale');

        // Also renders fresh in the background
        await waitFor(() => expect(mockEngine.compileShaderPipeline).toHaveBeenCalledOnce());
        await waitFor(() => expect(toDataUrlMock).toHaveBeenCalled());

        expect(vscodeApi.postMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: 'saveThumbnail',
        }));
    });
});
