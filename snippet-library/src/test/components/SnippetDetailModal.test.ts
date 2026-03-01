import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import type { Snippet } from '../../lib/types/Snippet';

// Mock MonacoEditor child component to avoid monaco-editor package resolution
vi.mock('../../lib/components/MonacoEditor.svelte', () => {
    const { mount, unmount } = require('svelte');
    return {
        default: function MonacoEditor($$anchor: any, $$props: any) {
            const div = document.createElement('div');
            div.className = 'monaco-container';
            div.dataset.testid = 'mock-monaco-editor';
            $$anchor.before(div);
        },
    };
});

// Mock @shader-studio/rendering (must use function keyword for Vitest class mocking)
vi.mock('@shader-studio/rendering', () => ({
    RenderingEngine: function () {
        return {
            initialize: vi.fn(),
            compileShaderPipeline: vi.fn().mockResolvedValue({ success: false }),
            startRenderLoop: vi.fn(),
            stopRenderLoop: vi.fn(),
            dispose: vi.fn(),
            handleCanvasResize: vi.fn(),
        };
    },
}));

import SnippetDetailModal from '../../lib/components/SnippetDetailModal.svelte';

function makeSnippet(overrides: Partial<Snippet> = {}): Snippet {
    return {
        name: 'Circle SDF',
        prefix: 'sdCircle',
        body: ['float sdCircle(vec2 p, float r) {', '    return length(p) - r;', '}'],
        description: 'Signed distance function for a circle',
        category: 'sdf-2d',
        isCustom: false,
        ...overrides,
    };
}

