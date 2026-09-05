export const STANDALONE_LAYOUT_STORAGE_KEY = 'shader-studio.standalone-layout.v1';

export type StandalonePanelId = 'explorer' | 'editor' | 'preview';

interface Disposable {
  dispose(): void;
}

interface PanelGroup {
  panels: Panel[];
  api: {
    isVisible: boolean;
    setVisible(visible: boolean): void;
  };
}

interface Panel {
  id: string;
  api: {
    close(): void;
    group: PanelGroup;
    setActive(): void;
    setTitle(title: string): void;
    setSize(size: { width: number }): void;
  };
}

interface PanelRestoration {
  tabOrder: string[];
}

export interface StandaloneDockviewApi {
  readonly panels: Panel[];
  readonly activePanel?: Panel;
  addPanel(options: Record<string, unknown>): void;
  clear(): void;
  fromJSON(layout: unknown): void;
  getPanel(id: string): Panel | undefined;
  onDidActivePanelChange(listener: (panel: { id: string } | undefined) => void): Disposable;
  onDidLayoutChange(listener: () => void): Disposable;
  toJSON(): unknown;
}

export interface LayoutStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

const panelDefinitions: Record<StandalonePanelId, { title: string; position?: Record<string, string>; initialWidth?: number }> = {
  preview: { title: 'Preview' },
  explorer: { title: 'Shader Explorer', position: { referencePanel: 'preview', direction: 'left' }, initialWidth: 220 },
  editor: { title: 'No file open', position: { referencePanel: 'explorer', direction: 'right' }, initialWidth: 820 },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value)
    && typeof value === 'object'
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function migrateGridViewerReferences(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(migrateGridViewerReferences);
  }
  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    if (key === 'views' && Array.isArray(child)) {
      return [key, child.map((view) => view === 'viewer' ? 'preview' : view)];
    }
    if (key === 'activeView' && child === 'viewer') {
      return [key, 'preview'];
    }
    return [key, migrateGridViewerReferences(child)];
  }));
}

/**
 * The storage key remains v1, so old standalone layouts need an in-place
 * schema migration rather than a reset. Only the retired outer Viewer panel
 * is renamed; every group, tool, and split stays where the user put it.
 */
function migrateLegacyViewerLayout(value: unknown): { layout: unknown; migrated: boolean } {
  if (!isRecord(value) || !isRecord(value.panels) || !Object.hasOwn(value.panels, 'viewer')) {
    return { layout: value, migrated: false };
  }

  const panels = Object.fromEntries(Object.entries(value.panels).map(([panelId, panel]) => {
    if (panelId !== 'viewer' || !isRecord(panel)) {
      return [panelId, panel];
    }
    return ['preview', {
      ...panel,
      id: 'preview',
      contentComponent: panel.contentComponent === 'viewer' ? 'preview' : panel.contentComponent,
      title: 'Preview',
    }];
  }));

  return {
    migrated: true,
    layout: {
      ...value,
      ...(value.activePanel === 'viewer' ? { activePanel: 'preview' } : {}),
      ...(Object.hasOwn(value, 'grid') ? { grid: migrateGridViewerReferences(value.grid) } : {}),
      panels,
    },
  };
}

function isRestorableLayout(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const panels = (value as { panels?: unknown }).panels;
  if (!panels || typeof panels !== 'object' || (Object.getPrototypeOf(panels) !== Object.prototype && Object.getPrototypeOf(panels) !== null)) {
    return false;
  }

  return Object.entries(panels).every(([id, panel]) => {
    if (isRecord(panel) && panel.contentComponent === 'file-editor') {
      return isRecord(panel.params) && typeof panel.params.path === 'string'
        && panel.params.path.length > 0 && id === `editor:${panel.params.path}`;
    }
    const known = Object.prototype.hasOwnProperty.call(panelDefinitions, id)
      || ['debug', 'config', 'performance', 'recording'].includes(id);
    if (!known || !panel || typeof panel !== 'object') {
      return false;
    }
    const component = (panel as { contentComponent?: unknown }).contentComponent;
    return component === id;
  });
}

function getBrowserStorage(): LayoutStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Owns only the standalone shell's Dockview state and persistence. */
export class StandaloneLayoutController {
  private activePanelDisposable: Disposable | null = null;
  private editorTitle = 'No file open';
  private activeEditorId = 'editor';
  private layoutChangeDisposable: Disposable | null = null;
  private readonly panelRestorations = new Map<StandalonePanelId, PanelRestoration>();
  private readonly storage: LayoutStorage | null;

  constructor(
    private readonly api: StandaloneDockviewApi,
    storage?: LayoutStorage | null,
    private readonly previewEditor?: (path: string) => void,
  ) {
    this.storage = storage === undefined ? getBrowserStorage() : storage;
  }

  initialize(): void {
    if (!this.restoreLayout()) {
      this.createDefaultLayout();
    }
    this.activeEditorId = this.api.activePanel?.id.startsWith('editor:') ? this.api.activePanel.id : 'editor';
    this.activePanelDisposable = this.api.onDidActivePanelChange((panel) => {
      if (panel?.id === 'editor' || panel?.id.startsWith('editor:')) {
        this.activeEditorId = panel.id;
      }
      const path = panel?.id.startsWith('editor:') ? panel.id.slice('editor:'.length) : '';
      if (/\.(glsl|frag|slang)$/i.test(path)) {
        this.previewEditor?.(path);
      }
    });
    this.layoutChangeDisposable = this.api.onDidLayoutChange(() => this.persistLayout());
  }

  setEditorPath(path: string): void {
    this.editorTitle = path.split('/').pop() || 'No file open';
    this.api.getPanel('editor')?.api.setTitle(this.editorTitle);
  }

