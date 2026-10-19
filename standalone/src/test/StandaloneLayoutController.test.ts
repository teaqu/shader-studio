import { beforeEach, describe, expect, it, vi } from 'vitest';

it('closes editors whose files were renamed or deleted while keeping unrelated tabs', () => {
  const api = createApi();
  const controller = new StandaloneLayoutController(api, null);
  controller.initialize();
  controller.openEditor('/first.glsl');
  controller.openEditor('/second.glsl');
  controller.closeEditorPaths(['/first.glsl', '/missing.glsl']);
  expect(api.getPanel('editor:/first.glsl')).toBeUndefined();
  expect(api.getPanel('editor:/second.glsl')).toBeDefined();
  expect(api.getPanel('editor')).toBeDefined();
  controller.dispose();
});
import {
  STANDALONE_LAYOUT_STORAGE_KEY,
  StandaloneLayoutController,
  type LayoutStorage,
  type StandaloneDockviewApi,
} from '../StandaloneLayoutController';

it('switches managed files, protects shared preview files and keeps cancelled closes', async () => {
  const api = createApi();
  const navigate = vi.fn();
  const confirm = vi.fn(async (path: string) => path !== '/unsaved.glsl');
  const controller = new StandaloneLayoutController(api, null, navigate, confirm);
  controller.initialize();
  controller.openEditor('/notes.txt');
  controller.openEditor('/previous.glsl');
  navigate.mockClear();
  await controller.syncShaderEditors([{ shaderPath: '/one.glsl', files: ['/one.glsl', '/unsaved.glsl', '/shared.glsl'] },
    { shaderPath: '/two.glsl', files: ['/two.glsl', '/shared.glsl'] }]);
  expect(navigate).not.toHaveBeenCalled();
  expect(api.getPanel('editor:/previous.glsl')).toBeUndefined();
  await controller.syncShaderEditors([{ shaderPath: '/three.glsl', files: ['/three.glsl'] },
    { shaderPath: '/two.glsl', files: ['/two.glsl', '/shared.glsl'] }]);
  expect(api.getPanel('editor:/one.glsl')).toBeUndefined();
  for (const path of ['/unsaved.glsl', '/shared.glsl', '/two.glsl', '/notes.txt', '/three.glsl']) {
    expect(api.getPanel(`editor:${path}`)).toBeDefined();
  }
  expect(confirm).toHaveBeenCalledWith('/unsaved.glsl');
  confirm.mockClear();
  await controller.syncShaderEditors([{ shaderPath: '/three.glsl', files: ['/three.glsl'] }]);
  expect(confirm).not.toHaveBeenCalledWith('/unsaved.glsl');
  await controller.syncShaderEditors(null);
  expect(api.getPanel('editor:/three.glsl')).toBeDefined();
  controller.dispose();
});

function createApi(): StandaloneDockviewApi & { emitLayoutChange(): void; activate(id?: string): void; groupTogether(ids: string[]): void; remove(id: string): void } {
  let listener = () => {};
  let activeListener: (panel: { id: string } | undefined) => void = () => {};
  type TestPanel = {
    id: string;
    api: {
      close(): void;
      group: TestGroup;
      setActive(): void;
      setTitle(title: string): void;
      setSize(size: { width: number }): void;
    };
  };
  type TestGroup = {
    panels: TestPanel[];
    api: { isVisible: boolean; width: number; height: number; setVisible(visible: boolean): void; setSize(size: { width?: number; height?: number }): void };
  };
  const panels = new Map<string, TestPanel>();
  const createGroup = (): TestGroup => {
    const group: TestGroup = {
      panels: [],
      api: {
        isVisible: true,
        width: 300,
        height: 400,
        setVisible: vi.fn((visible: boolean) => {
          group.api.isVisible = visible;
        }),
        setSize: vi.fn((size: { width?: number; height?: number }) => {
          group.api.width = size.width ?? group.api.width;
          group.api.height = size.height ?? group.api.height;
        }),
      },
    };
    return group;
  };
  return {
    get panels() {
      return [...panels.values()];
    },
    addPanel: vi.fn((options: Record<string, unknown>) => {
      const id = options.id as string;
      const position = options.position as { referencePanel: string; direction: string; index?: number } | undefined;
      const group = position?.direction === 'within'
        ? panels.get(position.referencePanel)?.api.group ?? createGroup()
        : createGroup();
      const panel: TestPanel = {
        id,
        api: {
          close: vi.fn(() => {
            panel.api.group.panels = panel.api.group.panels.filter((candidate) => candidate !== panel);
            panels.delete(id);
          }),
          group,
          setActive: vi.fn(),
          setTitle: vi.fn(),
          setSize: vi.fn(),
        },
      };
      group.panels.splice(position?.index ?? group.panels.length, 0, panel);
      panels.set(id, panel);
    }),
    clear: vi.fn(() => panels.clear()),
    fromJSON: vi.fn(),
    getPanel: vi.fn((id: string) => panels.get(id)),
    onDidLayoutChange: vi.fn((next) => {
      listener = next;
      return { dispose: vi.fn() };
    }),
    onDidActivePanelChange: vi.fn((next) => {
      activeListener = next;
      return { dispose: vi.fn(() => {
        activeListener = () => {};
      }) };
    }),
    activate: (id?: string) => activeListener(id ? { id } : undefined),
    toJSON: vi.fn(() => ({ panels: { preview: {} } })),
    emitLayoutChange: () => listener(),
    groupTogether: (ids: string[]) => {
      const group = createGroup();
      group.panels = ids.map((id) => panels.get(id)).filter((panel): panel is TestPanel => Boolean(panel));
      group.panels.forEach((panel) => {
        panel.api.group = group;
      });
    },
    remove: (id: string) => panels.delete(id),
  };
}

