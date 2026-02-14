import { writable } from "svelte/store";

export interface ConfigPanelState {
  isVisible: boolean;
  splitRatio: number; // 0.0 to 1.0 - represents canvas section size
}

const STORAGE_KEY = "shader-studio-config-panel-state";

function createConfigPanelStore() {
  // Load initial state from localStorage or use defaults
  const getInitialState = (): ConfigPanelState => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.warn("Failed to load config panel state from localStorage:", error);
    }
    return { isVisible: false, splitRatio: 0.6 };
  };

  const { subscribe, set, update } = writable<ConfigPanelState>(getInitialState());

  // Helper to persist state
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
    setSplitRatio: (ratio: number) =>
      update((state) => {
        // Clamp ratio between 0.3 and 0.9
        const clampedRatio = Math.max(0.3, Math.min(0.9, ratio));
        const newState = { ...state, splitRatio: clampedRatio };
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
