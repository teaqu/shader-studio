import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DockviewApi } from 'dockview-core';
import { HostedPanels } from '../HostedPanels';

type Renderer = ReturnType<HostedPanels['createRenderer']>;

function createApi() {
  const panels = new Map<string, { id: string; api: { setActive: ReturnType<typeof vi.fn> } }>();
  let removed: (panel: { id: string }) => void = () => {};
  const api = {
    addPanel: vi.fn((options: { id: string }) => {
      panels.set(options.id, { id: options.id, api: { setActive: vi.fn() } });
    }),
    getPanel: vi.fn((id: string) => panels.get(id)),
    removePanel: vi.fn((panel: { id: string }) => {
      panels.delete(panel.id);
      removed(panel);
    }),
    onDidRemovePanel: vi.fn((listener: (panel: { id: string }) => void) => {
      removed = listener;
      return { dispose: vi.fn() };
    }),
    addExisting(id: string) {
      panels.set(id, { id, api: { setActive: vi.fn() } });
    },
    removeAsUser(id: string) {
      const panel = panels.get(id);
      if (panel) {
        panels.delete(id);
        removed(panel);
      }
    },
  };
  return { api: api as unknown as DockviewApi, panels, ...api };
}

function init(renderer: Renderer): void {
  renderer.init({} as never);
}

describe('HostedPanels', () => {
  let host: HostedPanels;
  let dock: ReturnType<typeof createApi>;

  beforeEach(() => {
    host = new HostedPanels();
    dock = createApi();
    host.connect(dock.api);
    dock.addExisting('preview');
  });

  it('attaches a panel registered after its restored renderer', () => {
    const renderer = host.createRenderer('debug');
    init(renderer);
    const mount = vi.fn(() => vi.fn());

    host.register('debug', { mount, onClose: vi.fn() });

    expect(mount).toHaveBeenCalledWith(renderer.element);
  });

  it('restores registered panels already present in a saved Dockview layout', () => {
    dock.addExisting('debug');
    const onRestore = vi.fn();

    host.register('debug', { mount: vi.fn(), onClose: vi.fn(), onRestore });
    host.restoreVisiblePanels();

    expect(onRestore).toHaveBeenCalledTimes(2);
    expect(dock.addPanel).not.toHaveBeenCalled();
  });

  it('attaches a registered panel when its renderer is created later', () => {
    const mount = vi.fn(() => vi.fn());
    host.register('config', { mount, onClose: vi.fn() });
    const renderer = host.createRenderer('config');

    init(renderer);

    expect(mount).toHaveBeenCalledWith(renderer.element);
  });

  it('adds and programmatically removes hosted panels without stealing focus on repeated visibility updates', () => {
    const onClose = vi.fn();
    host.register('debug', { mount: vi.fn(), onClose });

    host.setVisible('debug', true);
    expect(dock.addPanel).toHaveBeenCalledWith(expect.objectContaining({
      id: 'debug', component: 'debug', title: 'Debug', renderer: 'always',
      position: { referencePanel: 'preview', direction: 'below' },
    }));
    host.setVisible('debug', true);
    expect(dock.panels.get('debug')?.api.setActive).not.toHaveBeenCalled();
    host.setVisible('debug', false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each([
    ['config', 'debug'],
    ['debug', 'config'],
    ['performance', 'debug'],
    ['recording', 'config'],
  ] as const)('opens %s and %s in the same tool group', (first, second) => {
    host.setVisible(first, true);
    host.setVisible(second, true);
    expect(dock.addPanel).toHaveBeenLastCalledWith(expect.objectContaining({
      id: second,
      position: { referencePanel: first, direction: 'within', ...(second === 'config' ? { index: 0 } : {}) },
    }));
    host.setVisible(second, false);
    host.setVisible(second, true);
    expect(dock.addPanel).toHaveBeenLastCalledWith(expect.objectContaining({
      position: { referencePanel: first, direction: 'within', ...(second === 'config' ? { index: 0 } : {}) },
    }));
  });

  it('joins a restored tool even before its visibility registration', () => {
    dock.addExisting('debug');
    host.setVisible('config', true);
    expect(dock.addPanel).toHaveBeenLastCalledWith(expect.objectContaining({
      position: { referencePanel: 'debug', direction: 'within', index: 0 },
    }));
  });

  it('opens tools without Preview and without any existing panel', () => {
    dock.removeAsUser('preview');
    host.setVisible('debug', true);
    expect(dock.addPanel.mock.calls.at(-1)?.[0]).not.toHaveProperty('position');
    host.setVisible('config', true);
    expect(dock.addPanel).toHaveBeenLastCalledWith(expect.objectContaining({
      position: { referencePanel: 'debug', direction: 'within', index: 0 },
    }));
  });

  it('notifies a registered panel when the user closes its Dockview tab', () => {
    const onClose = vi.fn();
    host.register('performance', { mount: vi.fn(), onClose });
    host.setVisible('performance', true);

    dock.removeAsUser('performance');

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('activates Preview or reopens it without a Viewer wrapper', () => {
    host.showPreview();
    expect(dock.panels.get('preview')?.api.setActive).toHaveBeenCalledOnce();
    dock.removeAsUser('preview');
    host.showPreview();
    expect(dock.addPanel).toHaveBeenCalledWith({
      id: 'preview', component: 'preview', title: 'Preview', renderer: 'always',
    });
  });

  it('delegates Preview menu reset to the workspace while preserving tool visibility', () => {
    const reset = vi.fn(() => dock.removeAsUser('config'));
    host.connect(dock.api, reset);
    const onClose = vi.fn();
    host.register('config', { mount: vi.fn(), onClose });
    host.setVisible('config', true);
    host.resetLayout();
    expect(reset).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    expect(dock.panels.has('config')).toBe(true);
  });

  it('does not let disposal of an older renderer detach a newer renderer', () => {
    const cleanup = vi.fn();
    const mount = vi.fn(() => cleanup);
    host.register('recording', { mount, onClose: vi.fn() });
    const older = host.createRenderer('recording');
    init(older);
    const newer = host.createRenderer('recording');
    init(newer);

    older.dispose?.();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(newer.element.childElementCount).toBe(0);
    host.register('recording', { mount, onClose: vi.fn() });
    expect(mount).toHaveBeenLastCalledWith(newer.element);
  });

  it('keeps visible panels through a reset and cleans listeners without closing panels on dispose', () => {
    const onClose = vi.fn();
    host.register('config', { mount: vi.fn(), onClose });
    host.setVisible('config', true);

    host.resetLayout(() => {
      dock.removeAsUser('config');
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(dock.addPanel).toHaveBeenCalledTimes(2);
    host.dispose();
    expect(onClose).not.toHaveBeenCalled();
    expect(dock.onDidRemovePanel.mock.results[0].value.dispose).toHaveBeenCalledOnce();
  });
});
