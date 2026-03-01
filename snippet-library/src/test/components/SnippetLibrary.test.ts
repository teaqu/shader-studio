import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tick } from 'svelte';
import { render, screen, fireEvent } from '@testing-library/svelte';
import type { Snippet, SnippetCategory } from '../../lib/types/Snippet';
import { CATEGORY_ORDER, CATEGORY_LABELS } from '../../lib/types/Snippet';

// ---- Mocks (must be set up before importing the component) ----

const mockPostMessage = vi.fn();
const mockGetState = vi.fn().mockReturnValue(null);
const mockSetState = vi.fn();

const mockVsCodeApi: VsCodeApi = {
    postMessage: mockPostMessage,
    getState: mockGetState,
    setState: mockSetState,
};

// Must assign acquireVsCodeApi to globalThis before importing SnippetLibrary
(globalThis as any).acquireVsCodeApi = vi.fn(() => mockVsCodeApi);

vi.mock('@shader-studio/rendering', () => ({
    RenderingEngine: function RenderingEngine() {
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

vi.mock('@shader-studio/monaco', () => ({
    setupMonacoGlsl: vi.fn(),
}));

// Mock the MonacoEditor Svelte component to avoid resolving 'monaco-editor' package
// which has no main/module/exports in package.json and cannot be resolved by Vite.
vi.mock('../../lib/components/MonacoEditor.svelte', () => ({
    default: function MonacoEditor() {},
}));

import SnippetLibrary from '../../lib/components/SnippetLibrary.svelte';

// ---- Test helpers ----

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

function makeSnippetSet(): Snippet[] {
    return [
        makeSnippet({ name: 'Circle SDF', prefix: 'sdCircle', category: 'sdf-2d', description: 'A circle SDF' }),
        makeSnippet({ name: 'Box SDF', prefix: 'sdBox', category: 'sdf-2d', description: 'A box SDF' }),
        makeSnippet({ name: 'Sphere SDF', prefix: 'sdSphere', category: 'sdf-3d', description: 'A sphere SDF' }),
        makeSnippet({ name: 'Remap', prefix: 'remap', category: 'math', description: 'Remap a value from one range to another' }),
        makeSnippet({ name: 'My Custom', prefix: 'myCustom', category: 'custom', description: 'A custom snippet', isCustom: true }),
    ];
}

function dispatchSnippetsUpdate(snippets: Snippet[], savedState?: any) {
    const data: any = { type: 'snippetsUpdate', snippets };
    if (savedState) {
        data.savedState = savedState;
    }
    window.dispatchEvent(new MessageEvent('message', { data }));
}

// ---- Tests ----

describe('SnippetLibrary', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mockPostMessage.mockClear();
        mockGetState.mockClear();
        mockSetState.mockClear();
        (globalThis as any).acquireVsCodeApi = vi.fn(() => mockVsCodeApi);
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // =====================
    // Initial rendering
    // =====================

    describe('initial rendering', () => {
        it('should render the search input', () => {
            render(SnippetLibrary);
            const searchInput = screen.getByPlaceholderText('Search snippets...');
            expect(searchInput).toBeInTheDocument();
        });

        it('should render the card size slider', () => {
            const { container } = render(SnippetLibrary);
            const slider = container.querySelector('input[type="range"]');
            expect(slider).toBeInTheDocument();
            expect(slider).toHaveAttribute('min', '150');
            expect(slider).toHaveAttribute('max', '500');
        });

        it('should render the Size label', () => {
            render(SnippetLibrary);
            expect(screen.getByText('Size')).toBeInTheDocument();
        });

        it('should render the Add Snippet button', () => {
            render(SnippetLibrary);
            expect(screen.getByText('+ Add Snippet')).toBeInTheDocument();
        });

        it('should show "No snippets found" when there are no snippets and no search', async () => {
            render(SnippetLibrary);
            await tick();
            expect(screen.getByText('No snippets found')).toBeInTheDocument();
        });
    });

    // =====================
    // VS Code messaging
    // =====================

    describe('VS Code messaging', () => {
        it('should call acquireVsCodeApi on mount', () => {
            render(SnippetLibrary);
            expect((globalThis as any).acquireVsCodeApi).toHaveBeenCalledOnce();
        });

        it('should send requestSnippets message on mount', () => {
            render(SnippetLibrary);
            expect(mockPostMessage).toHaveBeenCalledWith({ type: 'requestSnippets' });
        });

        it('should render snippets when snippetsUpdate message is received', async () => {
            render(SnippetLibrary);
            dispatchSnippetsUpdate([makeSnippet()]);
            await tick();

            expect(screen.getByText('Circle SDF')).toBeInTheDocument();
        });

        it('should restore state from snippetsUpdate savedState', async () => {
            render(SnippetLibrary);
            const savedState = {
                search: 'circle',
                cardSize: 350,
                openCategories: ['sdf-2d'],
            };
            dispatchSnippetsUpdate(makeSnippetSet(), savedState);
            await tick();

            const searchInput = screen.getByPlaceholderText('Search snippets...');
            expect(searchInput).toHaveValue('circle');
        });

        it('should restore cardSize from savedState', async () => {
            const { container } = render(SnippetLibrary);
            const savedState = {
                cardSize: 400,
                openCategories: [...CATEGORY_ORDER],
            };
            dispatchSnippetsUpdate(makeSnippetSet(), savedState);
            await tick();

            const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
            expect(slider.value).toBe('400');
        });

        it('should send insertSnippet message when a snippet is inserted', async () => {
            render(SnippetLibrary);
            const snippet = makeSnippet();
            dispatchSnippetsUpdate([snippet]);
            await tick();

            const insertBtn = screen.getByTitle('Insert snippet');
            await fireEvent.click(insertBtn);

            expect(mockPostMessage).toHaveBeenCalledWith({
                type: 'insertSnippet',
                body: snippet.body,
            });
        });

        it('should send deleteCustomSnippet message when a custom snippet is deleted', async () => {
            render(SnippetLibrary);
            const snippet = makeSnippet({ isCustom: true, category: 'custom', name: 'My Custom' });
            dispatchSnippetsUpdate([snippet]);
            await tick();

            const deleteBtn = screen.getByTitle('Delete snippet');
            await fireEvent.click(deleteBtn);

            expect(mockPostMessage).toHaveBeenCalledWith({
                type: 'deleteCustomSnippet',
                name: 'My Custom',
            });
        });

        it('should send saveState message when search changes', async () => {
            render(SnippetLibrary);
            // Need to trigger snippetsUpdate first so stateRestored = true
            dispatchSnippetsUpdate(makeSnippetSet());
            await tick();

            mockPostMessage.mockClear();

            const searchInput = screen.getByPlaceholderText('Search snippets...');
            await fireEvent.input(searchInput, { target: { value: 'test' } });
            await tick();

            expect(mockPostMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'saveState',
                    state: expect.objectContaining({
                        search: 'test',
                    }),
                })
            );
        });

        it('should send saveState message when card size changes (debounced)', async () => {
            const { container } = render(SnippetLibrary);
            dispatchSnippetsUpdate(makeSnippetSet());
            await tick();

            mockPostMessage.mockClear();

            const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
            await fireEvent.input(slider, { target: { value: '350' } });

            // saveState is debounced by 500ms
            vi.advanceTimersByTime(500);
            await tick();

            expect(mockPostMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'saveState',
                    state: expect.objectContaining({
                        cardSize: 350,
                    }),
                })
            );
        });

        it('should not send saveState before stateRestored is true', async () => {
            render(SnippetLibrary);
            // Do NOT dispatch snippetsUpdate so stateRestored remains false
            mockPostMessage.mockClear();

            const searchInput = screen.getByPlaceholderText('Search snippets...');
            await fireEvent.input(searchInput, { target: { value: 'anything' } });
            await tick();

            const saveStateCalls = mockPostMessage.mock.calls.filter(
                c => c[0]?.type === 'saveState'
            );
            expect(saveStateCalls).toHaveLength(0);
        });
    });

    // =====================
    // Search / filtering
    // =====================

    describe('search and filtering', () => {
        it('should filter snippets by name', async () => {
            render(SnippetLibrary);
            dispatchSnippetsUpdate(makeSnippetSet());
            await tick();

            const searchInput = screen.getByPlaceholderText('Search snippets...');
            await fireEvent.input(searchInput, { target: { value: 'Circle' } });
            await tick();

            expect(screen.getByText('Circle SDF')).toBeInTheDocument();
            expect(screen.queryByText('Box SDF')).not.toBeInTheDocument();
            expect(screen.queryByText('Sphere SDF')).not.toBeInTheDocument();
        });

        it('should filter snippets by prefix', async () => {
            render(SnippetLibrary);
            dispatchSnippetsUpdate(makeSnippetSet());
            await tick();

            const searchInput = screen.getByPlaceholderText('Search snippets...');
            await fireEvent.input(searchInput, { target: { value: 'sdBox' } });
            await tick();

            expect(screen.getByText('Box SDF')).toBeInTheDocument();
            expect(screen.queryByText('Circle SDF')).not.toBeInTheDocument();
        });

        it('should filter snippets by description', async () => {
            render(SnippetLibrary);
            dispatchSnippetsUpdate(makeSnippetSet());
            await tick();

            const searchInput = screen.getByPlaceholderText('Search snippets...');
            await fireEvent.input(searchInput, { target: { value: 'remap' } });
            await tick();

            expect(screen.getByText('Remap')).toBeInTheDocument();
            expect(screen.queryByText('Circle SDF')).not.toBeInTheDocument();
        });

        it('should be case-insensitive', async () => {
            render(SnippetLibrary);
            dispatchSnippetsUpdate(makeSnippetSet());
            await tick();

            const searchInput = screen.getByPlaceholderText('Search snippets...');
            await fireEvent.input(searchInput, { target: { value: 'CIRCLE' } });
            await tick();

            expect(screen.getByText('Circle SDF')).toBeInTheDocument();
        });

        it('should show all snippets when search is empty', async () => {
            render(SnippetLibrary);
            dispatchSnippetsUpdate(makeSnippetSet());
            await tick();

            // Type something then clear
            const searchInput = screen.getByPlaceholderText('Search snippets...');
            await fireEvent.input(searchInput, { target: { value: 'circle' } });
            await tick();

            await fireEvent.input(searchInput, { target: { value: '' } });
            await tick();

            expect(screen.getByText('Circle SDF')).toBeInTheDocument();
            expect(screen.getByText('Box SDF')).toBeInTheDocument();
            expect(screen.getByText('Sphere SDF')).toBeInTheDocument();
        });

        it('should show empty state with search term when no snippets match', async () => {
            render(SnippetLibrary);
            dispatchSnippetsUpdate(makeSnippetSet());
            await tick();

            const searchInput = screen.getByPlaceholderText('Search snippets...');
            await fireEvent.input(searchInput, { target: { value: 'nonexistent' } });
            await tick();

            expect(screen.getByText('No snippets match "nonexistent"')).toBeInTheDocument();
        });
    });

    // =====================
    // Card size slider
    // =====================

    describe('card size slider', () => {
        it('should have default value of 280', () => {
            const { container } = render(SnippetLibrary);
            const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
            expect(slider.value).toBe('280');
        });

        it('should update card size when slider changes', async () => {
            const { container } = render(SnippetLibrary);
            dispatchSnippetsUpdate(makeSnippetSet());
            await tick();

            const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
            await fireEvent.input(slider, { target: { value: '400' } });
            await tick();

            // The card grid should reflect the new size via --card-size CSS var
            const snippetGrid = container.querySelector('.snippet-grid') as HTMLElement;
            expect(snippetGrid).toBeInTheDocument();
            expect(snippetGrid.getAttribute('style')).toContain('--card-size: 400px');
        });
    });

    // =====================
    // Category rendering
    // =====================

    describe('category rendering', () => {
        it('should render categories in correct order', async () => {
            render(SnippetLibrary);
            dispatchSnippetsUpdate(makeSnippetSet());
            await tick();

            // The snippet set has sdf-2d, sdf-3d, math, and custom categories
            const categoryHeaders = screen.getAllByRole('button').filter(
                el => el.classList.contains('accordion-header')
            );

            // textContent includes the count badge (e.g. "SDF 2D 2"), so use includes()
            const labels = categoryHeaders.map(h => h.textContent?.trim() ?? '');

            // Get the indices and verify ordering
            const sdf2dIndex = labels.findIndex(l => l.startsWith('SDF 2D'));
            const sdf3dIndex = labels.findIndex(l => l.startsWith('SDF 3D'));
            const mathIndex = labels.findIndex(l => l.startsWith('Math'));
            const customIndex = labels.findIndex(l => l.startsWith('Custom'));

            expect(sdf2dIndex).toBeGreaterThanOrEqual(0);
            expect(sdf3dIndex).toBeGreaterThanOrEqual(0);
            expect(mathIndex).toBeGreaterThanOrEqual(0);
            expect(customIndex).toBeGreaterThanOrEqual(0);

            expect(sdf2dIndex).toBeLessThan(sdf3dIndex);
            expect(sdf3dIndex).toBeLessThan(mathIndex);
            expect(mathIndex).toBeLessThan(customIndex);
        });

        it('should show category labels from CATEGORY_LABELS', async () => {
            render(SnippetLibrary);
            dispatchSnippetsUpdate(makeSnippetSet());
            await tick();

            expect(screen.getByText('SDF 2D')).toBeInTheDocument();
            expect(screen.getByText('SDF 3D')).toBeInTheDocument();
            expect(screen.getByText('Math')).toBeInTheDocument();
            expect(screen.getByText('Custom')).toBeInTheDocument();
        });

        it('should only show categories that have snippets', async () => {
            render(SnippetLibrary);
            // Only provide sdf-2d snippets
            dispatchSnippetsUpdate([makeSnippet({ category: 'sdf-2d' })]);
            await tick();

            expect(screen.getByText('SDF 2D')).toBeInTheDocument();
            expect(screen.queryByText('SDF 3D')).not.toBeInTheDocument();
            expect(screen.queryByText('Noise')).not.toBeInTheDocument();
            expect(screen.queryByText('Custom')).not.toBeInTheDocument();
        });

        it('should show snippet count badge per category', async () => {
            render(SnippetLibrary);
            dispatchSnippetsUpdate(makeSnippetSet());
            await tick();

            // sdf-2d has 2 snippets; find its count badge
            const sdf2dHeader = screen.getByText('SDF 2D').closest('.accordion-header');
            const badge = sdf2dHeader?.querySelector('.count-badge');
            expect(badge).toHaveTextContent('2');
        });

        it('should toggle category open/closed when header is clicked', async () => {
            const { container } = render(SnippetLibrary);
            dispatchSnippetsUpdate(makeSnippetSet());
            await tick();

            // Categories default to open; click to close
            const sdf2dHeader = screen.getByText('SDF 2D').closest('[role="button"]');
            expect(sdf2dHeader).toBeInTheDocument();

            // Snippets should be visible initially
            expect(screen.getByText('Circle SDF')).toBeInTheDocument();

            // Click to collapse
            await fireEvent.click(sdf2dHeader!);
            await tick();

            // After collapsing, the snippet cards inside should be hidden
            // The accordion body disappears when closed
            expect(screen.queryByText('Circle SDF')).not.toBeInTheDocument();
        });

        it('should send saveState when a category is toggled', async () => {
            render(SnippetLibrary);
            dispatchSnippetsUpdate(makeSnippetSet());
            await tick();

            mockPostMessage.mockClear();

            const sdf2dHeader = screen.getByText('SDF 2D').closest('[role="button"]');
            await fireEvent.click(sdf2dHeader!);
            await tick();

            expect(mockPostMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'saveState',
                    state: expect.objectContaining({
                        openCategories: expect.any(Array),
                    }),
                })
            );
        });
    });

    // =====================
    // Custom snippets / Add button
    // =====================

    describe('custom snippets', () => {
        it('should show "Add custom snippet" button in the custom category header', async () => {
            render(SnippetLibrary);
            dispatchSnippetsUpdate([
                makeSnippet({ category: 'custom', isCustom: true }),
            ]);
            await tick();

            const addBtn = screen.getByTitle('Add custom snippet');
            expect(addBtn).toBeInTheDocument();
        });

        it('should not show "Add custom snippet" button in non-custom categories', async () => {
            render(SnippetLibrary);
            dispatchSnippetsUpdate([makeSnippet({ category: 'sdf-2d' })]);
            await tick();

            expect(screen.queryByTitle('Add custom snippet')).not.toBeInTheDocument();
        });
    });

    // =====================
    // Add Snippet Modal
    // =====================

    describe('add snippet modal', () => {
        it('should open the add modal when "+ Add Snippet" button is clicked', async () => {
            render(SnippetLibrary);
            dispatchSnippetsUpdate(makeSnippetSet());
            await tick();

            const addBtn = screen.getByText('+ Add Snippet');
            await fireEvent.click(addBtn);
            await tick();

            expect(screen.getByText('Add Custom Snippet')).toBeInTheDocument();
        });

        it('should close the modal when Cancel is clicked', async () => {
            render(SnippetLibrary);
            dispatchSnippetsUpdate(makeSnippetSet());
            await tick();

            const addBtn = screen.getByText('+ Add Snippet');
            await fireEvent.click(addBtn);
            await tick();

            expect(screen.getByText('Add Custom Snippet')).toBeInTheDocument();

            const cancelBtn = screen.getByText('Cancel');
            await fireEvent.click(cancelBtn);
            await tick();

            expect(screen.queryByText('Add Custom Snippet')).not.toBeInTheDocument();
        });
    });

    // =====================
    // Detail modal
    // =====================

    describe('detail modal', () => {
        it('should open detail modal when a snippet card is clicked', async () => {
            const { container } = render(SnippetLibrary);
            dispatchSnippetsUpdate([makeSnippet()]);
            await tick();

            // Click on the card name to trigger the detail view
            const cardName = container.querySelector('.card-name')!;
            await fireEvent.click(cardName);
            await tick();

            // The detail modal should render the snippet name in its header
            const detailHeader = container.querySelector('.detail-content h2');
            expect(detailHeader).toHaveTextContent('Circle SDF');
        });

        it('should close detail modal when close button is clicked', async () => {
            const { container } = render(SnippetLibrary);
            dispatchSnippetsUpdate([makeSnippet()]);
            await tick();

            const cardName = container.querySelector('.card-name')!;
            await fireEvent.click(cardName);
            await tick();

            const closeBtn = screen.getByTitle('Close');
            await fireEvent.click(closeBtn);
            await tick();

            const detailOverlay = container.querySelector('.detail-overlay');
            expect(detailOverlay).not.toBeInTheDocument();
        });

        it('should send insertSnippet from detail modal "Insert into Editor" button', async () => {
            const { container } = render(SnippetLibrary);
            const snippet = makeSnippet();
            dispatchSnippetsUpdate([snippet]);
            await tick();

            const cardName = container.querySelector('.card-name')!;
            await fireEvent.click(cardName);
            await tick();

            mockPostMessage.mockClear();

            const insertBtn = screen.getByText('Insert into Editor');
            await fireEvent.click(insertBtn);

            expect(mockPostMessage).toHaveBeenCalledWith({
                type: 'insertSnippet',
                body: snippet.body,
            });
        });
    });

    // =====================
    // Empty state
    // =====================

    describe('empty state', () => {
        it('should show "No snippets found" when no snippets are loaded', async () => {
            render(SnippetLibrary);
            dispatchSnippetsUpdate([]);
            await tick();

            expect(screen.getByText('No snippets found')).toBeInTheDocument();
        });

        it('should show "No snippets match" with search term when filter yields nothing', async () => {
            render(SnippetLibrary);
            dispatchSnippetsUpdate(makeSnippetSet());
            await tick();

            const searchInput = screen.getByPlaceholderText('Search snippets...');
            await fireEvent.input(searchInput, { target: { value: 'xyzzy' } });
            await tick();

            expect(screen.getByText('No snippets match "xyzzy"')).toBeInTheDocument();
        });

        it('should not show empty state when snippets are present', async () => {
            render(SnippetLibrary);
            dispatchSnippetsUpdate(makeSnippetSet());
            await tick();

            expect(screen.queryByText('No snippets found')).not.toBeInTheDocument();
        });
    });

    // =====================
    // State restoration
    // =====================

    describe('state restoration', () => {
        it('should restore openCategories from savedState', async () => {
            render(SnippetLibrary);
            const savedState = {
                openCategories: ['sdf-2d'], // Only sdf-2d is open
            };
            dispatchSnippetsUpdate(makeSnippetSet(), savedState);
            await tick();

            // sdf-2d should be open (its snippets visible)
            expect(screen.getByText('Circle SDF')).toBeInTheDocument();

            // sdf-3d should be closed (its snippets not visible)
            expect(screen.queryByText('Sphere SDF')).not.toBeInTheDocument();
        });

        it('should restore search from savedState', async () => {
            render(SnippetLibrary);
            const savedState = {
                search: 'box',
                openCategories: [...CATEGORY_ORDER],
            };
            dispatchSnippetsUpdate(makeSnippetSet(), savedState);
            await tick();

            // Only Box SDF should match
            expect(screen.getByText('Box SDF')).toBeInTheDocument();
            expect(screen.queryByText('Sphere SDF')).not.toBeInTheDocument();
        });
    });

    // =====================
    // Edit modal
    // =====================

    describe('edit snippet', () => {
        it('should open the add modal in edit mode when Edit is clicked on a custom snippet', async () => {
            render(SnippetLibrary);
            const snippet = makeSnippet({ isCustom: true, category: 'custom', name: 'My Snippet' });
            dispatchSnippetsUpdate([snippet]);
            await tick();

            const editBtn = screen.getByTitle('Edit snippet');
            await fireEvent.click(editBtn);
            await tick();

            // The modal title should say "Edit Snippet" instead of "Add Custom Snippet"
            expect(screen.getByText('Edit Snippet')).toBeInTheDocument();
        });
    });

    // =====================
    // Create Scene
    // =====================

    describe('create scene', () => {
        it('should send createScene message when Create Scene button is clicked in detail modal', async () => {
            const { container } = render(SnippetLibrary);
            // The snippet needs a `call` property so buildPreviewShader returns non-null
            const snippet = makeSnippet({
                call: 'sdCircle(p, 0.5)',
                category: 'sdf-2d',
            });
            dispatchSnippetsUpdate([snippet]);
            await tick();

            const cardName = container.querySelector('.card-name')!;
            await fireEvent.click(cardName);
            await tick();

            mockPostMessage.mockClear();

            const createSceneBtn = screen.getByText('Create Scene');
            await fireEvent.click(createSceneBtn);

            // It should post a createScene message (the actual shader code depends on buildPreviewShader)
            const createSceneCalls = mockPostMessage.mock.calls.filter(
                c => c[0]?.type === 'createScene'
            );
            expect(createSceneCalls).toHaveLength(1);
            expect(createSceneCalls[0][0].shaderCode).toContain('sdCircle(p, 0.5)');
        });
    });
});
