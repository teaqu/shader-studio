import { writable } from "svelte/store";

export interface EditorOverlayState {
  isVisible: boolean;
  vimMode: boolean;
}

const STORAGE_KEY = "shader-studio-editor-overlay-state";

function createEditorOverlayStore() {
  const getInitialState = (): EditorOverlayState => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.warn("Failed to load editor overlay state from localStorage:", error);
    }
    return { isVisible: false, vimMode: false };
  };

  const { subscribe, update } = writable<EditorOverlayState>(getInitialState());

  const persist = (state: EditorOverlayState) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn("Failed to save editor overlay state to localStorage:", error);
    }
  };

  return {
    subscribe,
    toggle: () =>
      update((state) => {
        const newState = { ...state, isVisible: !state.isVisible };
        persist(newState);
        return newState;
      }),
    setVisible: (visible: boolean) =>
      update((state) => {
        const newState = { ...state, isVisible: visible };
        persist(newState);
        return newState;
      }),
    toggleVimMode: () =>
      update((state) => {
        const newState = { ...state, vimMode: !state.vimMode };
        persist(newState);
        return newState;
      }),
  };
}

export const editorOverlayStore = createEditorOverlayStore();
