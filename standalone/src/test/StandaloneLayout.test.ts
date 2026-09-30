import { createRawSnippet, tick } from 'svelte';
import { fireEvent, render, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StandaloneLayout from '../StandaloneLayout.svelte';
import { createDockview } from 'dockview-core';
import { resetMobileShellState } from '../state/mobileShellState.svelte';

let renderers: { element: HTMLElement; dispose(): void; init(parameters: { api: { id: string } }): void }[] = [];
let willDrop: ((event: { getData(): { viewId: string } | undefined; preventDefault(): void }) => void) | null = null;

vi.mock('../EditorPane.svelte', async () => ({ default: (await import('./AppEditorPaneStub.svelte')).default }));

vi.mock('dockview-core', () => ({
  createDockview: vi.fn((_element, options) => {
    const api = {
      id: 'standalone-dock',
      layout: vi.fn(),
      addPanel: vi.fn((panel) => {
        const renderer = options.createComponent({ id: panel.id, name: panel.component });
        renderers.push(renderer);
        renderer.init({ api: { id: panel.id } });
      }),
      clear: vi.fn(() => {
        renderers.forEach((renderer) => renderer.dispose()); renderers = [];
      }),
      dispose: vi.fn(() => {
        renderers.forEach((renderer) => renderer.dispose()); renderers = [];
      }),
      fromJSON: vi.fn(),
      getPanel: vi.fn(() => undefined),
      onDidActivePanelChange: vi.fn(() => ({ dispose: vi.fn() })),
      onDidLayoutChange: vi.fn(() => ({ dispose: vi.fn() })),
      onDidRemovePanel: vi.fn(() => ({ dispose: vi.fn() })),
      onWillDrop: vi.fn((listener) => {
        willDrop = listener; return { dispose: vi.fn() };
      }),
      toJSON: vi.fn(() => ({ panels: {} })),
    };
    return api;
  }),
  themeVisualStudio: { name: 'vs', className: 'vs' },
}));

vi.mock('dockview-core/dist/styles/dockview.css', () => ({}));

function source(name: string) {
  return createRawSnippet(() => ({ render: () => `<div data-source="${name}">${name}</div>` }));
}

describe('StandaloneLayout', () => {
  beforeEach(() => {
    renderers = []; willDrop = null; resetMobileShellState();
  });

  it('keeps each snippet mounted once across reset and returns it on unmount', async () => {
    const result = render(StandaloneLayout, { props: { explorer: source('explorer'), editor: source('editor'), preview: source('preview') } });
    await tick();
    const api = vi.mocked(createDockview).mock.results.at(-1)!.value;
    expect(api.layout).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
    expect(api.layout.mock.invocationCallOrder[0]).toBeLessThan(api.addPanel.mock.invocationCallOrder[0]);
    const preview = renderers[0].element.querySelector('.standalone-panel-source');
    expect(renderers.filter((renderer) => renderer.element.querySelector('.standalone-panel-source')).length).toBe(3);
    result.component.resetLayout();
    expect(renderers.filter((renderer) => renderer.element.querySelector('.standalone-panel-source')).length).toBe(3);
    expect(renderers[0].element.querySelector('.standalone-panel-source')).toBe(preview);
    result.unmount();
    expect(renderers).toHaveLength(0);
  });

  it('rejects a drop from the nested preview dock but accepts an outer-panel drop', async () => {
    render(StandaloneLayout, { props: { explorer: source('explorer'), editor: source('editor'), preview: source('preview') } });
    await tick();
    const reject = { getData: () => ({ viewId: 'nested-preview-dock' }), preventDefault: vi.fn() };
    willDrop?.(reject);
    expect(reject.preventDefault).toHaveBeenCalled();
    const accept = { getData: () => ({ viewId: 'standalone-dock' }), preventDefault: vi.fn() };
    willDrop?.(accept);
    expect(accept.preventDefault).not.toHaveBeenCalled();
  });

  it('renders phone destinations and exposes the selection API without changing the desktop layout', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const result = render(StandaloneLayout, { props: { explorer: source('explorer'), editor: source('editor'), preview: source('preview') } });
    await tick();

    expect(result.getByRole('navigation', { name: 'Workspace panels' })).toBeTruthy();
    result.component.selectMobilePanel('editor');
    expect(result.component.getSelectedMobilePanel()).toBe('editor');
    expect(result.component.isMobileLayout()).toBe(true);
    expect(vi.mocked(createDockview).mock.results.at(-1)!.value.clear).not.toHaveBeenCalled();
    result.component.selectMobilePanel('tools');
    await tick();
    expect(result.getByRole('navigation', { name: 'Tools' })).toBeTruthy();
    expect(result.getByRole('button', { name: 'Config' }).getAttribute('aria-current')).toBe('page');
    vi.unstubAllGlobals();
  });

  describe('phone shell', () => {
    function stubViewport(matches: boolean) {
      const listeners = new Set<() => void>();
      const media = {
        matches,
        addEventListener: vi.fn((_type: string, listener: () => void) => listeners.add(listener)),
        removeEventListener: vi.fn((_type: string, listener: () => void) => listeners.delete(listener)),
      };
      vi.stubGlobal('matchMedia', vi.fn(() => media));
      return {
        media,
        resize: (next: boolean) => {
          media.matches = next;
          listeners.forEach((listener) => listener());
        },
        listenerCount: () => listeners.size,
      };
    }

    function renderLayout() {
      return render(StandaloneLayout, { props: { explorer: source('explorer'), editor: source('editor'), preview: source('preview') } });
    }

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('opens the tapped tool and marks it current', async () => {
      stubViewport(true);
      const result = renderLayout();
      await tick();
      result.component.selectMobilePanel('tools');
      await tick();
      const api = vi.mocked(createDockview).mock.results.at(-1)!.value;

      await fireEvent.click(result.getByRole('button', { name: 'Debug' }));

      expect(result.getByRole('button', { name: 'Debug' }).getAttribute('aria-current')).toBe('page');
      expect(result.getByRole('button', { name: 'Config' }).getAttribute('aria-current')).toBeNull();
      expect(api.addPanel).toHaveBeenCalledWith(expect.objectContaining({ id: 'debug' }));
      expect(result.component.getSelectedMobilePanel()).toBe('tools');
    });

    it.each([
      ['Frame Times', 'performance'],
      ['Export', 'recording'],
    ])('opens %s from the tools row', async (name, id) => {
      stubViewport(true);
      const result = renderLayout();
      await tick();
      result.component.selectMobilePanel('tools');
      await tick();
      const api = vi.mocked(createDockview).mock.results.at(-1)!.value;

      await fireEvent.click(result.getByRole('button', { name }));

      expect(api.addPanel).toHaveBeenCalledWith(expect.objectContaining({ id }));
    });

    it('returns to the last tool after visiting another panel', async () => {
      stubViewport(true);
      const result = renderLayout();
      await tick();
      result.component.selectMobilePanel('tools');
      await tick();
      await fireEvent.click(result.getByRole('button', { name: 'Frame Times' }));

      await fireEvent.click(result.getByRole('button', { name: 'Preview' }));
      expect(result.queryByRole('navigation', { name: 'Tools' })).toBeNull();
      await fireEvent.click(result.getByRole('button', { name: 'Tools' }));

      expect(result.getByRole('button', { name: 'Frame Times' }).getAttribute('aria-current')).toBe('page');
    });

    it('opens a tool directly through the component API', async () => {
      stubViewport(true);
      const result = renderLayout();
      await tick();

      result.component.selectMobileTool('recording');
      await tick();

      expect(result.component.getSelectedMobilePanel()).toBe('tools');
      expect(result.getByRole('button', { name: 'Export' }).getAttribute('aria-current')).toBe('page');
    });

    it.each(['Explorer', 'Editor', 'Preview', 'Tools'])('marks %s current when tapped', async (name) => {
      stubViewport(true);
      const result = renderLayout();
      await tick();
      const nav = result.getByRole('navigation', { name: 'Workspace panels' });

      await fireEvent.click(within(nav).getByRole('button', { name }));

      const current = within(nav).getAllByRole('button').filter((button) => button.getAttribute('aria-current') === 'page');
      expect(current.map((button) => button.textContent)).toEqual([name]);
    });

    it('opens on Preview', async () => {
      stubViewport(true);
      const result = renderLayout();
      await tick();

      expect(result.getByRole('button', { name: 'Preview' }).getAttribute('aria-current')).toBe('page');
      expect(result.container.querySelector('.standalone-layout')?.getAttribute('data-mobile-panel')).toBe('preview');
    });

    it('switches between the phone shell and desktop docking as the window crosses the breakpoint', async () => {
      const viewport = stubViewport(false);
      const result = renderLayout();
      await tick();
      expect(result.queryByRole('navigation', { name: 'Workspace panels' })).toBeNull();

      viewport.resize(true);
      await tick();
      expect(result.getByRole('navigation', { name: 'Workspace panels' })).toBeTruthy();
      expect(result.container.querySelector('.standalone-layout')?.classList.contains('mobile-layout')).toBe(true);

      viewport.resize(false);
      await tick();
      expect(result.queryByRole('navigation', { name: 'Workspace panels' })).toBeNull();
      expect(result.component.isMobileLayout()).toBe(false);
    });

    it('queries the phone breakpoint and stops listening on unmount', async () => {
      const viewport = stubViewport(true);
      const result = renderLayout();
      await tick();
      expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 767px)');
      expect(viewport.listenerCount()).toBe(1);

      result.unmount();

      expect(viewport.listenerCount()).toBe(0);
    });

    it('uses desktop docking where media queries are unavailable', async () => {
      vi.stubGlobal('matchMedia', undefined);
      const result = renderLayout();
      await tick();

      expect(result.queryByRole('navigation', { name: 'Workspace panels' })).toBeNull();
      expect(result.component.isMobileLayout()).toBe(false);
    });
  });
});
