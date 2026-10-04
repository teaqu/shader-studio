import type { DockviewApi } from 'dockview-core';
import type { LayoutStorage } from './StandaloneLayoutController';

export const PANEL_WIDTHS_STORAGE_KEY = 'shader-studio.standalone-panel-widths.v1';
const defaults = { explorer: 260, preview: 560 };
type PanelWidths = typeof defaults;

/** Keeps user-selected side widths separate from temporary viewport compression. */
export class StandalonePanelSizing {
  private widths: PanelWidths;
  private observer: ResizeObserver | null = null;
  private dragging = false;
  private dragWidths: Partial<PanelWidths> = {};
  private storage: LayoutStorage | null;

  constructor(
    private readonly api: Pick<DockviewApi, 'panels' | 'getPanel' | 'layout'>,
    private readonly element: HTMLElement,
    private readonly isMobile: () => boolean,
    storage?: LayoutStorage | null,
  ) {
    try {
      this.storage = storage === undefined ? globalThis.localStorage : storage;
    } catch {
      this.storage = null;
    }
    this.widths = this.loadWidths();
    this.element.addEventListener('mousedown', this.startDrag);
    this.element.addEventListener('pointerdown', this.startDrag);
    this.element.addEventListener('dblclick', this.finishDrag);
    document.addEventListener('mouseup', this.finishDrag);
    document.addEventListener('pointerup', this.finishDrag);
    document.addEventListener('pointercancel', this.finishDrag);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.refresh());
      this.observer.observe(element);
    }
  }

  refresh(): void {
    const width = this.element.clientWidth;
    this.api.layout(width, this.element.clientHeight);
    if (this.isMobile() || this.dragging || width <= 0) {
      return;
    }
    const panels = this.fixedPanels();
    const fixedGroups = new Set(panels.map((panel) => panel.api.group));
    const flexibleGroups = new Set(this.api.panels
      .filter((panel) => panel.api.group.api.isVisible && !fixedGroups.has(panel.api.group))
      .map((panel) => panel.api.group));
    // With no editor or other flexible group, let the remaining panels fill the workspace.
    if (!flexibleGroups.size) {
      return;
    }
    const available = Math.max(0, width - flexibleGroups.size * 100 - (fixedGroups.size + flexibleGroups.size - 1) * 4);
    const requested = panels.reduce((sum, panel) => sum + this.widths[panel.id as keyof PanelWidths], 0);
    const scale = requested > available ? available / requested : 1;
    for (const panel of panels) {
      panel.api.setSize({ width: Math.round(this.widths[panel.id as keyof PanelWidths] * scale) });
    }
  }

  reset(): void {
    this.widths = { ...defaults };
    this.saveWidths();
    this.refresh();
  }

  dispose(): void {
    this.observer?.disconnect();
    this.element.removeEventListener('mousedown', this.startDrag);
    this.element.removeEventListener('pointerdown', this.startDrag);
    this.element.removeEventListener('dblclick', this.finishDrag);
    document.removeEventListener('mouseup', this.finishDrag);
    document.removeEventListener('pointerup', this.finishDrag);
    document.removeEventListener('pointercancel', this.finishDrag);
  }

  private fixedPanels() {
    return Object.keys(defaults).flatMap((id) => {
      const panel = this.api.getPanel(id);
      return panel?.api.group.api.isVisible && !panel.api.group.panels.some((candidate) =>
        candidate.id === 'editor' || candidate.id.startsWith('editor:')) ? [panel] : [];
    }).filter((panel, index, panels) => panels.findIndex((candidate) => candidate.api.group === panel.api.group) === index);
  }

  private startDrag = (event: Event): void => {
    if (!this.isMobile() && event.target instanceof Element && event.target.closest('.dv-sash')) {
      this.dragging = true;
      this.dragWidths = Object.fromEntries(this.fixedPanels().map((panel) => [panel.id, panel.api.width]));
    }
  };

  private finishDrag = (event: Event): void => {
    if (event.type === 'dblclick' && !(event.target instanceof Element && event.target.closest('.dv-sash'))) {
      return;
    }
    if (!this.dragging && event.type !== 'dblclick') {
      return;
    }
    this.dragging = false;
    if (this.isMobile()) {
      return;
    }
    for (const panel of this.fixedPanels()) {
      const previous = this.dragWidths[panel.id as keyof PanelWidths];
      if (panel.api.width > 0 && (event.type === 'dblclick' || previous !== panel.api.width)) {
        this.widths[panel.id as keyof PanelWidths] = panel.api.width;
      }
    }
    this.saveWidths();
  };

  private loadWidths(): PanelWidths {
    try {
      const saved = this.storage?.getItem(PANEL_WIDTHS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as PanelWidths;
        if (Object.keys(defaults).every((id) => Number.isFinite(parsed?.[id as keyof PanelWidths]) && parsed[id as keyof PanelWidths] > 0)) {
          return parsed;
        }
      }
    } catch { /* Blocked storage and corrupt preferences use the current layout. */ }
    const widths = { ...defaults };
    if (this.element.clientWidth >= 1000 && !this.isMobile()) {
      for (const panel of this.fixedPanels()) {
        if (panel.api.width > 0) {
          widths[panel.id as keyof PanelWidths] = panel.api.width;
        }
      }
    }
    return widths;
  }

  private saveWidths(): void {
    try {
      this.storage?.setItem(PANEL_WIDTHS_STORAGE_KEY, JSON.stringify(this.widths));
    } catch { /* Resizing remains usable when browser storage is unavailable. */ }
  }
}
