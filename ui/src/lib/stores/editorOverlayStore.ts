import { createSlotPersistedStore } from "./createSlotPersistedStore";

export interface EditorOverlayState {
  isVisible: boolean;
  vimMode: boolean;
}

const STORAGE_KEY = "shader-studio-editor-overlay-state";
const DEFAULT_STATE: EditorOverlayState = { isVisible: false, vimMode: false };

function createEditorOverlayStore() {
  const store = createSlotPersistedStore<EditorOverlayState>({
    storageKey: STORAGE_KEY,
    defaultState: DEFAULT_STATE,
    loadErrorMessage: "Failed to load editor overlay state from localStorage:",
    saveErrorMessage: "Failed to save editor overlay state to localStorage:",
    parseStoredState: (parsed, defaultState) => {
      const state = parsed as Partial<EditorOverlayState> | null;
      return {
        isVisible: state?.isVisible ?? defaultState.isVisible,
        vimMode: state?.vimMode ?? defaultState.vimMode,
      };
    },
  });

  return {
    subscribe: store.subscribe,
    setLayoutSlot: store.setLayoutSlot,
    restoreFromStorage: store.restoreFromStorage,
    toggle: () =>
      store.updateAndPersist((state) => ({ ...state, isVisible: !state.isVisible })),
    setVisible: (visible: boolean) =>
      store.updateAndPersist((state) => ({ ...state, isVisible: visible })),
    toggleVimMode: () =>
      store.updateAndPersist((state) => ({ ...state, vimMode: !state.vimMode })),
  };
}

export const editorOverlayStore = createEditorOverlayStore();
