export type StandalonePanel = 'explorer' | 'files' | 'editor' | 'preview';

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
  activeShaderEditors = null;
  requestedEditor = null;
  selectedEditor = null;
  newShaderVisible = false;
  requestedPanel = null;
}

export interface ActiveShaderEditorSet {
  id: string;
  shaderPath: string;
  files: string[];
}
let activeShaderEditors = $state<ActiveShaderEditorSet[] | null>(null);
export function getActiveShaderEditors(): ActiveShaderEditorSet[] | null {
  return activeShaderEditors;
}
export function setActiveShaderEditors(value: ActiveShaderEditorSet[] | null): void {
  activeShaderEditors = value;
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