function createStorage(initial: Record<string, string> = {}): LayoutStorage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key) => values.get(key) ?? null),
    removeItem: vi.fn((key) => values.delete(key)),
    setItem: vi.fn((key, value) => values.set(key, value)),
  };
}

describe('StandaloneLayoutController', () => {
  it('creates Files as a separate dockable pane below Shader Explorer', () => {
    const api = createApi();
    new StandaloneLayoutController(api, null).initialize();
    expect(api.getPanel('files')).toBeDefined();
    expect(api.addPanel).toHaveBeenCalledWith(expect.objectContaining({
      id: 'files', title: 'Files', position: { referencePanel: 'explorer', direction: 'below' },
    }));
  });
  it('keeps Files closed when a current-version saved layout omits it', () => {
    const api = createApi();
    const storage = createStorage({ [STANDALONE_LAYOUT_STORAGE_KEY]: JSON.stringify({
      filesPaneVersion: 1, panels: { preview: { contentComponent: 'preview' } },
    }) });
    new StandaloneLayoutController(api, storage).initialize();
    expect(api.addPanel).not.toHaveBeenCalled();
  });
  let api: ReturnType<typeof createApi>;
  let storage: LayoutStorage;

  beforeEach(() => {
    api = createApi();
    storage = createStorage();
  });

  it('allows user widths without hard minimums for new and reopened panels', () => {
    const controller = new StandaloneLayoutController(api, storage);
    controller.initialize();
    for (const id of ['explorer', 'preview'] as const) {
      expect(api.addPanel).toHaveBeenCalledWith(expect.objectContaining({ id }));
      api.remove(id);
      controller.showPanel(id);
      expect(api.addPanel).toHaveBeenLastCalledWith(expect.objectContaining({ id }));
      expect(vi.mocked(api.addPanel).mock.calls.at(-1)?.[0]).not.toHaveProperty('minimumWidth');
    }
  });

  it('removes obsolete hard minimums without resetting saved layouts', () => {
    const saved = { panels: {
      preview: { contentComponent: 'preview', minimumWidth: 40 },
      explorer: { contentComponent: 'explorer' },
      editor: { contentComponent: 'editor' },
    }, grid: { width: 1600 } };
    storage = createStorage({ [STANDALONE_LAYOUT_STORAGE_KEY]: JSON.stringify(saved) });
    new StandaloneLayoutController(api, storage).initialize();
    expect(api.fromJSON).toHaveBeenCalledWith({ ...saved, panels: {
      ...saved.panels,
      explorer: { ...saved.panels.explorer },
      preview: { contentComponent: 'preview' },
    } });
    expect(api.addPanel).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'files' }));
  });

  it('removes old minimums and leaves missing panels closed', () => {
    const saved = { panels: { preview: { contentComponent: 'preview', minimumWidth: 480 } } };
    storage = createStorage({ [STANDALONE_LAYOUT_STORAGE_KEY]: JSON.stringify(saved) });
    new StandaloneLayoutController(api, storage).initialize();
    expect(api.fromJSON).toHaveBeenCalledWith({ panels: { preview: { contentComponent: 'preview' } } });
    expect(api.addPanel).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'files' }));
  });
  it('creates the explorer, editor, and preview default outer layout', () => {
    new StandaloneLayoutController(api, storage).initialize();
    expect(api.addPanel).toHaveBeenCalledWith(expect.objectContaining({ id: 'preview', title: 'Preview' }));
    expect(api.addPanel).toHaveBeenCalledWith(expect.objectContaining({ id: 'explorer', initialWidth: 220, position: { referencePanel: 'preview', direction: 'left' } }));
    expect(api.addPanel).toHaveBeenCalledWith(expect.objectContaining({ id: 'editor', initialWidth: 820, position: { referencePanel: 'explorer', direction: 'right' } }));
    expect(api.addPanel).toHaveBeenCalledTimes(4);
    expect(api.getPanel('explorer')?.api.setSize).toHaveBeenCalledWith({ width: 260 });
    expect(api.getPanel('preview')?.api.setSize).toHaveBeenCalledWith({ width: 560 });
    expect(api.getPanel('editor')?.api.setSize).not.toHaveBeenCalled();
  });

  it('sizes the preview by default on reset too, leaving the editor the remaining width', () => {
    const controller = new StandaloneLayoutController(api, storage);
    controller.initialize();
    vi.mocked(api.getPanel('preview')!.api.setSize).mockClear();
    controller.resetLayout();
    expect(api.getPanel('preview')?.api.setSize).toHaveBeenCalledWith({ width: 560 });
    expect(api.getPanel('editor')?.api.setSize).not.toHaveBeenCalled();
  });

  it('does not cap explorer width on creation, reopening, or reset', () => {
    const controller = new StandaloneLayoutController(api, storage);
    controller.initialize();
    api.remove('explorer');
    controller.showPanel('explorer');
    controller.resetLayout();
    expect(api.getPanel('explorer')?.api.setSize).toHaveBeenCalledWith({ width: 260 });
    const explorerCalls = vi.mocked(api.addPanel).mock.calls
      .map(([options]) => options).filter((options) => options.id === 'explorer');
    expect(explorerCalls).toHaveLength(3);
    for (const options of explorerCalls) {
      expect(options).not.toHaveProperty('maximumWidth');
    }
  });

  it('restores a saved modern layout and persists later changes', () => {
    storage = createStorage({ [STANDALONE_LAYOUT_STORAGE_KEY]: JSON.stringify({ panels: { preview: { contentComponent: 'preview' }, editor: { contentComponent: 'editor' } } }) });
    new StandaloneLayoutController(api, storage).initialize();
    expect(api.fromJSON).toHaveBeenCalled();
    expect(api.addPanel).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'files' }));
    api.emitLayoutChange();
    expect(storage.setItem).toHaveBeenCalledWith(STANDALONE_LAYOUT_STORAGE_KEY, expect.any(String));
  });

  it('migrates a saved Viewer layout to Preview without changing its tool arrangement', () => {
    const saved = {
      activePanel: 'viewer',
      grid: {
        type: 'branch',
        data: [
          { type: 'leaf', data: { id: 'group-left', views: ['explorer', 'viewer'], activeView: 'viewer' } },
          { type: 'leaf', data: { id: 'group-right', views: ['editor', 'config', 'debug'], activeView: 'config' } },
        ],
      },
      panels: {
        viewer: { id: 'viewer', contentComponent: 'viewer', title: 'Viewer' },
        explorer: { id: 'explorer', contentComponent: 'explorer', title: 'Shader Explorer' },
        editor: { id: 'editor', contentComponent: 'editor', title: 'Editor' },
        config: { id: 'config', contentComponent: 'config', title: 'Config' },
        debug: { id: 'debug', contentComponent: 'debug', title: 'Debug' },
      },
    };
    storage = createStorage({ [STANDALONE_LAYOUT_STORAGE_KEY]: JSON.stringify(saved) });
    new StandaloneLayoutController(api, storage).initialize();
    expect(api.fromJSON).toHaveBeenCalledWith({
      ...saved,
      activePanel: 'preview',
      grid: {
        ...saved.grid,
        data: [
          { type: 'leaf', data: { id: 'group-left', views: ['explorer', 'preview'], activeView: 'preview' } },
          saved.grid.data[1],
        ],
      },
      panels: {
        preview: { id: 'preview', contentComponent: 'preview', title: 'Preview' },
        explorer: { ...saved.panels.explorer },
        editor: saved.panels.editor,
        config: saved.panels.config,
        debug: saved.panels.debug,
      },
    });
    expect(api.addPanel).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'files' }));
    expect(storage.setItem).toHaveBeenCalledWith(STANDALONE_LAYOUT_STORAGE_KEY, expect.stringContaining('"preview"'));
    expect(storage.setItem).not.toHaveBeenCalledWith(STANDALONE_LAYOUT_STORAGE_KEY, expect.stringContaining('"viewer"'));
  });

  it('restores tools docked alongside shell panels', () => {
    const saved = { panels: Object.fromEntries(
      ['preview', 'editor', 'explorer', 'debug', 'config', 'performance', 'recording', 'vr']
        .map((id) => [id, { contentComponent: id }]),
    ) };
    storage = createStorage({ [STANDALONE_LAYOUT_STORAGE_KEY]: JSON.stringify(saved) });
    new StandaloneLayoutController(api, storage).initialize();
    expect(api.fromJSON).toHaveBeenCalledWith({ ...saved, panels: {
      ...saved.panels,
      preview: { contentComponent: 'preview' },
      explorer: { ...saved.panels.explorer },
    } });
    expect(api.addPanel).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'files' }));
  });

  it('falls back when saved JSON is corrupt or names an unknown panel', () => {
    for (const saved of ['{bad', JSON.stringify({ panels: { unknown: { contentComponent: 'unknown' } } })]) {
      api = createApi(); storage = createStorage({ [STANDALONE_LAYOUT_STORAGE_KEY]: saved });
      new StandaloneLayoutController(api, storage).initialize();
      expect(storage.removeItem).toHaveBeenCalledWith(STANDALONE_LAYOUT_STORAGE_KEY);
      expect(api.addPanel).toHaveBeenCalledTimes(4);
    }
  });

  it('activates an existing panel and recreates a closed panel', () => {
    const controller = new StandaloneLayoutController(api, storage);
    controller.initialize();
    controller.showPanel('preview');
    expect(api.getPanel('preview')?.api.setActive).toHaveBeenCalled();
    api.remove('explorer');
    controller.showPanel('explorer');
    expect(api.addPanel).toHaveBeenCalledTimes(5);
    expect(api.addPanel).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'explorer' }));
  });

  it('hides and restores a standalone panel in its existing split', () => {
    const controller = new StandaloneLayoutController(api, storage);
    controller.initialize();

    expect(controller.isPanelVisible('editor')).toBe(true);
    const editor = api.getPanel('editor');
    controller.togglePanel('editor');
    expect(editor?.api.group.api.setVisible).toHaveBeenCalledWith(false);
    expect(editor?.api.close).not.toHaveBeenCalled();
    expect(controller.isPanelVisible('editor')).toBe(false);

    controller.togglePanel('editor');
    expect(controller.isPanelVisible('editor')).toBe(true);
    expect(editor?.api.group.api.setVisible).toHaveBeenCalledWith(true);
    expect(editor?.api.setActive).toHaveBeenCalledOnce();
    expect(api.addPanel).toHaveBeenCalledTimes(4);
  });

  it('switches phone destinations without remounting panels or persisting the temporary visibility', () => {
    const controller = new StandaloneLayoutController(api, storage);
    controller.initialize();
    const preview = api.getPanel('preview');
    const editor = api.getPanel('editor');

    controller.showMobilePanel('editor');
    expect(controller.getMobilePanel()).toBe('editor');
    expect(preview?.api.group.api.setVisible).toHaveBeenCalledWith(false);
    expect(editor?.api.group.api.setVisible).toHaveBeenCalledWith(true);
    expect(api.addPanel).toHaveBeenCalledTimes(4);
    api.emitLayoutChange();
    expect(storage.setItem).not.toHaveBeenCalled();

    controller.restoreDesktopPanels();
    expect(controller.getMobilePanel()).toBeNull();
    expect(preview?.api.group.api.isVisible).toBe(true);
  });

  it('shows only the requested tool group in phone mode and restores every desktop group', () => {
    const controller = new StandaloneLayoutController(api, storage);
    controller.initialize();
    api.addPanel({ id: 'config' });
    api.addPanel({ id: 'debug' });
    const preview = api.getPanel('preview');
    const config = api.getPanel('config');

    controller.showMobileDockviewPanel('config');

    expect(preview?.api.group.api.isVisible).toBe(false);
    expect(config?.api.group.api.isVisible).toBe(true);
    expect(controller.getMobilePanel()).toBe('config');
    controller.restoreDesktopPanels();
    expect(preview?.api.group.api.isVisible).toBe(true);
  });

  it('keeps a tool first opened on mobile visible in the restored desktop layout', () => {
    const controller = new StandaloneLayoutController(api, storage);
    controller.initialize();
    controller.showMobilePanel('preview');
    api.addPanel({ id: 'config' });

    controller.showMobileDockviewPanel('config');
    controller.restoreDesktopPanels();

    expect(api.getPanel('config')?.api.group.api.isVisible).toBe(true);
    expect(api.getPanel('preview')?.api.group.api.isVisible).toBe(true);
  });

  it('keeps an existing hidden tool group visible after it is opened on mobile', () => {
    const controller = new StandaloneLayoutController(api, storage);
    controller.initialize();
    api.addPanel({ id: 'config' });
    api.getPanel('config')?.api.group.api.setVisible(false);
    controller.showMobilePanel('preview');

    controller.showMobileDockviewPanel('config');
    controller.restoreDesktopPanels();

    expect(api.getPanel('config')?.api.group.api.isVisible).toBe(true);
    expect(api.getPanel('preview')?.api.group.api.isVisible).toBe(true);
  });

  it('restores a newly opened mobile tool group once when it contains several tabs', () => {
    const controller = new StandaloneLayoutController(api, storage);
    controller.initialize();
    controller.showMobilePanel('preview');
    api.addPanel({ id: 'config' });
    api.addPanel({ id: 'debug', position: { referencePanel: 'config', direction: 'within' } });

    controller.showMobileDockviewPanel('debug');
    const toolGroup = api.getPanel('config')!.api.group;
    vi.mocked(toolGroup.api.setVisible).mockClear();
    controller.restoreDesktopPanels();

    expect(toolGroup.api.isVisible).toBe(true);
    expect(toolGroup.api.setVisible).toHaveBeenCalledOnce();
  });

  it('restores a grouped panel to its previous tab group and index', () => {
    const controller = new StandaloneLayoutController(api, storage);
    controller.initialize();
    api.groupTogether(['preview', 'editor']);

    controller.togglePanel('editor');
    expect(controller.isPanelVisible('editor')).toBe(false);
    controller.togglePanel('editor');

    expect(api.addPanel).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 'editor',
      position: { referencePanel: 'preview', direction: 'within', index: 1 },
    }));
  });

  it('resets only the outer layout and clears its stored layout', () => {
    const controller = new StandaloneLayoutController(api, storage);
    controller.initialize();
    controller.resetLayout();
    expect(api.clear).toHaveBeenCalledTimes(1);
    expect(storage.removeItem).toHaveBeenCalledWith(STANDALONE_LAYOUT_STORAGE_KEY);
    expect(api.addPanel).toHaveBeenCalledTimes(8);
  });

  it('falls back cleanly when restoring a valid layout throws after partially applying it', () => {
    storage = createStorage({ [STANDALONE_LAYOUT_STORAGE_KEY]: JSON.stringify({ panels: { preview: { contentComponent: 'preview' } } }) });
    api.fromJSON = vi.fn(() => {
      throw new Error('bad grid');
    });
    new StandaloneLayoutController(api, storage).initialize();
    expect(api.clear).toHaveBeenCalledTimes(1);
    expect(api.addPanel).toHaveBeenCalledTimes(4);
  });

  it('does not throw when reading the browser localStorage global is unavailable', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => {
      throw new Error('blocked');
    } });
    try {
      expect(() => new StandaloneLayoutController(api)).not.toThrow();
    } finally {
      if (descriptor) {
        Object.defineProperty(globalThis, 'localStorage', descriptor);
      } else {
        Reflect.deleteProperty(globalThis, 'localStorage');
      }
    }
  });

  it('rejects a prototype panel ID and a mismatched serialized component', () => {
    for (const saved of [
      '{"panels":{"__proto__":{"contentComponent":"preview"}}}',
      JSON.stringify({ panels: { preview: { contentComponent: 'editor' } } }),
      JSON.stringify({ panels: { viewer: { contentComponent: 'editor' } } }),
    ]) {
      api = createApi();
      storage = createStorage({ [STANDALONE_LAYOUT_STORAGE_KEY]: saved });
      new StandaloneLayoutController(api, storage).initialize();
      expect(api.fromJSON).not.toHaveBeenCalled();
      expect(api.addPanel).toHaveBeenCalledTimes(4);
    }
  });

  it('reopens a panel without a missing reference panel position', () => {
    const controller = new StandaloneLayoutController(api, storage);
    controller.initialize();
    api.remove('explorer');
    api.remove('editor');
    controller.showPanel('editor');
    expect(api.addPanel).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'editor' }));
    expect(api.addPanel).toHaveBeenLastCalledWith(expect.not.objectContaining({ position: expect.anything() }));
  });

  it('tolerates unavailable storage methods and disposes the persistence listener', () => {
    const disposable = { dispose: vi.fn() };
    api.onDidLayoutChange = vi.fn(() => disposable);
    storage = {
      getItem: vi.fn(() => {
        throw new Error('read blocked');
      }),
      removeItem: vi.fn(() => {
        throw new Error('remove blocked');
      }),
      setItem: vi.fn(() => {
        throw new Error('write blocked');
      }),
    };
    const controller = new StandaloneLayoutController(api, storage);
    expect(() => controller.initialize()).not.toThrow();
    expect(() => api.emitLayoutChange()).not.toThrow();
    expect(() => controller.resetLayout()).not.toThrow();
    controller.dispose();
    expect(disposable.dispose).toHaveBeenCalledOnce();
  });
});

