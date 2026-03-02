import { writable } from "svelte/store";

export interface DebugPanelState {
  isVisible: boolean;
}

const STORAGE_KEY = "shader-studio-debug-panel-state";

function createDebugPanelStore() {
  const getInitialState = (): DebugPanelState => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return { isVisible: parsed.isVisible ?? true };
      }
    } catch (error) {
      console.warn("Failed to load debug panel state from localStorage:", error);
    }
    return { isVisible: true };
  };

  const { subscribe, set, update } = writable<DebugPanelState>(getInitialState());

  const persist = (state: DebugPanelState) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn("Failed to save debug panel state to localStorage:", error);
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
  };
}

export const debugPanelStore = createDebugPanelStore();
