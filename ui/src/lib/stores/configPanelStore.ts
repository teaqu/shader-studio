import { writable } from "svelte/store";

export interface ConfigPanelState {
  isVisible: boolean;
}

const STORAGE_KEY = "shader-studio-config-panel-state";

function createConfigPanelStore() {
  // Start hidden — restoreFromStorage() applies the saved preference once a shader loads
  const { subscribe, set, update } = writable<ConfigPanelState>({ isVisible: false });

  const persist = (state: ConfigPanelState) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn("Failed to save config panel state to localStorage:", error);
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
          if (parsed.isVisible) {
            set({ isVisible: true });
          }
        }
      } catch (error) {
        console.warn("Failed to restore config panel state from localStorage:", error);
      }
    },
  };
}

export const configPanelStore = createConfigPanelStore();