describe('file editor panels', () => {
  it('opens distinct dockable files and focuses an existing file without duplicating it', () => {
    const api = createApi();
    const controller = new StandaloneLayoutController(api, null);
    controller.initialize();
    controller.openEditor('/image.glsl');
    controller.openEditor('/buffer.glsl');
    api.getPanel('editor:/image.glsl')?.api.group.api.setVisible(false);
    controller.openEditor('/image.glsl');
    expect(api.getPanel('editor:/image.glsl')?.api.group.api.isVisible).toBe(true);
    expect(api.addPanel).toHaveBeenCalledTimes(6);
    expect(api.addPanel).toHaveBeenCalledWith(expect.objectContaining({
      id: 'editor:/buffer.glsl', component: 'file-editor',
      params: { path: '/buffer.glsl' }, title: 'buffer.glsl',
    }));
    expect(api.getPanel('editor:/image.glsl')?.api.setActive).toHaveBeenCalled();
  });

  it('opens new buffers within the main editor group and activates them', () => {
    const api = createApi();
    const controller = new StandaloneLayoutController(api, null);
    controller.initialize();
    api.getPanel('editor')?.api.group.api.setVisible(false);
    controller.openEditor('/buffer.glsl');
    expect(api.addPanel).toHaveBeenLastCalledWith(expect.objectContaining({
      position: { referencePanel: 'editor', direction: 'within' },
    }));
    expect(api.getPanel('editor')?.api.group.api.isVisible).toBe(true);
    expect(api.getPanel('editor:/buffer.glsl')?.api.group).toBe(api.getPanel('editor')?.api.group);
    expect(api.getPanel('editor:/buffer.glsl')?.api.setActive).toHaveBeenCalled();
  });

  it('reuses a remaining file editor when the main editor has been closed', () => {
    const api = createApi();
    const controller = new StandaloneLayoutController(api, null);
    controller.initialize();
    controller.openEditor('/first.glsl');
    api.remove('editor');
    controller.openEditor('/second.glsl');
    expect(api.addPanel).toHaveBeenLastCalledWith(expect.objectContaining({
      position: { referencePanel: 'editor:/first.glsl', direction: 'within' },
    }));
  });

  it('ignores empty paths and opens an editor when no editor group remains', () => {
    const api = createApi();
    const controller = new StandaloneLayoutController(api, null);
    controller.initialize();
    controller.openEditor('');
    expect(api.addPanel).toHaveBeenCalledTimes(4);
    api.remove('editor');
    controller.openEditor('/buffer.glsl');
    expect(api.addPanel).toHaveBeenLastCalledWith(expect.not.objectContaining({ position: expect.anything() }));
    expect(api.getPanel('editor:/buffer.glsl')?.api.setActive).toHaveBeenCalled();
  });

  it('restores file editor panels with their paths', () => {
    const api = createApi();
    const saved = { panels: { 'editor:/buffer.glsl': {
      contentComponent: 'file-editor', params: { path: '/buffer.glsl' },
    } } };
    const storage = createStorage({ [STANDALONE_LAYOUT_STORAGE_KEY]: JSON.stringify(saved) });
    new StandaloneLayoutController(api, storage).initialize();
    expect(api.fromJSON).toHaveBeenCalledWith(saved);
  });
});

