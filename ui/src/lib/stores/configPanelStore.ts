import { writable } from "svelte/store";

export interface ConfigPanelState {
  isVisible: boolean;
}

const STORAGE_KEY = "shader-studio-config-panel-state";

function createConfigPanelStore() {
  const getInitialState = (): ConfigPanelState => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return { isVisible: parsed.isVisible ?? false };
      }
    } catch (error) {
      console.warn("Failed to load config panel state from localStorage:", error);
    }
    return { isVisible: false };
  };

  const { subscribe, set, update } = writable<ConfigPanelState>(getInitialState());

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
  };
}

export const configPanelStore = createConfigPanelStore();