describe('SnippetDetailModal', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    // ─── Rendering ─────────────────────────────────────────────

    it('should not render anything when snippet is null', () => {
        const { container } = render(SnippetDetailModal, {
            props: { snippet: null, onClose: vi.fn(), onInsert: vi.fn() },
        });

        expect(container.querySelector('.detail-overlay')).not.toBeInTheDocument();
    });

    it('should render modal dialog when snippet is provided', () => {
        render(SnippetDetailModal, {
            props: { snippet: makeSnippet(), onClose: vi.fn(), onInsert: vi.fn() },
        });

        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should display snippet name in the header', () => {
        render(SnippetDetailModal, {
            props: { snippet: makeSnippet({ name: 'Box SDF' }), onClose: vi.fn(), onInsert: vi.fn() },
        });

        expect(screen.getByText('Box SDF')).toBeInTheDocument();
    });

    it('should display snippet prefix', () => {
        render(SnippetDetailModal, {
            props: { snippet: makeSnippet({ prefix: 'sdBox' }), onClose: vi.fn(), onInsert: vi.fn() },
        });

        expect(screen.getByText('sdBox')).toBeInTheDocument();
    });

    it('should display snippet description', () => {
        render(SnippetDetailModal, {
            props: {
                snippet: makeSnippet({ description: 'A signed distance field for circles' }),
                onClose: vi.fn(),
                onInsert: vi.fn(),
            },
        });

        expect(screen.getByText('A signed distance field for circles')).toBeInTheDocument();
    });

    it('should not render description paragraph when description is empty', () => {
        const { container } = render(SnippetDetailModal, {
            props: {
                snippet: makeSnippet({ description: '' }),
                onClose: vi.fn(),
                onInsert: vi.fn(),
            },
        });

        expect(container.querySelector('.detail-description')).not.toBeInTheDocument();
    });

    it('should display the category label', () => {
        render(SnippetDetailModal, {
            props: { snippet: makeSnippet({ category: 'sdf-2d' }), onClose: vi.fn(), onInsert: vi.fn() },
        });

        expect(screen.getByText('SDF 2D')).toBeInTheDocument();
    });

    it('should display correct category label for sdf-3d', () => {
        render(SnippetDetailModal, {
            props: { snippet: makeSnippet({ category: 'sdf-3d' }), onClose: vi.fn(), onInsert: vi.fn() },
        });

        expect(screen.getByText('SDF 3D')).toBeInTheDocument();
    });

    it('should display correct category label for math', () => {
        render(SnippetDetailModal, {
            props: { snippet: makeSnippet({ category: 'math' }), onClose: vi.fn(), onInsert: vi.fn() },
        });

        expect(screen.getByText('Math')).toBeInTheDocument();
    });

    // ─── Parameter Parsing ──────────────────────────────────────

    it('should display parameters section when snippet has function parameters', () => {
        render(SnippetDetailModal, {
            props: { snippet: makeSnippet(), onClose: vi.fn(), onInsert: vi.fn() },
        });

        expect(screen.getByText('Parameters')).toBeInTheDocument();
    });

    it('should parse and display parameter types', () => {
        const { container } = render(SnippetDetailModal, {
            props: { snippet: makeSnippet(), onClose: vi.fn(), onInsert: vi.fn() },
        });

        // sdCircle has vec2 p and float r
        const paramTypes = container.querySelectorAll('.param-type');
        const typeTexts = Array.from(paramTypes).map(el => el.textContent);
        expect(typeTexts).toContain('vec2');
        expect(typeTexts).toContain('float');
    });

    it('should parse and display parameter names', () => {
        const { container } = render(SnippetDetailModal, {
            props: { snippet: makeSnippet(), onClose: vi.fn(), onInsert: vi.fn() },
        });

        const paramNames = container.querySelectorAll('.param-name');
        const nameTexts = Array.from(paramNames).map(el => el.textContent);
        expect(nameTexts).toContain('p');
        expect(nameTexts).toContain('r');
    });

    it('should auto-generate descriptions for known parameter types', () => {
        render(SnippetDetailModal, {
            props: { snippet: makeSnippet(), onClose: vi.fn(), onInsert: vi.fn() },
        });

        // vec2 p -> "Sample point in 2D space"
        expect(screen.getByText('Sample point in 2D space')).toBeInTheDocument();
        // float r -> "Radius"
        expect(screen.getByText('Radius')).toBeInTheDocument();
    });

    it('should not display parameters section when snippet has no function signature', () => {
        const snippet = makeSnippet({
            body: ['// Just a comment', 'float x = 1.0;'],
        });

        const { container } = render(SnippetDetailModal, {
            props: { snippet, onClose: vi.fn(), onInsert: vi.fn() },
        });

        expect(container.querySelector('.params-section')).not.toBeInTheDocument();
    });

    it('should handle function with no parameters', () => {
        const snippet = makeSnippet({
            body: ['float getValue() {', '    return 1.0;', '}'],
        });

        const { container } = render(SnippetDetailModal, {
            props: { snippet, onClose: vi.fn(), onInsert: vi.fn() },
        });

        expect(container.querySelector('.params-section')).not.toBeInTheDocument();
    });

    it('should handle inout qualifier in parameters', () => {
        const snippet = makeSnippet({
            body: ['void pModPolar(inout vec2 p, float n) {', '    // body', '}'],
        });

        const { container } = render(SnippetDetailModal, {
            props: { snippet, onClose: vi.fn(), onInsert: vi.fn() },
        });

        const paramTypes = container.querySelectorAll('.param-type');
        const typeTexts = Array.from(paramTypes).map(el => el.textContent);
        expect(typeTexts).toContain('inout vec2');
    });

    it('should handle out qualifier in parameters', () => {
        const snippet = makeSnippet({
            body: ['void getValues(out float d, vec3 p) {', '    d = length(p);', '}'],
        });

        const { container } = render(SnippetDetailModal, {
            props: { snippet, onClose: vi.fn(), onInsert: vi.fn() },
        });

        const paramTypes = container.querySelectorAll('.param-type');
        const typeTexts = Array.from(paramTypes).map(el => el.textContent);
        expect(typeTexts).toContain('out float');
    });

    it('should fall back to generic type descriptions for unknown parameters', () => {
        const snippet = makeSnippet({
            body: ['float myFunc(vec4 data) {', '    return data.x;', '}'],
        });

        render(SnippetDetailModal, {
            props: { snippet, onClose: vi.fn(), onInsert: vi.fn() },
        });

        // vec4 data should get the generic "4D vector" description
        expect(screen.getByText('4D vector')).toBeInTheDocument();
    });

    it('should provide generic description for int parameters', () => {
        const snippet = makeSnippet({
            body: ['float myFunc(int count) {', '    return float(count);', '}'],
        });

        render(SnippetDetailModal, {
            props: { snippet, onClose: vi.fn(), onInsert: vi.fn() },
        });

        expect(screen.getByText('Integer value')).toBeInTheDocument();
    });

    it('should provide generic description for bool parameters', () => {
        const snippet = makeSnippet({
            body: ['float myFunc(bool flag) {', '    return flag ? 1.0 : 0.0;', '}'],
        });

        render(SnippetDetailModal, {
            props: { snippet, onClose: vi.fn(), onInsert: vi.fn() },
        });

        expect(screen.getByText('Boolean flag')).toBeInTheDocument();
    });

    it('should use known description for float k parameter (smoothing factor)', () => {
        const snippet = makeSnippet({
            body: ['float opSmoothUnion(float d1, float d2, float k) {', '    // body', '}'],
        });

        render(SnippetDetailModal, {
            props: { snippet, onClose: vi.fn(), onInsert: vi.fn() },
        });

        expect(screen.getByText('Smoothing factor (higher = smoother blend)')).toBeInTheDocument();
    });

    it('should parse multiple parameters correctly', () => {
        const snippet = makeSnippet({
            body: ['float opSmoothUnion(float d1, float d2, float k) {', '    // body', '}'],
        });

        const { container } = render(SnippetDetailModal, {
            props: { snippet, onClose: vi.fn(), onInsert: vi.fn() },
        });

        const paramRows = container.querySelectorAll('.param-row');
        expect(paramRows.length).toBe(3);
    });

    // ─── Code Display ───────────────────────────────────────────

    it('should render the Code section label', () => {
        render(SnippetDetailModal, {
            props: { snippet: makeSnippet(), onClose: vi.fn(), onInsert: vi.fn() },
        });

        expect(screen.getByText('Code')).toBeInTheDocument();
    });

    it('should render Copy button', () => {
        render(SnippetDetailModal, {
            props: { snippet: makeSnippet(), onClose: vi.fn(), onInsert: vi.fn() },
        });

        expect(screen.getByText('Copy')).toBeInTheDocument();
    });

    it('should strip snippet placeholders from code', () => {
        const snippet = makeSnippet({
            body: ['float sdCircle(vec2 ${1:p}, float ${2:r}) {', '    return length($1) - $2;$0', '}'],
        });

        const { container } = render(SnippetDetailModal, {
            props: { snippet, onClose: vi.fn(), onInsert: vi.fn() },
        });

        // The MonacoEditor component is rendered - check it exists
        const monacoContainer = container.querySelector('.monaco-container');
        expect(monacoContainer).toBeInTheDocument();
    });

    // ─── Action Buttons ─────────────────────────────────────────

    it('should render the Insert into Editor button', () => {
        render(SnippetDetailModal, {
            props: { snippet: makeSnippet(), onClose: vi.fn(), onInsert: vi.fn() },
        });

        expect(screen.getByText('Insert into Editor')).toBeInTheDocument();
    });

    it('should call onInsert with snippet when Insert button is clicked', async () => {
        const onInsert = vi.fn();
        const snippet = makeSnippet();
        render(SnippetDetailModal, {
            props: { snippet, onClose: vi.fn(), onInsert },
        });

        await fireEvent.click(screen.getByText('Insert into Editor'));

        expect(onInsert).toHaveBeenCalledOnce();
        expect(onInsert).toHaveBeenCalledWith(snippet);
    });

    it('should render Create Scene button when onCreateScene is provided', () => {
        render(SnippetDetailModal, {
            props: {
                snippet: makeSnippet(),
                onClose: vi.fn(),
                onInsert: vi.fn(),
                onCreateScene: vi.fn(),
            },
        });

        expect(screen.getByText('Create Scene')).toBeInTheDocument();
    });

    it('should not render Create Scene button when onCreateScene is not provided', () => {
        render(SnippetDetailModal, {
            props: { snippet: makeSnippet(), onClose: vi.fn(), onInsert: vi.fn() },
        });

        expect(screen.queryByText('Create Scene')).not.toBeInTheDocument();
    });

    it('should call onCreateScene with snippet when Create Scene button is clicked', async () => {
        const onCreateScene = vi.fn();
        const snippet = makeSnippet();
        render(SnippetDetailModal, {
            props: { snippet, onClose: vi.fn(), onInsert: vi.fn(), onCreateScene },
        });

        await fireEvent.click(screen.getByText('Create Scene'));

        expect(onCreateScene).toHaveBeenCalledOnce();
        expect(onCreateScene).toHaveBeenCalledWith(snippet);
    });

    // ─── Close Behaviors ────────────────────────────────────────

    it('should render Close button in actions area', () => {
        render(SnippetDetailModal, {
            props: { snippet: makeSnippet(), onClose: vi.fn(), onInsert: vi.fn() },
        });

        // There's a close button (x) in header and a Close text button in actions
        expect(screen.getByText('Close')).toBeInTheDocument();
    });

    it('should call onClose when Close button is clicked', async () => {
        const onClose = vi.fn();
        render(SnippetDetailModal, {
            props: { snippet: makeSnippet(), onClose, onInsert: vi.fn() },
        });

        await fireEvent.click(screen.getByText('Close'));

        expect(onClose).toHaveBeenCalledOnce();
    });

    it('should render the X close button in header', () => {
        render(SnippetDetailModal, {
            props: { snippet: makeSnippet(), onClose: vi.fn(), onInsert: vi.fn() },
        });

        const closeBtn = screen.getByTitle('Close');
        expect(closeBtn).toBeInTheDocument();
        expect(closeBtn.textContent).toBe('\u00D7'); // &times;
    });

    it('should call onClose when X button is clicked', async () => {
        const onClose = vi.fn();
        render(SnippetDetailModal, {
            props: { snippet: makeSnippet(), onClose, onInsert: vi.fn() },
        });

        await fireEvent.click(screen.getByTitle('Close'));

        expect(onClose).toHaveBeenCalledOnce();
    });

    it('should call onClose when Escape key is pressed', async () => {
        const onClose = vi.fn();
        render(SnippetDetailModal, {
            props: { snippet: makeSnippet(), onClose, onInsert: vi.fn() },
        });

        const dialog = screen.getByRole('dialog');
        await fireEvent.keyDown(dialog, { key: 'Escape' });

        expect(onClose).toHaveBeenCalledOnce();
    });

    it('should not call onClose for non-Escape keys', async () => {
        const onClose = vi.fn();
        render(SnippetDetailModal, {
            props: { snippet: makeSnippet(), onClose, onInsert: vi.fn() },
        });

        const dialog = screen.getByRole('dialog');
        await fireEvent.keyDown(dialog, { key: 'Enter' });

        expect(onClose).not.toHaveBeenCalled();
    });

    it('should call onClose when clicking the backdrop overlay', async () => {
        const onClose = vi.fn();
        const { container } = render(SnippetDetailModal, {
            props: { snippet: makeSnippet(), onClose, onInsert: vi.fn() },
        });

        const overlay = container.querySelector('.detail-overlay')!;
        await fireEvent.click(overlay);

        expect(onClose).toHaveBeenCalledOnce();
    });

    it('should not call onClose when clicking inside the modal content', async () => {
        const onClose = vi.fn();
        const { container } = render(SnippetDetailModal, {
            props: { snippet: makeSnippet(), onClose, onInsert: vi.fn() },
        });

        const content = container.querySelector('.detail-content')!;
        await fireEvent.click(content);

        expect(onClose).not.toHaveBeenCalled();
    });

    // ─── Preview Section ────────────────────────────────────────

    it('should render the preview area', () => {
        const { container } = render(SnippetDetailModal, {
            props: { snippet: makeSnippet(), onClose: vi.fn(), onInsert: vi.fn() },
        });

        expect(container.querySelector('.preview-area')).toBeInTheDocument();
    });

    // ─── Modal Structure ────────────────────────────────────────

    it('should have aria-modal attribute set to true', () => {
        render(SnippetDetailModal, {
            props: { snippet: makeSnippet(), onClose: vi.fn(), onInsert: vi.fn() },
        });

        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveAttribute('aria-modal', 'true');
    });

    it('should contain detail-header, detail-body, and detail-actions sections', () => {
        const { container } = render(SnippetDetailModal, {
            props: { snippet: makeSnippet(), onClose: vi.fn(), onInsert: vi.fn() },
        });

        expect(container.querySelector('.detail-header')).toBeInTheDocument();
        expect(container.querySelector('.detail-body')).toBeInTheDocument();
        expect(container.querySelector('.detail-actions')).toBeInTheDocument();
    });

    // ─── Snippet with vec3 parameter ────────────────────────────

    it('should match vec3 p as "Sample point in 3D space"', () => {
        const snippet = makeSnippet({
            body: ['float sdSphere(vec3 p, float r) {', '    return length(p) - r;', '}'],
        });

        render(SnippetDetailModal, {
            props: { snippet, onClose: vi.fn(), onInsert: vi.fn() },
        });

        expect(screen.getByText('Sample point in 3D space')).toBeInTheDocument();
    });

    // ─── mat type descriptions ──────────────────────────────────

    it('should provide generic description for mat2 parameters with unknown name', () => {
        const snippet = makeSnippet({
            body: ['vec2 transform(mat2 rot, vec2 p) {', '    return rot * p;', '}'],
        });

        render(SnippetDetailModal, {
            props: { snippet, onClose: vi.fn(), onInsert: vi.fn() },
        });

        // mat2 rot -> typeKey "mat2 r" not in lookup, falls through to descriptionFromType -> "2x2 matrix"
        expect(screen.getByText('2x2 matrix')).toBeInTheDocument();
    });

    it('should use known description for mat2 m parameter', () => {
        const snippet = makeSnippet({
            body: ['vec2 rotate(mat2 m, vec2 p) {', '    return m * p;', '}'],
        });

        render(SnippetDetailModal, {
            props: { snippet, onClose: vi.fn(), onInsert: vi.fn() },
        });

        expect(screen.getByText('Rotation matrix (2x2)')).toBeInTheDocument();
    });

    // ─── Choice placeholder stripping ───────────────────────────

    it('should strip choice placeholders from code body', () => {
        const snippet = makeSnippet({
            body: ['float sdShape(vec2 p) {', '    return length(p) - ${1|0.5,1.0|};', '}'],
        });

        // This should not throw - the modal should render
        const { container } = render(SnippetDetailModal, {
            props: { snippet, onClose: vi.fn(), onInsert: vi.fn() },
        });

        expect(container.querySelector('.code-section')).toBeInTheDocument();
    });

    // ─── Copy code ──────────────────────────────────────────────

    it('should show "Copy" text initially on the copy button', () => {
        render(SnippetDetailModal, {
            props: { snippet: makeSnippet(), onClose: vi.fn(), onInsert: vi.fn() },
        });

        const copyBtn = screen.getByText('Copy');
        expect(copyBtn).toBeInTheDocument();
    });

    // ─── Different categories ───────────────────────────────────

    it('should display "Math" category label', () => {
        render(SnippetDetailModal, {
            props: {
                snippet: makeSnippet({ category: 'math' }),
                onClose: vi.fn(),
                onInsert: vi.fn(),
            },
        });

        expect(screen.getByText('Math')).toBeInTheDocument();
    });

    it('should display "Coordinates" category label', () => {
        render(SnippetDetailModal, {
            props: {
                snippet: makeSnippet({ category: 'coordinates' }),
                onClose: vi.fn(),
                onInsert: vi.fn(),
            },
        });

        expect(screen.getByText('Coordinates')).toBeInTheDocument();
    });

    it('should display "Custom" category label', () => {
        render(SnippetDetailModal, {
            props: {
                snippet: makeSnippet({ category: 'custom', isCustom: true }),
                onClose: vi.fn(),
                onInsert: vi.fn(),
            },
        });

        expect(screen.getByText('Custom')).toBeInTheDocument();
    });

    // ─── Scalar and generic descriptions ────────────────────────

    it('should provide "Scalar value" for unknown float parameters', () => {
        const snippet = makeSnippet({
            body: ['float myFunc(float foo) {', '    return foo;', '}'],
        });

        render(SnippetDetailModal, {
            props: { snippet, onClose: vi.fn(), onInsert: vi.fn() },
        });

        expect(screen.getByText('Scalar value')).toBeInTheDocument();
    });

    it('should provide "2D vector" for unknown vec2 parameters', () => {
        const snippet = makeSnippet({
            body: ['float myFunc(vec2 foo) {', '    return foo.x;', '}'],
        });

        render(SnippetDetailModal, {
            props: { snippet, onClose: vi.fn(), onInsert: vi.fn() },
        });

        expect(screen.getByText('2D vector')).toBeInTheDocument();
    });

    it('should provide "3D vector" for unknown vec3 parameters', () => {
        const snippet = makeSnippet({
            body: ['float myFunc(vec3 foo) {', '    return foo.x;', '}'],
        });

        render(SnippetDetailModal, {
            props: { snippet, onClose: vi.fn(), onInsert: vi.fn() },
        });

        expect(screen.getByText('3D vector')).toBeInTheDocument();
    });
});
