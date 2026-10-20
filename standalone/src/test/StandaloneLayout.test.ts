import { createRawSnippet, tick } from 'svelte';
import { fireEvent, render, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StandaloneSettings } from '../settings/StandaloneSettings';
import { connectSettings } from '../settings/settingsState.svelte';
import StandaloneLayout from '../StandaloneLayout.svelte';
import { createDockview } from 'dockview-core';
import { resetMobileShellState, observeMobileVisualViewport } from '../state/mobileShellState.svelte';
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

    it('keeps Editor and Preview accessible while the keyboard is open', async () => {
      const media = stubViewport(true);
      const settings = new StandaloneSettings({ getItem: () => null, setItem: vi.fn() });
      const disconnect = connectSettings(settings);
      const viewport = Object.assign(new EventTarget(), { scale: 1, height: 800, offsetTop: 0 });
      vi.stubGlobal('innerHeight', 800);
      vi.stubGlobal('visualViewport', viewport);
      const stop = observeMobileVisualViewport();
      const editor = document.body.appendChild(document.createElement('div'));
      editor.dataset.editorEngine = 'codemirror';
      const input = editor.appendChild(document.createElement('textarea'));
      const result = renderLayout();
      try {
        result.component.selectMobilePanel('editor');
        input.focus();
        viewport.height = 400;
        viewport.dispatchEvent(new Event('resize'));
        await tick();
        expect(result.queryByRole('navigation', { name: 'Workspace panels' })).toBeNull();
        const quickNav = result.getByRole('navigation', { name: 'Editor and preview' });
        expect(within(quickNav).getAllByRole('button').map(button => button.textContent)).toEqual(['Editor', 'Preview']);
        for (const [label, panel] of [['Preview', 'preview'], ['Editor', 'editor']]) {
          const button = within(quickNav).getByRole('button', { name: label });
          expect(await fireEvent.mouseDown(button)).toBe(false);
          await fireEvent.click(button);
          expect(result.component.getSelectedMobilePanel()).toBe(panel);
          expect(button.getAttribute('aria-current')).toBe('page');
          expect(document.activeElement).toBe(input);
        }
        settings.update('editor.mobileNavigation', false);
        await tick();
        expect(result.queryByRole('navigation', { name: 'Editor and preview' })).toBeNull();
        expect(result.queryByRole('navigation', { name: 'Workspace panels' })).toBeNull();
        expect(result.container.querySelector('.standalone-layout')).not.toHaveClass('keyboard-navigation');
        settings.update('editor.mobileNavigation', true);
        await tick();
        expect(result.getByRole('navigation', { name: 'Editor and preview' })).toBeTruthy();
        media.resize(false);
        await tick();
        expect(result.queryByRole('navigation', { name: 'Editor and preview' })).toBeNull();
        media.resize(true);
        viewport.height = 800;
        viewport.dispatchEvent(new Event('resize'));
        await tick();
        expect(result.queryByRole('navigation', { name: 'Editor and preview' })).toBeNull();
        expect(result.getByRole('navigation', { name: 'Workspace panels' })).toBeTruthy();
      } finally {
        result.unmount();
        disconnect();
        stop();
        editor.remove();
      }
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function renderLayoutWithFiles(hostedPanels?: HostedPanels) {
      return render(StandaloneLayout, { props: {
        explorer: source('explorer'), files: source('files'), editor: source('editor'), preview: source('preview'),
        ...(hostedPanels ? { hostedPanels } : {}),
      } });
    }

    it('groups Shaders and Files under the phone Studio destination', async () => {
      stubViewport(true);
      const result = renderLayoutWithFiles();
      await tick();
      const nav = result.getByRole('navigation', { name: 'Workspace panels' });
      expect(within(nav).getAllByRole('button').map((button) => button.textContent)).toEqual(['Studio', 'Editor', 'Preview', 'Tools']);
      expect(result.queryByRole('navigation', { name: 'Studio sections' })).toBeNull();

      await fireEvent.click(within(nav).getByRole('button', { name: 'Studio' }));
      const sections = result.getByRole('navigation', { name: 'Studio sections' });
      expect(within(sections).getByRole('button', { name: 'Shaders' }).getAttribute('aria-current')).toBe('page');
      expect(result.component.getSelectedMobilePanel()).toBe('explorer');

      await fireEvent.click(within(sections).getByRole('button', { name: 'Files' }));
      expect(result.component.getSelectedMobilePanel()).toBe('files');
      expect(within(sections).getByRole('button', { name: 'Files' }).getAttribute('aria-current')).toBe('page');
      expect(within(nav).getByRole('button', { name: 'Studio' }).getAttribute('aria-current')).toBe('page');

      // Studio reopens on the section that was last used.
      await fireEvent.click(within(nav).getByRole('button', { name: 'Preview' }));
      expect(result.queryByRole('navigation', { name: 'Studio sections' })).toBeNull();
      await fireEvent.click(within(nav).getByRole('button', { name: 'Studio' }));
      expect(result.component.getSelectedMobilePanel()).toBe('files');
    });

    it('follows a Files selection made through the component API', async () => {
      stubViewport(true);
      const result = renderLayoutWithFiles();
      await tick();
      result.component.selectMobilePanel('files');
      await tick();
      const sections = result.getByRole('navigation', { name: 'Studio sections' });
      expect(within(sections).getByRole('button', { name: 'Files' }).getAttribute('aria-current')).toBe('page');
      expect(within(result.getByRole('navigation', { name: 'Workspace panels' })).getByRole('button', { name: 'Studio' })
        .getAttribute('aria-current')).toBe('page');
    });

    it('puts the Studio controls beside Shaders and Files and the notices above them', async () => {
      stubViewport(true);
      const result = render(StandaloneLayout, { props: {
        explorer: source('explorer'), files: source('files'), editor: source('editor'), preview: source('preview'),
        studio: source('studio-controls'), studioNotices: source('studio-notices'),
      } });
      await tick();
      const nav = result.getByRole('navigation', { name: 'Workspace panels' });
      const controls = () => result.container.querySelector('.mobile-studio-row .mobile-studio-actions [data-source="studio-controls"]');
      const notices = () => result.container.querySelector('.mobile-studio-notices [data-source="studio-notices"]');
      expect(controls()).toBeNull();
      expect(notices()).toBeNull();

      await fireEvent.click(within(nav).getByRole('button', { name: 'Studio' }));
      expect(controls()).not.toBeNull();
      expect(notices()).not.toBeNull();
      expect(controls()!.closest('.mobile-studio-row')!.querySelector('nav[aria-label="Studio sections"]')).not.toBeNull();
      await fireEvent.click(within(result.getByRole('navigation', { name: 'Studio sections' })).getByRole('button', { name: 'Files' }));
      expect(controls()).not.toBeNull();
      await fireEvent.click(within(nav).getByRole('button', { name: 'Editor' }));
      expect(controls()).toBeNull();
      expect(notices()).toBeNull();
    });

    it('keeps the Studio controls without a Files panel', async () => {
      stubViewport(true);
      const result = render(StandaloneLayout, { props: {
        explorer: source('explorer'), editor: source('editor'), preview: source('preview'), studio: source('studio-controls'),
      } });
      await tick();
      await fireEvent.click(result.getByRole('button', { name: 'Studio' }));
      expect(result.queryByRole('navigation', { name: 'Studio sections' })).toBeNull();
      expect(result.container.querySelector('.mobile-studio-row [data-source="studio-controls"]')).not.toBeNull();
    });

    it('keeps the Studio controls out of the desktop layout', async () => {
      stubViewport(false);
      const result = render(StandaloneLayout, { props: {
        explorer: source('explorer'), editor: source('editor'), preview: source('preview'),
        studio: source('studio-controls'), studioNotices: source('studio-notices'),
      } });
      await tick();
      result.component.selectMobilePanel('explorer');
      await tick();
      expect(result.container.querySelector('.mobile-studio-row')).toBeNull();
      expect(result.container.querySelector('.mobile-studio-notices')).toBeNull();
    });

    it('offers no Studio sections when the host has no Files panel', async () => {
      stubViewport(true);
      const result = renderLayout();
      await tick();
      await fireEvent.click(result.getByRole('button', { name: 'Studio' }));
      expect(result.queryByRole('navigation', { name: 'Studio sections' })).toBeNull();
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

    it.each(['Studio', 'Editor', 'Preview', 'Tools'])('marks %s current when tapped', async (name) => {
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

    it('reuses the preview behind the mobile editor and restores it for every destination change', async () => {
      const settings = new StandaloneSettings({ getItem: () => null, setItem: vi.fn() });
      const disconnect = connectSettings(settings);
      const viewport = stubViewport(true);
      const result = renderLayout();
      try {
        await tick();
        const preview = result.container.querySelector('[data-source="preview"]') as HTMLElement;
        expect(preview).toBeTruthy();
        expect(result.container.querySelector('.mobile-preview-backdrop [data-source="preview"]')).toBeNull();

        settings.update('editor.mobileShaderBackdrop', true);
        result.component.selectMobilePanel('editor');
        await tick();
        const backdrop = result.container.querySelector('.mobile-preview-backdrop') as HTMLElement;
        expect(backdrop.querySelector('[data-source="preview"]')).toBe(preview);

        result.component.selectMobilePanel('preview');
        await tick();
        expect(backdrop.querySelector('[data-source="preview"]')).toBeNull();
        expect(result.container.querySelectorAll('[data-source="preview"]')).toHaveLength(1);
        expect(result.container.querySelector('[data-source="preview"]')).toBe(preview);

        result.component.selectMobilePanel('editor');
        await tick();
        expect(backdrop.querySelector('[data-source="preview"]')).toBe(preview);

        result.component.resetLayout();
        await tick();
        expect(backdrop.querySelector('[data-source="preview"]')).toBe(preview);
        expect(result.container.querySelectorAll('[data-source="preview"]')).toHaveLength(1);

        settings.update('editor.mobileShaderBackdrop', false);
        await tick();
        expect(backdrop.querySelector('[data-source="preview"]')).toBeNull();
        expect(result.container.querySelector('[data-source="preview"]')).toBe(preview);

        settings.update('editor.mobileShaderBackdrop', true);
        await tick();
        expect(backdrop.querySelector('[data-source="preview"]')).toBe(preview);
        viewport.resize(false);
        await tick();
        expect(backdrop.querySelector('[data-source="preview"]')).toBeNull();
        expect(result.container.querySelector('[data-source="preview"]')).toBe(preview);
      } finally {
        result.unmount();
        disconnect();
      }
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
