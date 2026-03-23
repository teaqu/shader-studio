import { createSlotPersistedStore } from "./createSlotPersistedStore";

export interface DebugPanelState {
  isVisible: boolean;
  isVariableInspectorEnabled: boolean;
  isInlineRenderingEnabled: boolean;
  isPixelInspectorEnabled: boolean;
}

const STORAGE_KEY = "shader-studio-debug-panel-state";
const DEFAULT_STATE: DebugPanelState = {
  isVisible: false,
  isVariableInspectorEnabled: false,
  isInlineRenderingEnabled: true,
  isPixelInspectorEnabled: true,
};

function createDebugPanelStore() {
  // Start hidden — restoreFromStorage() applies the saved preference once a shader loads
  const store = createSlotPersistedStore<DebugPanelState>({
    storageKey: STORAGE_KEY,
    defaultState: DEFAULT_STATE,
    loadErrorMessage: "Failed to restore debug panel state from localStorage:",
    saveErrorMessage: "Failed to save debug panel state to localStorage:",
    parseStoredState: (parsed, defaultState) => {
      const state = parsed as Partial<DebugPanelState> | null;
      return {
        isVisible: state?.isVisible ?? defaultState.isVisible,
        isVariableInspectorEnabled: state?.isVariableInspectorEnabled ?? defaultState.isVariableInspectorEnabled,
        isInlineRenderingEnabled: state?.isInlineRenderingEnabled ?? defaultState.isInlineRenderingEnabled,
        isPixelInspectorEnabled: state?.isPixelInspectorEnabled ?? defaultState.isPixelInspectorEnabled,
      };
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
    setVariableInspectorEnabled: (enabled: boolean) =>
      store.updateAndPersist((state) => ({ ...state, isVariableInspectorEnabled: enabled })),
    setInlineRenderingEnabled: (enabled: boolean) =>
      store.updateAndPersist((state) => ({ ...state, isInlineRenderingEnabled: enabled })),
    setPixelInspectorEnabled: (enabled: boolean) =>
      store.updateAndPersist((state) => ({ ...state, isPixelInspectorEnabled: enabled })),
  };
}

export const debugPanelStore = createDebugPanelStore();