it.each([{}, { path: '' }, { path: 123 }, { path: '/other.glsl' }])('rejects invalid persisted editor parameters %j', (params) => {
  const api = createApi();
  const storage = createStorage({ [STANDALONE_LAYOUT_STORAGE_KEY]: JSON.stringify({ panels: {
    'editor:/buffer.glsl': { contentComponent: 'file-editor', params },
  } }) });
  new StandaloneLayoutController(api, storage).initialize();
  expect(api.fromJSON).not.toHaveBeenCalled();
  expect(api.addPanel).toHaveBeenCalledTimes(4);
});

it('previews the activated file editor and ignores other panels, empty paths, and disposed events', () => {
  const api = createApi();
  const preview = vi.fn();
  const controller = new StandaloneLayoutController(api, null, preview);
  controller.initialize();
  api.activate('editor:/aurora.glsl');
  api.activate('editor:/example.slang');
  expect(preview.mock.calls).toEqual([['/aurora.glsl'], ['/example.slang']]);
  for (const id of ['preview', 'editor', 'explorer', 'config', 'editor:', 'editor:/script.ts', 'editor:/shader.sha.json', undefined]) {
    api.activate(id);
  }
  expect(preview).toHaveBeenCalledTimes(2);
  controller.dispose();
  api.activate('editor:/aurora.glsl');
  expect(preview).toHaveBeenCalledTimes(2);
});

