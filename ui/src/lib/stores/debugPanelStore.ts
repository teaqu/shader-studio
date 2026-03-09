import { writable } from "svelte/store";

export interface DebugPanelState {
  isVisible: boolean;
}

const STORAGE_KEY = "shader-studio-debug-panel-state";

function createDebugPanelStore() {
  // Start hidden — restoreFromStorage() applies the saved preference once a shader loads
  const { subscribe, set, update } = writable<DebugPanelState>({ isVisible: true });

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
    restoreFromStorage: () => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          const visible = parsed.isVisible ?? true;
          set({ isVisible: visible });
        }
      } catch (error) {
        console.warn("Failed to restore debug panel state from localStorage:", error);
      }
    },
  };
}

export const debugPanelStore = createDebugPanelStore();
