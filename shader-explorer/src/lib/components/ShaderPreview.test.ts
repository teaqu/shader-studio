import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ShaderPreview from './ShaderPreview.svelte';
import type { ShaderFile } from '../types/ShaderFile';

const { mockEngine, createEngineForLanguage } = vi.hoisted(() => ({
    mockEngine: {
        initialize: vi.fn(),
        compileShaderPipeline: vi.fn(),
        render: vi.fn(),
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

const makeShader = (overrides: Partial<ShaderFile> = {}): ShaderFile => ({
    path: '/test/shader.glsl',
    name: 'shader.glsl',
    relativePath: 'test/shader.glsl',
    hasConfig: false,
    modifiedTime: 1000,
    createdTime: 900,
    ...overrides,
});

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
                        data: { type: 'shaderCode', path: msg.path, code, config: null, buffers: {}, language },
                    }));
                }, 0);
            }
        }),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    getContextMock.mockReturnValue(null);
    createEngineForLanguage.mockReturnValue(mockEngine);
    mockEngine.compileShaderPipeline.mockResolvedValue({ success: true, errors: [] });
    mockEngine.getShaderLanguage.mockReturnValue('glsl');
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,rendered');
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

    it('canvas has loading-canvas class while thumbnail is rendering', () => {
        const { container } = render(ShaderPreview, {
            props: { shader: makeShader(), vscodeApi: makeVscodeApi(), width: 320, height: 180 },
        });

        expect(container.querySelector('canvas.loading-canvas')).not.toBeNull();
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
});

describe('ShaderPreview - hover visibility', () => {
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
    it('selects the GLSL engine and releases its WebGL context for a thumbnail', async () => {
        const loseContext = vi.fn();
        const getExtension = vi.fn(() => ({ loseContext }));
        getContextMock.mockReturnValue({ getExtension } as unknown as WebGL2RenderingContext);

        render(ShaderPreview, {
            props: { shader: makeShader(), vscodeApi: makeVscodeApi() },
        });

        await waitFor(() => expect(mockEngine.dispose).toHaveBeenCalled());

        expect(createEngineForLanguage).toHaveBeenCalledWith('glsl');
        expect(mockEngine.stopRenderLoop).toHaveBeenCalledBefore(mockEngine.dispose);
        expect(getContextMock).toHaveBeenCalledWith('webgl2');
        expect(getExtension).toHaveBeenCalledWith('WEBGL_lose_context');
        expect(loseContext).toHaveBeenCalledOnce();
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
        );
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