it('names the main editor after its file and retains the name when reopened', () => {
  const api = createApi();
  const controller = new StandaloneLayoutController(api, null);
  controller.initialize();
  controller.setEditorPath('/aurora.glsl');
  expect(api.getPanel('editor')?.api.setTitle).toHaveBeenLastCalledWith('aurora.glsl');
  controller.setEditorPath('/buffer.slang');
  expect(api.getPanel('editor')?.api.setTitle).toHaveBeenLastCalledWith('buffer.slang');
  api.remove('editor');
  controller.showPanel('editor');
  expect(api.addPanel).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'buffer.slang' }));
  controller.setEditorPath('');
  expect(api.getPanel('editor')?.api.setTitle).toHaveBeenLastCalledWith('No file open');
});


describe('shader selection editor targeting', () => {
  it('replaces the last active file editor after explorer takes focus', () => {
    const api = createApi();
    const controller = new StandaloneLayoutController(api, null);
    controller.initialize();
    controller.openEditor('/first.glsl');
    api.activate('editor:/first.glsl');
    api.activate('explorer');
    controller.selectEditor('/next.glsl');
    expect(api.getPanel('editor:/first.glsl')).toBeUndefined();
    expect(api.addPanel).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 'editor:/next.glsl', position: { referencePanel: 'editor:/first.glsl', direction: 'within', index: 1 },
    }));
    expect(api.getPanel('editor:/next.glsl')?.api.setActive).toHaveBeenCalled();
  });

  it('reuses an existing target without closing the previous editor', () => {
    const api = createApi();
    const controller = new StandaloneLayoutController(api, null);
    controller.initialize();
    controller.openEditor('/first.glsl');
    controller.openEditor('/next.glsl');
    api.activate('editor:/first.glsl');
    controller.selectEditor('/next.glsl');
    expect(api.getPanel('editor:/first.glsl')).toBeDefined();
    expect(api.panels).toHaveLength(6);
    expect(api.getPanel('editor:/next.glsl')?.api.setActive).toHaveBeenCalled();
  });

  it.each(['editor', 'closed'])('falls back to the main editor for %s', (active) => {
    const api = createApi();
    const controller = new StandaloneLayoutController(api, null);
    controller.initialize();
    controller.openEditor('/first.glsl');
    api.activate('editor:/first.glsl');
    if (active === 'closed') {
      api.remove('editor:/first.glsl');
    } else {
      api.activate('editor');
    }
    controller.selectEditor('/next.glsl');
    expect(api.getPanel('editor')?.api.setActive).toHaveBeenCalled();
    expect(api.getPanel('editor:/next.glsl')).toBeUndefined();
  });
});


