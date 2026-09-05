/** Optional shell-owned docking for the viewer's tool panels. */
export const PANEL_HOST_CONTEXT = Symbol('shader-studio-panel-host');

export type HostedPanelId = 'debug' | 'config' | 'performance' | 'recording';

export interface HostedPanelDefinition {
  mount(container: HTMLElement): void | (() => void);
  onClose(): void;
  onRestore?(): void;
}

export interface PanelHost {
  register(id: HostedPanelId, definition: HostedPanelDefinition): () => void;
  setVisible(id: HostedPanelId, visible: boolean): void;
  resetLayout?(): void;
  showPreview?(): void;
}