  dispose(): void {
    this.activePanelDisposable?.dispose();
    this.activePanelDisposable = null;
    this.layoutChangeDisposable?.dispose();
    this.layoutChangeDisposable = null;
  }

  showPanel(panelId: StandalonePanelId): void {
    const existing = this.api.getPanel(panelId);
    if (existing) {
      existing.api.group.api.setVisible(true);
      existing.api.setActive();
      return;
    }
    this.addPanel(panelId);
  }

  selectEditor(path: string): void {
    if (!path) {
      return;
    }
    const existing = this.api.getPanel(`editor:${path}`);
    if (existing) {
      existing.api.group.api.setVisible(true);
      existing.api.setActive();
      return;
    }
    const active = this.api.getPanel(this.activeEditorId);
    if (!active || active.id === 'editor') {
      this.showPanel('editor');
      return;
    }
    active.api.group.api.setVisible(true);
    this.api.addPanel({
      id: `editor:${path}`, component: 'file-editor', title: path.split('/').pop() || path,
      params: { path }, renderer: 'always',
      position: { referencePanel: active.id, direction: 'within', index: active.api.group.panels.indexOf(active) },
    });
    active.api.close();
    this.api.getPanel(`editor:${path}`)?.api.setActive();
  }

  openEditor(path: string): void {
    if (!path) {
      return;
    }
    const id = `editor:${path}`;
    const existing = this.api.getPanel(id);
    if (existing) {
      existing.api.group.api.setVisible(true);
      existing.api.setActive();
      return;
    }
    const reference = this.api.getPanel('editor')
      ?? this.api.panels.find((panel) => panel.id.startsWith('editor:'));
    reference?.api.group.api.setVisible(true);
    this.api.addPanel({
      id, component: 'file-editor', title: path.split('/').pop() || path,
      params: { path }, renderer: 'always',
      ...(reference ? { position: { referencePanel: reference.id, direction: 'within' } } : {}),
    });
    this.api.getPanel(id)?.api.setActive();
  }

  isPanelVisible(panelId: StandalonePanelId): boolean {
    const panel = this.api.getPanel(panelId);
    return Boolean(panel?.api.group.api.isVisible);
  }

  togglePanel(panelId: StandalonePanelId): void {
    const existing = this.api.getPanel(panelId);
    if (existing) {
      if (!existing.api.group.api.isVisible) {
        existing.api.group.api.setVisible(true);
        existing.api.setActive();
        return;
      }
      if (existing.api.group.panels.length === 1) {
        existing.api.group.api.setVisible(false);
        return;
      }
      this.panelRestorations.set(panelId, {
        tabOrder: existing.api.group.panels.map((panel) => panel.id),
      });
      existing.api.close();
      return;
    }
    this.addPanel(panelId);
  }

  resetLayout(): void {
    this.panelRestorations.clear();
    this.removeStoredLayout();
    this.api.clear();
    this.createDefaultLayout();
  }

  private createDefaultLayout(): void {
    this.addPanel('preview');
    this.addPanel('explorer');
    this.addPanel('editor');
    // Adding splits redistributes widths; apply the defaults after all panels exist.
    // Explorer and preview take fixed defaults so the editor keeps the remaining width.
    this.api.getPanel('explorer')?.api.setSize({ width: 260 });
    this.api.getPanel('preview')?.api.setSize({ width: 560 });
  }

  private addPanel(panelId: StandalonePanelId): void {
    const definition = panelDefinitions[panelId];
    const restoration = this.panelRestorations.get(panelId);
    const restoredReference = restoration?.tabOrder
      .map((id) => this.api.getPanel(id))
      .find((panel): panel is Panel => Boolean(panel));
    const restoredIndex = restoration && restoredReference
      ? restoration.tabOrder
        .slice(0, restoration.tabOrder.indexOf(panelId))
        .filter((id) => this.api.getPanel(id)?.api.group === restoredReference.api.group)
        .length
      : undefined;
    const defaultReference = definition.position?.referencePanel;
    const position = restoredReference
      ? { referencePanel: restoredReference.id, direction: 'within', index: restoredIndex }
      : defaultReference && this.api.getPanel(defaultReference)
        ? definition.position
        : undefined;
    this.api.addPanel({
      id: panelId,
      component: panelId,
      title: panelId === 'editor' ? this.editorTitle : definition.title,
      renderer: 'always',
      ...(position ? { position } : {}),
      ...(definition.initialWidth ? { initialWidth: definition.initialWidth } : {}),
    });
    this.panelRestorations.delete(panelId);
  }

  private restoreLayout(): boolean {
    if (!this.storage) {
      return false;
    }

    try {
      const saved = this.storage.getItem(STANDALONE_LAYOUT_STORAGE_KEY);
      if (!saved) {
        return false;
      }
      const parsedLayout = JSON.parse(saved);
      const { layout, migrated } = migrateLegacyViewerLayout(parsedLayout);
      if (!isRestorableLayout(layout)) {
        this.removeStoredLayout();
        return false;
      }
      this.api.fromJSON(layout);
      if (migrated) {
        this.writeLayout(layout);
      }
      return true;
    } catch {
      this.api.clear();
      this.removeStoredLayout();
      return false;
    }
  }

  private persistLayout(): void {
    this.writeLayout(this.api.toJSON());
  }

  private writeLayout(layout: unknown): void {
    try {
      this.storage?.setItem(STANDALONE_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // Persistence is an enhancement; quota and privacy failures must not affect the shell.
    }
  }

  private removeStoredLayout(): void {
    try {
      this.storage?.removeItem(STANDALONE_LAYOUT_STORAGE_KEY);
    } catch {
      // Storage may be disabled by browser privacy settings.
    }
  }
}
