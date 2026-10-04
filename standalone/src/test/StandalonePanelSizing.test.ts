import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DockviewApi } from 'dockview-core';
import { PANEL_WIDTHS_STORAGE_KEY, StandalonePanelSizing } from '../StandalonePanelSizing';

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.unstubAllGlobals();
});

function setup(saved?: string) {
  let width = 1600;
  let mobile = false;
  const element = document.createElement('div');
  const sash = document.createElement('div');
  sash.className = 'dv-sash';
  element.append(sash);
  Object.defineProperty(element, 'clientWidth', { get: () => width });
  Object.defineProperty(element, 'clientHeight', { value: 900 });
  const createPanel = (id: string, panelWidth: number) => {
    const group = { panels: [] as { id: string }[], api: { isVisible: true } };
    const panel = { id, api: { width: panelWidth, group, setSize: vi.fn((size: { width: number }) => {
      panel.api.width = size.width;
    }) } };
    group.panels.push(panel);
    return panel;
  };
  const panels = [createPanel('explorer', 260), createPanel('editor', 780), createPanel('preview', 560)];
  const api = {
    panels,
    getPanel: (id: string) => panels.find((panel) => panel.id === id),
    layout: vi.fn((nextWidth: number) => {
      panels.forEach((panel) => {
        panel.api.width = nextWidth / panels.length; 
      });
    }),
  };
  let observerCallback = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) {
      observerCallback = callback; 
    }
    observe() {}
    disconnect = disconnect;
  });
  const storage = { getItem: vi.fn(() => saved ?? null), setItem: vi.fn(), removeItem: vi.fn() };
  const sizing = new StandalonePanelSizing(api as unknown as Pick<DockviewApi, 'panels' | 'getPanel' | 'layout'>,
    element, () => mobile, storage);
  cleanups.push(() => sizing.dispose());
  return { api, sizing, storage, sash, disconnect,
    explorer: panels[0], preview: panels[2],
    resize: (next: number, phone = false) => {
      width = next; mobile = phone; observerCallback(); 
    },
    start: () => sash.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })),
    finish: () => document.dispatchEvent(new MouseEvent('mouseup')),
  };
}

describe('StandalonePanelSizing', () => {
  it('keeps preferred widths on growth and restores them after temporary compression', () => {
    const app = setup(JSON.stringify({ explorer: 350, preview: 700 }));
    app.resize(2200);
    expect(app.explorer.api.width).toBe(350);
    expect(app.preview.api.width).toBe(700);
    app.resize(800);
    expect(app.explorer.api.width).toBeLessThan(350);
    expect(app.preview.api.width).toBeLessThan(700);
    app.resize(2200);
    expect(app.explorer.api.width).toBe(350);
    expect(app.preview.api.width).toBe(700);
    expect(app.storage.setItem).not.toHaveBeenCalled();
  });

  it('records the user drag, including widths below the former minimums', () => {
    const app = setup();
    app.start();
    app.explorer.api.width = 180;
    app.preview.api.width = 280;
    app.finish();
    expect(app.storage.setItem).toHaveBeenCalledWith(PANEL_WIDTHS_STORAGE_KEY, JSON.stringify({ explorer: 180, preview: 280 }));
    app.resize(2200);
    expect(app.explorer.api.width).toBe(180);
    expect(app.preview.api.width).toBe(280);
  });

  it('does not replace desktop widths with the full-width phone panel', () => {
    const app = setup(JSON.stringify({ explorer: 180, preview: 280 }));
    app.resize(390, true);
    expect(app.preview.api.setSize).not.toHaveBeenCalled();
    app.resize(1600);
    expect(app.preview.api.width).toBe(280);
  });

  it('does not overwrite the other panel preference when dragging in a compressed window', () => {
    const app = setup(JSON.stringify({ explorer: 350, preview: 700 }));
    app.resize(800);
    app.start();
    app.preview.api.width = 300;
    app.finish();
    app.resize(2200);
    expect(app.explorer.api.width).toBe(350);
    expect(app.preview.api.width).toBe(300);
  });

  it('ignores double clicks in panel content', () => {
    const app = setup();
    app.resize(800);
    app.sash.className = 'editor-content';
    app.sash.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(app.storage.setItem).not.toHaveBeenCalled();
  });

  it('does not fix the width of a panel tabbed with an editor', () => {
    const app = setup();
    app.explorer.api.group.panels.push({ id: 'editor:/shader.glsl' });
    app.resize(2200);
    expect(app.explorer.api.setSize).not.toHaveBeenCalled();
    expect(app.preview.api.width).toBe(560);
  });

  it('leaves a layout without any flexible group filling the workspace', () => {
    const app = setup();
    app.api.panels[1].api.group.api.isVisible = false;
    app.resize(2200);
    expect(app.preview.api.setSize).not.toHaveBeenCalled();
  });

  it.each(['bad JSON', '{"explorer":-1,"preview":560}', '{"explorer":180}', 'null'])('ignores invalid saved widths: %s', (saved) => {
    const app = setup(saved);
    app.resize(2200);
    expect(app.explorer.api.width).toBe(260);
    expect(app.preview.api.width).toBe(560);
  });

  it('keeps resizing usable when preference writes fail', () => {
    const app = setup();
    app.storage.setItem.mockImplementation(() => {
      throw new Error('blocked'); 
    });
    app.start();
    app.preview.api.width = 280;
    expect(app.finish).not.toThrow();
    app.resize(2200);
    expect(app.preview.api.width).toBe(280);
  });

  it('resets preferred widths and releases observers and drag handlers on disposal', () => {
    const app = setup(JSON.stringify({ explorer: 180, preview: 280 }));
    app.sizing.reset();
    expect(app.explorer.api.width).toBe(260);
    expect(app.preview.api.width).toBe(560);
    app.sizing.dispose();
    app.storage.setItem.mockClear();
    app.start();
    app.finish();
    expect(app.storage.setItem).not.toHaveBeenCalled();
    expect(app.disconnect).toHaveBeenCalled();
  });
});
