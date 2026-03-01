import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import type { Snippet } from '../../lib/types/Snippet';

// Mock @shader-studio/rendering so SnippetPreview doesn't need a real WebGL context
vi.mock('@shader-studio/rendering', () => ({
    RenderingEngine: vi.fn().mockImplementation(() => ({
        initialize: vi.fn(),
        compileShaderPipeline: vi.fn().mockResolvedValue({ success: false }),
        startRenderLoop: vi.fn(),
        stopRenderLoop: vi.fn(),
        dispose: vi.fn(),
        handleCanvasResize: vi.fn(),
    })),
}));

import SnippetCard from '../../lib/components/SnippetCard.svelte';

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

describe('SnippetCard', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('should render snippet name', () => {
        render(SnippetCard, { props: { snippet: makeSnippet() } });

        expect(screen.getByText('Circle SDF')).toBeInTheDocument();
    });

    it('should render snippet prefix', () => {
        render(SnippetCard, { props: { snippet: makeSnippet() } });

        expect(screen.getByText('sdCircle')).toBeInTheDocument();
    });

    it('should render snippet description', () => {
        render(SnippetCard, {
            props: { snippet: makeSnippet({ description: 'A circle distance field' }) },
        });

        expect(screen.getByText('A circle distance field')).toBeInTheDocument();
    });

    it('should not render description element when description is empty', () => {
        const { container } = render(SnippetCard, {
            props: { snippet: makeSnippet({ description: '' }) },
        });

        expect(container.querySelector('.card-description')).not.toBeInTheDocument();
    });

    it('should render the Insert button', () => {
        render(SnippetCard, { props: { snippet: makeSnippet() } });

        expect(screen.getByTitle('Insert snippet')).toBeInTheDocument();
    });

    it('should render the Copy button', () => {
        render(SnippetCard, { props: { snippet: makeSnippet() } });

        expect(screen.getByTitle('Copy code to clipboard')).toBeInTheDocument();
    });

    it('should fire onInsert callback when Insert button is clicked', async () => {
        const onInsert = vi.fn();
        const snippet = makeSnippet();
        render(SnippetCard, { props: { snippet, onInsert } });

        const insertBtn = screen.getByTitle('Insert snippet');
        await fireEvent.click(insertBtn);

        expect(onInsert).toHaveBeenCalledOnce();
        expect(onInsert).toHaveBeenCalledWith(snippet);
    });

    it('should not show Edit and Delete buttons for built-in snippets', () => {
        render(SnippetCard, {
            props: { snippet: makeSnippet({ isCustom: false }) },
        });

        expect(screen.queryByTitle('Edit snippet')).not.toBeInTheDocument();
        expect(screen.queryByTitle('Delete snippet')).not.toBeInTheDocument();
    });

    it('should show Edit and Delete buttons for custom snippets', () => {
        render(SnippetCard, {
            props: { snippet: makeSnippet({ isCustom: true, category: 'custom' }) },
        });

        expect(screen.getByTitle('Edit snippet')).toBeInTheDocument();
        expect(screen.getByTitle('Delete snippet')).toBeInTheDocument();
    });

    it('should fire onEdit callback when Edit button is clicked', async () => {
        const onEdit = vi.fn();
        const snippet = makeSnippet({ isCustom: true, category: 'custom' });
        render(SnippetCard, { props: { snippet, onEdit } });

        const editBtn = screen.getByTitle('Edit snippet');
        await fireEvent.click(editBtn);

        expect(onEdit).toHaveBeenCalledOnce();
        expect(onEdit).toHaveBeenCalledWith(snippet);
    });

    it('should fire onDelete callback when Delete button is clicked', async () => {
        const onDelete = vi.fn();
        const snippet = makeSnippet({ isCustom: true, category: 'custom' });
        render(SnippetCard, { props: { snippet, onDelete } });

        const deleteBtn = screen.getByTitle('Delete snippet');
        await fireEvent.click(deleteBtn);

        expect(onDelete).toHaveBeenCalledOnce();
        expect(onDelete).toHaveBeenCalledWith(snippet);
    });

    it('should render the preview area', () => {
        const { container } = render(SnippetCard, { props: { snippet: makeSnippet() } });

        expect(container.querySelector('.card-preview')).toBeInTheDocument();
    });

    it('should fire onViewDetail when the card is clicked outside of action buttons', async () => {
        const onViewDetail = vi.fn();
        const snippet = makeSnippet();
        const { container } = render(SnippetCard, { props: { snippet, onViewDetail } });

        // Click on the card-info area (not the action buttons)
        const cardName = container.querySelector('.card-name')!;
        await fireEvent.click(cardName);

        expect(onViewDetail).toHaveBeenCalledOnce();
        expect(onViewDetail).toHaveBeenCalledWith(snippet);
    });

    it('should not fire onViewDetail when clicking on Insert button', async () => {
        const onViewDetail = vi.fn();
        const onInsert = vi.fn();
        render(SnippetCard, {
            props: { snippet: makeSnippet(), onViewDetail, onInsert },
        });

        const insertBtn = screen.getByTitle('Insert snippet');
        await fireEvent.click(insertBtn);

        // Insert should fire but viewDetail should not (stopPropagation)
        expect(onInsert).toHaveBeenCalledOnce();
        expect(onViewDetail).not.toHaveBeenCalled();
    });

    it('should have correct name displayed in the title attribute', () => {
        const { container } = render(SnippetCard, {
            props: { snippet: makeSnippet({ name: 'My Special Snippet' }) },
        });

        const nameEl = container.querySelector('.card-name');
        expect(nameEl).toHaveAttribute('title', 'My Special Snippet');
    });

    it('should render card as a button role for accessibility', () => {
        const { container } = render(SnippetCard, {
            props: { snippet: makeSnippet() },
        });

        const card = container.querySelector('.snippet-card');
        expect(card).toHaveAttribute('role', 'button');
        expect(card).toHaveAttribute('tabindex', '0');
    });
});
