const STORAGE_KEY = "shader-studio-editor-overlay-state";

let layoutSlot = $state<string | null>(null);
let isVisible = $state(false);
let vimMode = $state(false);
let activeFile = $state('Image');

function getStorageKey(): string {
  return layoutSlot ? `${STORAGE_KEY}:${layoutSlot}` : STORAGE_KEY;
}

function persist(): void {
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify({ isVisible, vimMode }));
  } catch (e) {
    console.warn("Failed to save editor overlay state to localStorage:", e);
  }
}

export function getEditorOverlayVisible(): boolean {
  return isVisible;
}

export function getVimMode(): boolean {
  return vimMode;
}

export function getOverlayActiveFile(): string {
  return activeFile;
}

export function setOverlayActiveFile(name: string): void {
  activeFile = name;
}

export function setEditorOverlayVisible(visible: boolean): void {
  isVisible = visible;
  persist();
}

export function toggleEditorOverlay(): void {
  isVisible = !isVisible;
  persist();
}

export function setVimMode(v: boolean): void {
  vimMode = v;
  persist();
}

export function toggleVimMode(): void {
  vimMode = !vimMode;
  persist();
}

export function setLayoutSlot(slot: string | null): void {
  layoutSlot = slot;
  isVisible = false;
  vimMode = false;
  activeFile = 'Image';
}

export function restoreFromStorage(): void {
  try {
    const stored = localStorage.getItem(getStorageKey());
    if (!stored) {
      isVisible = false;
      vimMode = false;
      return;
    }
    const parsed = JSON.parse(stored) as Partial<{ isVisible: boolean; vimMode: boolean }> | null;
    isVisible = parsed?.isVisible ?? false;
    vimMode = parsed?.vimMode ?? false;
  } catch (e) {
    console.warn("Failed to load editor overlay state from localStorage:", e);
    isVisible = false;
    vimMode = false;
  }
}
