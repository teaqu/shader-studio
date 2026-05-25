import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ShaderPreview from './ShaderPreview.svelte';
import type { ShaderFile } from '../types/ShaderFile';

const mockEngine = {
    initialize: vi.fn(),
    compileShaderPipeline: vi.fn(),
    render: vi.fn(),
    startRenderLoop: vi.fn(),
    stopRenderLoop: vi.fn(),
    dispose: vi.fn(),
};

vi.mock('@shader-studio/rendering', () => ({
    RenderingEngine: vi.fn(() => mockEngine),
}));

// jsdom has no WebGL — stub getContext so cleanupRenderer doesn't warn
HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as any;

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
function makeVscodeApi(code = 'void mainImage(out vec4 o,vec2 u){o=vec4(1);}') {
    return {
        postMessage: vi.fn((msg: any) => {
            if (msg.type === 'requestShaderCode') {
                setTimeout(() => {
                    window.dispatchEvent(new MessageEvent('message', {
                        data: { type: 'shaderCode', path: msg.path, code, config: null, buffers: {} },
                    }));
                }, 0);
            }
        }),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mockEngine.compileShaderPipeline.mockResolvedValue({ success: true, errors: [] });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        cb(0);
        return 0;
    });
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