it('uses the restored active file editor for selection and ignores empty paths', () => {
  const api = createApi();
  api.addPanel({ id: 'editor:/restored.glsl' });
  Object.defineProperty(api, 'activePanel', { value: api.getPanel('editor:/restored.glsl') });
  const storage = createStorage({ [STANDALONE_LAYOUT_STORAGE_KEY]: JSON.stringify({ panels: {} }) });
  const controller = new StandaloneLayoutController(api, storage);
  controller.initialize();
  vi.mocked(api.addPanel).mockClear();
  controller.selectEditor('');
  expect(api.addPanel).not.toHaveBeenCalled();
  controller.selectEditor('/next.glsl');
  expect(api.getPanel('editor:/restored.glsl')).toBeUndefined();
  expect(api.getPanel('editor:/next.glsl')).toBeDefined();
});


it.each([0, 1, 2])('keeps a replaced editor at tab index %i', (index) => {
  const api = createApi();
  const controller = new StandaloneLayoutController(api, null);
  controller.initialize();
  const ids = ['/first.glsl', '/middle.glsl', '/last.glsl'].map((path) => {
    controller.openEditor(path);
    return `editor:${path}`;
  });
  api.groupTogether(ids);
  api.activate(ids[index]);
  api.activate('explorer');
  controller.selectEditor('/replacement.glsl');
  const expected = [...ids];
  expected[index] = 'editor:/replacement.glsl';
  expect(api.getPanel('editor:/replacement.glsl')?.api.group.panels.map((panel) => panel.id)).toEqual(expected);
});

