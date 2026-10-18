import { createRawSnippet, tick } from 'svelte';
import { fireEvent, render, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StandaloneSettings } from '../settings/StandaloneSettings';
import { connectSettings } from '../settings/settingsState.svelte';
import StandaloneLayout from '../StandaloneLayout.svelte';
import { createDockview } from 'dockview-core';
import { resetMobileShellState } from '../state/mobileShellState.svelte';
import { HostedPanels } from '../HostedPanels';

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
      panels: [] as unknown[],
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

const controllerArgs = vi.hoisted(() => ({ latest: [] as unknown[] }));
vi.mock('../StandaloneLayoutController', async importOriginal => {
  const actual = await importOriginal<typeof import('../StandaloneLayoutController')>();
  class RecordingController extends actual.StandaloneLayoutController {
    constructor(...args: ConstructorParameters<typeof actual.StandaloneLayoutController>) {
      super(...args);
      controllerArgs.latest = args;
    }
  }
  return { ...actual, StandaloneLayoutController: RecordingController };
});

function source(name: string) {
  return createRawSnippet(() => ({ render: () => `<div data-source="${name}">${name}</div>` }));
}

describe('StandaloneLayout', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    renderers = []; willDrop = null; resetMobileShellState();
  });

  describe('single-tab visibility', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    async function setup() {
      const result = render(StandaloneLayout, { props: { explorer: source('explorer'), editor: source('editor'), preview: source('preview') } });
      await tick();
      return { ...result, dock: result.container.querySelector('.standalone-dockview') as HTMLElement };
    }

    it('reveals at the top edge after 300ms and hides after leaving for 400ms', async () => {
      const { dock } = await setup();
      expect(dock.classList.contains('dv-autohide-tabs')).toBe(true);
      await fireEvent.mouseMove(dock, { clientY: 3 });
      vi.advanceTimersByTime(299);
      expect(dock.classList.contains('dv-sash-hover')).toBe(false);
      vi.advanceTimersByTime(1);
      expect(dock.classList.contains('dv-sash-hover')).toBe(true);
      await fireEvent.mouseMove(dock, { clientY: 100 });
      vi.advanceTimersByTime(400);
      expect(dock.classList.contains('dv-sash-hover')).toBe(false);
    });

    it('reveals over a divider and keeps tabs visible while dragging', async () => {
      const { dock } = await setup();
      const sash = document.createElement('div');
      sash.className = 'dv-sash';
      dock.append(sash);
      await fireEvent.mouseOver(sash);
      vi.advanceTimersByTime(300);
      expect(dock.classList.contains('dv-sash-hover')).toBe(true);
      await fireEvent.dragStart(sash);
      expect(dock.classList.contains('dv-drag-active')).toBe(true);
      await fireEvent.dragEnd(document);
      expect(dock.classList.contains('dv-drag-active')).toBe(false);
    });

    it('cancels pending reveals and removes listeners on unmount', async () => {
      const { dock, unmount } = await setup();
      await fireEvent.mouseMove(dock, { clientY: 3 });
      unmount();
      vi.advanceTimersByTime(300);
      expect(dock.classList.contains('dv-sash-hover')).toBe(false);
      await fireEvent.dragStart(dock);
      expect(dock.classList.contains('dv-drag-active')).toBe(false);
    });
  });

  it('keeps each snippet mounted once across reset and returns it on unmount', async () => {
    const result = render(StandaloneLayout, { props: { explorer: source('explorer'), editor: source('editor'), preview: source('preview') } });
    await tick();
    const api = vi.mocked(createDockview).mock.results.at(-1)!.value;
    expect(api.layout).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
    expect(api.layout.mock.invocationCallOrder[0]).toBeLessThan(api.addPanel.mock.invocationCallOrder[0]);
    const preview = renderers[0].element.querySelector('.standalone-panel-source');
    expect(renderers.filter((renderer) => renderer.element.querySelector('.standalone-panel-source')).length).toBe(4);
    result.component.resetLayout();
    expect(renderers.filter((renderer) => renderer.element.querySelector('.standalone-panel-source')).length).toBe(4);
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

    function renderLayoutWithFiles(hostedPanels?: HostedPanels) {
      return render(StandaloneLayout, { props: {
        explorer: source('explorer'), files: source('files'), editor: source('editor'), preview: source('preview'),
        ...(hostedPanels ? { hostedPanels } : {}),
      } });
    }

    it('groups Explorer and Files under one phone destination', async () => {
      stubViewport(true);
      const result = renderLayoutWithFiles();
      await tick();
      const nav = result.getByRole('navigation', { name: 'Workspace panels' });
      expect(within(nav).getAllByRole('button').map((button) => button.textContent)).toEqual(['Explorer', 'Editor', 'Preview', 'Tools']);
      expect(result.queryByRole('navigation', { name: 'Explorer sections' })).toBeNull();

      await fireEvent.click(within(nav).getByRole('button', { name: 'Explorer' }));
      const sections = result.getByRole('navigation', { name: 'Explorer sections' });
      expect(within(sections).getByRole('button', { name: 'Shaders' }).getAttribute('aria-current')).toBe('page');
      expect(result.component.getSelectedMobilePanel()).toBe('explorer');

      await fireEvent.click(within(sections).getByRole('button', { name: 'Files' }));
      expect(result.component.getSelectedMobilePanel()).toBe('files');
      expect(within(sections).getByRole('button', { name: 'Files' }).getAttribute('aria-current')).toBe('page');
      expect(within(nav).getByRole('button', { name: 'Explorer' }).getAttribute('aria-current')).toBe('page');

      // Explorer reopens on the section that was last used.
      await fireEvent.click(within(nav).getByRole('button', { name: 'Preview' }));
      expect(result.queryByRole('navigation', { name: 'Explorer sections' })).toBeNull();
      await fireEvent.click(within(nav).getByRole('button', { name: 'Explorer' }));
      expect(result.component.getSelectedMobilePanel()).toBe('files');
    });

    it('follows a Files selection made through the component API', async () => {
      stubViewport(true);
      const result = renderLayoutWithFiles();
      await tick();
      result.component.selectMobilePanel('files');
      await tick();
      const sections = result.getByRole('navigation', { name: 'Explorer sections' });
      expect(within(sections).getByRole('button', { name: 'Files' }).getAttribute('aria-current')).toBe('page');
      expect(within(result.getByRole('navigation', { name: 'Workspace panels' })).getByRole('button', { name: 'Explorer' })
        .getAttribute('aria-current')).toBe('page');
    });

    it('offers no Explorer sections when the host has no Files panel', async () => {
      stubViewport(true);
      const result = renderLayout();
      await tick();
      await fireEvent.click(result.getByRole('button', { name: 'Explorer' }));
      expect(result.queryByRole('navigation', { name: 'Explorer sections' })).toBeNull();
      expect(result.component.getSelectedMobilePanel()).toBe('explorer');
    });

    it('offers VR in the phone tools and reopens it as the last tool', async () => {
      stubViewport(true);
      const hostedPanels = new HostedPanels();
      const result = renderLayoutWithFiles(hostedPanels);
      await tick();
      hostedPanels.showTool('vr');
      const api = vi.mocked(createDockview).mock.results.at(-1)!.value;
      vi.mocked(api.addPanel).mockClear();

      result.component.selectMobilePanel('tools');
      await tick();

      const tools = result.getByRole('navigation', { name: 'Tools' });
      expect(within(tools).getAllByRole('button').map((button) => button.textContent)).toEqual(['Config', 'Debug', 'Frame Times', 'Export', 'VR']);
      expect(within(tools).getByRole('button', { name: 'VR' }).getAttribute('aria-current')).toBe('page');
      expect(api.addPanel).toHaveBeenCalledWith(expect.objectContaining({ id: 'vr' }));
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

    it('reacts immediately to the global mobile-mode preference at a phone width', async () => {
      const settings = new StandaloneSettings({ getItem: () => null, setItem: vi.fn() });
      const disconnect = connectSettings(settings);
      stubViewport(true);
      const result = renderLayout();
      await tick();
      expect(result.component.isMobileLayout()).toBe(true);
      settings.update('layout.mobileMode', false);
      await tick();
      expect(result.component.isMobileLayout()).toBe(false);
      expect(result.queryByRole('navigation', { name: 'Workspace panels' })).toBeNull();
      settings.update('layout.mobileMode', true);
      await tick();
      expect(result.component.isMobileLayout()).toBe(true);
      expect(result.getByRole('navigation', { name: 'Workspace panels' })).toBeTruthy();
      disconnect();
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

  it('activates editor shaders, asks the transport before closing, and closes removed paths', async () => {
    const postMessage = vi.fn();
    const confirmEditorClose = vi.fn(async () => false);
    const transport = { getShaderExplorerHostApi: () => ({ postMessage }), confirmEditorClose };
    const { component } = render(StandaloneLayout, { props: {
      explorer: source('explorer'), editor: source('editor'), preview: source('preview'), transport: transport as never,
    } });
    await tick();
    const [, , activate, confirmClose] = controllerArgs.latest as [unknown, unknown, (path: string) => void, (path: string) => Promise<boolean>];
    activate('/aurora.glsl');
    expect(postMessage).toHaveBeenCalledWith({ type: 'activateShader', path: '/aurora.glsl' });
    await expect(confirmClose('/aurora.glsl')).resolves.toBe(false);
    expect(confirmEditorClose).toHaveBeenCalledWith('/aurora.glsl');
    const { StandaloneLayoutController } = await import('../StandaloneLayoutController');
    const close = vi.spyOn(StandaloneLayoutController.prototype, 'closeEditorPaths');
    (component as unknown as { closeEditorPaths(paths: string[]): void }).closeEditorPaths(['/gone.glsl']);
    expect(close).toHaveBeenCalledWith(['/gone.glsl']);
  });

  it('closes editors without a prompt when no transport is attached', async () => {
    render(StandaloneLayout, { props: { explorer: source('explorer'), editor: source('editor'), preview: source('preview') } });
    await tick();
    const [, , activate, confirmClose] = controllerArgs.latest as [unknown, unknown, (path: string) => void, (path: string) => Promise<boolean>];
    expect(() => activate('/aurora.glsl')).not.toThrow();
    await expect(confirmClose('/aurora.glsl')).resolves.toBe(true);
  });
});
