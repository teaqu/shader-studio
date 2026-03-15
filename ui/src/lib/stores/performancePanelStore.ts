import { writable } from "svelte/store";

export interface PerformancePanelState {
  isVisible: boolean;
}

const STORAGE_KEY = "shader-studio-performance-panel-state";

function createPerformancePanelStore() {
  const { subscribe, set, update } = writable<PerformancePanelState>({ isVisible: false });

  const persist = (state: PerformancePanelState) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn("Failed to save performance panel state to localStorage:", error);
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
        console.warn("Failed to restore performance panel state from localStorage:", error);
      }
    },
  };
}

export const performancePanelStore = createPerformancePanelStore();
