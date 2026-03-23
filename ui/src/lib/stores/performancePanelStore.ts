import { createSlotPersistedStore } from "./createSlotPersistedStore";

export interface PerformancePanelState {
  isVisible: boolean;
}

const STORAGE_KEY = "shader-studio-performance-panel-state";
const DEFAULT_STATE: PerformancePanelState = { isVisible: false };

function createPerformancePanelStore() {
  const store = createSlotPersistedStore<PerformancePanelState>({
    storageKey: STORAGE_KEY,
    defaultState: DEFAULT_STATE,
    loadErrorMessage: "Failed to restore performance panel state from localStorage:",
    saveErrorMessage: "Failed to save performance panel state to localStorage:",
    parseStoredState: (parsed, defaultState) => {
      const state = parsed as Partial<PerformancePanelState> | null;
      return state?.isVisible ? { isVisible: true } : defaultState;
    },
  });

  return {
    subscribe: store.subscribe,
    setLayoutSlot: store.setLayoutSlot,
    toggle: () =>
      store.updateAndPersist((state) => ({ ...state, isVisible: !state.isVisible })),
    setVisible: (visible: boolean) =>
      store.updateAndPersist((state) => ({ ...state, isVisible: visible })),
    restoreFromStorage: store.restoreFromStorage,
  };
}

export const performancePanelStore = createPerformancePanelStore();
