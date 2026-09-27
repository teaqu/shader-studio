import { createRawSnippet, tick } from 'svelte';
import { render } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
});
