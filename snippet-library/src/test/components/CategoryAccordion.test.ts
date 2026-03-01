import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import type { Snippet } from '../../lib/types/Snippet';

// Mock @shader-studio/rendering so the SnippetPreview child (inside SnippetCard)
// does not attempt to create a real WebGL context
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

import CategoryAccordion from '../../lib/components/CategoryAccordion.svelte';

function makeSnippet(overrides: Partial<Snippet> = {}): Snippet {
    return {
        name: 'Test Snippet',
        prefix: 'testSnippet',
        body: ['float x = 1.0;'],
        description: 'A test snippet',
        category: 'math',
        isCustom: false,
        ...overrides,
    };
}

function makeSnippets(count: number, overrides: Partial<Snippet> = {}): Snippet[] {
    return Array.from({ length: count }, (_, i) =>
        makeSnippet({
            name: `Snippet ${i + 1}`,
            prefix: `snippet${i + 1}`,
            ...overrides,
        })
    );
}

describe('CategoryAccordion', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('should render the category label', () => {
        render(CategoryAccordion, {
            props: {
                category: 'math',
                label: 'Math',
                snippets: makeSnippets(2),
                isOpen: false,
                onToggle: vi.fn(),
            },
        });

        expect(screen.getByText('Math')).toBeInTheDocument();
    });

    it('should display the snippet count badge', () => {
        render(CategoryAccordion, {
            props: {
                category: 'math',
                label: 'Math',
                snippets: makeSnippets(5),
                isOpen: false,
                onToggle: vi.fn(),
            },
        });

        expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('should fire onToggle when header is clicked', async () => {
        const onToggle = vi.fn();
        render(CategoryAccordion, {
            props: {
                category: 'sdf-2d',
                label: 'SDF 2D',
                snippets: makeSnippets(1),
                isOpen: false,
                onToggle,
            },
        });

        const header = screen.getByRole('button');
        await fireEvent.click(header);

        expect(onToggle).toHaveBeenCalledOnce();
    });

    it('should fire onToggle when Enter key is pressed on the header', async () => {
        const onToggle = vi.fn();
        render(CategoryAccordion, {
            props: {
                category: 'sdf-2d',
                label: 'SDF 2D',
                snippets: makeSnippets(1),
                isOpen: false,
                onToggle,
            },
        });

        const header = screen.getByRole('button');
        await fireEvent.keyDown(header, { key: 'Enter' });

        expect(onToggle).toHaveBeenCalledOnce();
    });

    it('should fire onToggle when Space key is pressed on the header', async () => {
        const onToggle = vi.fn();
        render(CategoryAccordion, {
            props: {
                category: 'sdf-2d',
                label: 'SDF 2D',
                snippets: makeSnippets(1),
                isOpen: false,
                onToggle,
            },
        });

        const header = screen.getByRole('button');
        await fireEvent.keyDown(header, { key: ' ' });

        expect(onToggle).toHaveBeenCalledOnce();
    });

    it('should not render snippet cards when closed', () => {
        const { container } = render(CategoryAccordion, {
            props: {
                category: 'math',
                label: 'Math',
                snippets: makeSnippets(3),
                isOpen: false,
                onToggle: vi.fn(),
            },
        });

        expect(container.querySelector('.accordion-body')).not.toBeInTheDocument();
        expect(container.querySelector('.snippet-grid')).not.toBeInTheDocument();
    });

    it('should render the accordion body and snippet grid when open', () => {
        const { container } = render(CategoryAccordion, {
            props: {
                category: 'math',
                label: 'Math',
                snippets: makeSnippets(3),
                isOpen: true,
                onToggle: vi.fn(),
            },
        });

        expect(container.querySelector('.accordion-body')).toBeInTheDocument();
        expect(container.querySelector('.snippet-grid')).toBeInTheDocument();
    });

    it('should render one snippet card per snippet when open', () => {
        const snippets = makeSnippets(4);
        render(CategoryAccordion, {
            props: {
                category: 'math',
                label: 'Math',
                snippets,
                isOpen: true,
                onToggle: vi.fn(),
            },
        });

        // Each SnippetCard renders its name as visible text
        for (const s of snippets) {
            expect(screen.getByText(s.name)).toBeInTheDocument();
        }
    });

    it('should render an empty grid when open with an empty snippets array', () => {
        const { container } = render(CategoryAccordion, {
            props: {
                category: 'math',
                label: 'Math',
                snippets: [],
                isOpen: true,
                onToggle: vi.fn(),
            },
        });

        const grid = container.querySelector('.snippet-grid');
        expect(grid).toBeInTheDocument();
        // Grid should have no snippet card children
        const cards = grid!.querySelectorAll('.snippet-card');
        expect(cards.length).toBe(0);
    });

    it('should apply the open class to chevron when isOpen is true', () => {
        const { container } = render(CategoryAccordion, {
            props: {
                category: 'math',
                label: 'Math',
                snippets: makeSnippets(1),
                isOpen: true,
                onToggle: vi.fn(),
            },
        });

        const chevron = container.querySelector('.chevron');
        expect(chevron).toHaveClass('open');
    });

    it('should not apply the open class to chevron when isOpen is false', () => {
        const { container } = render(CategoryAccordion, {
            props: {
                category: 'math',
                label: 'Math',
                snippets: makeSnippets(1),
                isOpen: false,
                onToggle: vi.fn(),
            },
        });

        const chevron = container.querySelector('.chevron');
        expect(chevron).not.toHaveClass('open');
    });

    it('should show the Add button for the custom category when onAdd is provided', () => {
        render(CategoryAccordion, {
            props: {
                category: 'custom',
                label: 'Custom',
                snippets: makeSnippets(1, { category: 'custom', isCustom: true }),
                isOpen: false,
                onToggle: vi.fn(),
                onAdd: vi.fn(),
            },
        });

        const addBtn = screen.getByTitle('Add custom snippet');
        expect(addBtn).toBeInTheDocument();
    });

    it('should not show the Add button for non-custom categories', () => {
        const { container } = render(CategoryAccordion, {
            props: {
                category: 'math',
                label: 'Math',
                snippets: makeSnippets(1),
                isOpen: false,
                onToggle: vi.fn(),
                onAdd: vi.fn(),
            },
        });

        expect(container.querySelector('.add-btn')).not.toBeInTheDocument();
    });

    it('should fire onAdd when Add button is clicked without triggering onToggle', async () => {
        const onToggle = vi.fn();
        const onAdd = vi.fn();

        render(CategoryAccordion, {
            props: {
                category: 'custom',
                label: 'Custom',
                snippets: makeSnippets(1, { category: 'custom', isCustom: true }),
                isOpen: false,
                onToggle,
                onAdd,
            },
        });

        const addBtn = screen.getByTitle('Add custom snippet');
        await fireEvent.click(addBtn);

        expect(onAdd).toHaveBeenCalledOnce();
        // stopPropagation should prevent onToggle from firing
        expect(onToggle).not.toHaveBeenCalled();
    });

    it('should show custom path info when category is custom and accordion is open', () => {
        render(CategoryAccordion, {
            props: {
                category: 'custom',
                label: 'Custom',
                snippets: makeSnippets(1, { category: 'custom', isCustom: true }),
                isOpen: true,
                onToggle: vi.fn(),
            },
        });

        expect(screen.getByText('.vscode/glsl-snippets.code-snippets')).toBeInTheDocument();
    });

    it('should not show custom path info for non-custom categories', () => {
        const { container } = render(CategoryAccordion, {
            props: {
                category: 'math',
                label: 'Math',
                snippets: makeSnippets(1),
                isOpen: true,
                onToggle: vi.fn(),
            },
        });

        expect(container.querySelector('.custom-path-info')).not.toBeInTheDocument();
    });

    it('should set the --card-size CSS variable on the snippet grid', () => {
        const { container } = render(CategoryAccordion, {
            props: {
                category: 'math',
                label: 'Math',
                snippets: makeSnippets(1),
                isOpen: true,
                onToggle: vi.fn(),
                cardSize: 350,
            },
        });

        const grid = container.querySelector('.snippet-grid');
        expect(grid).toHaveAttribute('style', expect.stringContaining('--card-size: 350px'));
    });
});
