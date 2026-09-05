export type StandalonePanel = 'explorer' | 'editor' | 'preview';

let newShaderVisible = $state(false);
let requestedPanel = $state<StandalonePanel | null>(null);

export function getNewShaderVisible(): boolean {
  return newShaderVisible;
}

export function setNewShaderVisible(visible: boolean): void {
  newShaderVisible = visible;
}

export function getRequestedPanel(): StandalonePanel | null {
  return requestedPanel;
}

export function requestPanel(panel: StandalonePanel | null): void {
  requestedPanel = panel;
}

export function resetShellState(): void {
  requestedEditor = null;
  selectedEditor = null;
  newShaderVisible = false;
  requestedPanel = null;
}

let requestedEditor = $state<string | null>(null);
export function getRequestedEditor(): string | null {
  return requestedEditor;
}
export function requestEditor(path: string | null): void {
  requestedEditor = path;
}

let selectedEditor = $state<string | null>(null);
export function getSelectedEditor(): string | null {
  return selectedEditor;
}
export function selectEditor(path: string | null): void {
  selectedEditor = path;
}
