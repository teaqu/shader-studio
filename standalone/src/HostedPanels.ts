import {
  type DockviewApi,
  type DockviewIDisposable,
  type GroupPanelPartInitParameters,
  type IContentRenderer,
} from 'dockview-core';
import type { HostedPanelDefinition, HostedPanelId, PanelHost } from '@shader-studio/ui/lib/layout/PanelHost';

const titles: Record<HostedPanelId, string> = {
  debug: 'Debug',
  config: 'Config',
  performance: 'Frame Times',
  recording: 'Export',
};

class HostedPanelRenderer implements IContentRenderer {
  readonly element = document.createElement('div');
  private cleanup: (() => void) | null = null;

  constructor(
    private readonly host: HostedPanels,
    readonly id: HostedPanelId,
  ) {
    this.element.className = 'standalone-panel-content';
  }

  init(_parameters: GroupPanelPartInitParameters): void {
    this.host.activateRenderer(this);
  }

  attach(definition: HostedPanelDefinition): void {
    this.detach();
    const cleanup = definition.mount(this.element);
    this.cleanup = typeof cleanup === 'function' ? cleanup : null;
  }

  detach(): void {
    this.cleanup?.();
    this.cleanup = null;
    this.element.replaceChildren();
  }

  dispose(): void {
    this.detach();
    this.host.rendererDisposed(this);
  }
}

/** Bridges preview tool panels into the standalone Dockview shell. */
export class HostedPanels implements PanelHost {
  private api: DockviewApi | null = null;
  private removeListener: DockviewIDisposable | null = null;
  private readonly definitions = new Map<HostedPanelId, HostedPanelDefinition>();
  private readonly visible = new Set<HostedPanelId>();
  private readonly renderers = new Map<HostedPanelId, HostedPanelRenderer>();
  private suppressClose = 0;
  private resetDefaultLayout: () => void = () => {};

  connect(api: DockviewApi, resetDefaultLayout: () => void = () => {}): void {
    this.removeListener?.dispose();
    this.api = api;
    this.resetDefaultLayout = resetDefaultLayout;
    this.removeListener = api.onDidRemovePanel((panel) => this.panelRemoved(panel.id));
  }

  createRenderer(id: HostedPanelId): IContentRenderer {
    return new HostedPanelRenderer(this, id);
  }

  register(id: HostedPanelId, definition: HostedPanelDefinition): () => void {
    this.definitions.set(id, definition);
    this.renderers.get(id)?.attach(definition);
    if (this.api?.getPanel(id)) {
      this.visible.add(id);
      definition.onRestore?.();
    }

    return () => {
      if (this.definitions.get(id) !== definition) {
        return;
      }
      this.definitions.delete(id);
      this.renderers.get(id)?.detach();
    };
  }

  setVisible(id: HostedPanelId, visible: boolean): void {
    if (visible) {
      this.visible.add(id);
      this.addPanel(id);
      return;
    }

    this.visible.delete(id);
    const panel = this.api?.getPanel(id);
    if (panel && this.api) {
      this.suppressClose++;
      try {
        this.api.removePanel(panel);
      } finally {
        this.suppressClose--;
      }
    }
  }

  restoreVisiblePanels(): void {
    for (const [id, definition] of this.definitions) {
      if (this.api?.getPanel(id)) {
        this.visible.add(id);
        definition.onRestore?.();
      }
    }
    for (const id of this.visible) {
      if (!this.api?.getPanel(id)) {
        this.addPanel(id);
      }
    }
  }

  showPreview(): void {
    const panel = this.api?.getPanel('preview');
    if (panel) {
      panel.api.setActive();
    } else {
      this.api?.addPanel({ id: 'preview', component: 'preview', title: 'Preview', renderer: 'always' });
    }
  }

  resetLayout(run: () => void = this.resetDefaultLayout): void {
    this.suppressClose++;
    try {
      run();
    } finally {
      this.suppressClose--;
    }
    this.restoreVisiblePanels();
  }

  dispose(): void {
    this.removeListener?.dispose();
    this.removeListener = null;
    this.api = null;
    for (const renderer of this.renderers.values()) {
      renderer.detach();
    }
    this.renderers.clear();
  }

  activateRenderer(renderer: HostedPanelRenderer): void {
    const previous = this.renderers.get(renderer.id);
    if (previous !== renderer) {
      previous?.detach();
      this.renderers.set(renderer.id, renderer);
    }
    const definition = this.definitions.get(renderer.id);
    if (definition) {
      renderer.attach(definition);
    }
  }

  rendererDisposed(renderer: HostedPanelRenderer): void {
    if (this.renderers.get(renderer.id) === renderer) {
      this.renderers.delete(renderer.id);
    }
  }

  private addPanel(id: HostedPanelId): void {
    if (!this.api || this.api.getPanel(id)) {
      return;
    }
    // Tools share a tab group, including panels restored before registration.
    // Insert Config first without removing or moving the existing group.
    const toolReference = (['config', 'debug', 'performance', 'recording'] as const)
      .find((candidate) => candidate !== id && this.api?.getPanel(candidate));
    const referencePanel = toolReference ?? (this.api.getPanel('preview') ? 'preview' : undefined);
    this.api.addPanel({
      id,
      component: id,
      title: titles[id],
      renderer: 'always',
      ...(referencePanel ? {
        position: {
          referencePanel,
          direction: toolReference ? 'within' : 'below',
          ...(toolReference && id === 'config' ? { index: 0 } : {}),
        },
      } : {}),
    });
  }

  private panelRemoved(id: string): void {
    if (!isHostedPanelId(id) || this.suppressClose > 0 || !this.visible.delete(id)) {
      return;
    }
    this.definitions.get(id)?.onClose();
  }
}

function isHostedPanelId(id: string): id is HostedPanelId {
  return id === 'debug' || id === 'config' || id === 'performance' || id === 'recording';
}
