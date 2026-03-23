import { createSlotPersistedStore } from "./createSlotPersistedStore";

export interface ConfigPanelState {
  isVisible: boolean;
}

const STORAGE_KEY = "shader-studio-config-panel-state";
const DEFAULT_STATE: ConfigPanelState = { isVisible: false };

function createConfigPanelStore() {
  // Start hidden — restoreFromStorage() applies the saved preference once a shader loads
  const store = createSlotPersistedStore<ConfigPanelState>({
    storageKey: STORAGE_KEY,
    defaultState: DEFAULT_STATE,
    loadErrorMessage: "Failed to restore config panel state from localStorage:",
    saveErrorMessage: "Failed to save config panel state to localStorage:",
    parseStoredState: (parsed, defaultState) => {
      const state = parsed as Partial<ConfigPanelState> | null;
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

export const configPanelStore = createConfigPanelStore();