describe('phone shell editor panel', () => {
  it('shows the active file editor once the shader selection has replaced the main editor', () => {
    const api = createApi();
    const controller = new StandaloneLayoutController(api, null);
    controller.initialize();
    controller.openEditor('/first.glsl');
    api.activate('editor:/first.glsl');
    controller.selectEditor('/next.glsl');
    api.remove('editor');
    api.activate('explorer');

    controller.showMobilePanel('editor');

    const editor = api.getPanel('editor:/next.glsl')!;
    expect(editor.api.group.api.isVisible).toBe(true);
    expect(editor.api.setActive).toHaveBeenCalled();
    expect(api.getPanel('explorer')?.api.group.api.isVisible).toBe(false);
    expect(controller.getMobilePanel()).toBe('editor');
  });

  it('falls back to any open file editor when the remembered one was closed', () => {
    const api = createApi();
    const controller = new StandaloneLayoutController(api, null);
    controller.initialize();
    controller.openEditor('/first.glsl');
    controller.openEditor('/second.glsl');
    api.activate('editor:/second.glsl');
    api.remove('editor:/second.glsl');
    api.remove('editor');

    controller.showMobilePanel('editor');

    expect(api.getPanel('editor:/first.glsl')?.api.group.api.isVisible).toBe(true);
    expect(controller.getMobilePanel()).toBe('editor');
  });

  it('leaves the phone shell alone when no editor is open at all', () => {
    const api = createApi();
    const controller = new StandaloneLayoutController(api, null);
    controller.initialize();
    api.remove('editor');

    controller.showMobilePanel('editor');

    expect(controller.getMobilePanel()).toBeNull();
    expect(api.getPanel('preview')?.api.group.api.isVisible).toBe(true);
  });
});

describe('opening editors from the phone shell', () => {
  function onPhoneExplorer() {
    const api = createApi();
    const controller = new StandaloneLayoutController(api, null);
    controller.initialize();
    controller.showMobilePanel('explorer');
    const editorGroup = api.getPanel('editor')!.api.group;
    return { api, controller, editorGroup };
  }

  it('selects the main editor without showing it beside the Explorer', () => {
    const { api, controller, editorGroup } = onPhoneExplorer();

    controller.selectEditor('/picked.glsl');

    expect(api.getPanel('editor')?.api.setActive).toHaveBeenCalled();
    expect(editorGroup.api.isVisible).toBe(false);
    expect(api.getPanel('explorer')?.api.group.api.isVisible).toBe(true);
    controller.restoreDesktopPanels();
    expect(editorGroup.api.isVisible).toBe(true);
  });

  it('replaces the active file editor without showing it beside the Explorer', () => {
    const api = createApi();
    const controller = new StandaloneLayoutController(api, null);
    controller.initialize();
    controller.openEditor('/first.glsl');
    api.activate('editor:/first.glsl');
    controller.showMobilePanel('explorer');
    const editorGroup = api.getPanel('editor:/first.glsl')!.api.group;

    controller.selectEditor('/next.glsl');

    expect(api.getPanel('editor:/next.glsl')?.api.setActive).toHaveBeenCalled();
    expect(editorGroup.api.isVisible).toBe(false);
    controller.showMobilePanel('editor');
    expect(api.getPanel('editor:/next.glsl')?.api.group.api.isVisible).toBe(true);
    expect(api.getPanel('explorer')?.api.group.api.isVisible).toBe(false);
  });

  it('activates an already open file editor without showing it beside the Explorer', () => {
    const { api, controller, editorGroup } = onPhoneExplorer();
    controller.openEditor('/open.glsl');
    vi.mocked(api.getPanel('editor:/open.glsl')!.api.setActive).mockClear();

    controller.selectEditor('/open.glsl');
    controller.openEditor('/open.glsl');

    expect(api.getPanel('editor:/open.glsl')?.api.setActive).toHaveBeenCalledTimes(2);
    expect(editorGroup.api.isVisible).toBe(false);
  });

  it('opens a new file editor in the hidden editor group', () => {
    const { api, controller, editorGroup } = onPhoneExplorer();

    controller.openEditor('/notes.txt');

    expect(api.getPanel('editor:/notes.txt')?.api.group).toBe(editorGroup);
    expect(editorGroup.api.isVisible).toBe(false);
    controller.restoreDesktopPanels();
    expect(editorGroup.api.isVisible).toBe(true);
  });

  it('keeps a desktop editor that was hidden before the phone shell visible after one is opened', () => {
    const api = createApi();
    const controller = new StandaloneLayoutController(api, null);
    controller.initialize();
    const editorGroup = api.getPanel('editor')!.api.group;
    editorGroup.api.setVisible(false);
    controller.showMobilePanel('explorer');

    controller.openEditor('/notes.txt');
    controller.restoreDesktopPanels();

    expect(editorGroup.api.isVisible).toBe(true);
  });
});

describe('leaving the phone shell', () => {
  it('puts every desktop group back at the size it had before phone mode', () => {
    const api = createApi();
    const controller = new StandaloneLayoutController(api, null);
    controller.initialize();
    const explorer = api.getPanel('explorer')!.api.group;
    const files = api.getPanel('files')!.api.group;
    explorer.api.height = 520;
    files.api.height = 240;

    controller.showMobilePanel('files');
    // Re-showing a group lets Dockview squeeze its stacked neighbour.
    explorer.api.height = 60;
    files.api.height = 700;
    const layout = vi.fn(() => {
      // Sizes only stick once Dockview is laid out with every group visible.
      expect(explorer.api.isVisible).toBe(true);
      expect(explorer.api.setSize).not.toHaveBeenCalled();
    });
    controller.restoreDesktopPanels(layout);

    expect(layout).toHaveBeenCalledOnce();
    expect(explorer.api.isVisible).toBe(true);
    expect(explorer.api.height).toBe(520);
    expect(files.api.height).toBe(240);
    expect(explorer.api.width).toBe(300);
  });

  it('leaves a group first opened on the phone at Dockview\'s own size', () => {
    const api = createApi();
    const controller = new StandaloneLayoutController(api, null);
    controller.initialize();
    controller.showMobilePanel('preview');
    api.addPanel({ id: 'config' });
    const config = api.getPanel('config')!.api.group;

    controller.showMobileDockviewPanel('config');
    controller.restoreDesktopPanels();

    expect(config.api.isVisible).toBe(true);
    expect(config.api.setSize).not.toHaveBeenCalled();
  });
});
