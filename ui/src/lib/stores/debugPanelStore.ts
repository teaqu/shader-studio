import { writable } from "svelte/store";

export interface DebugPanelState {
  isVisible: boolean;
  isVariableInspectorEnabled: boolean;
  isInlineRenderingEnabled: boolean;
  isPixelInspectorEnabled: boolean;
}

const STORAGE_KEY = "shader-studio-debug-panel-state";

function createDebugPanelStore() {
  // Start hidden — restoreFromStorage() applies the saved preference once a shader loads
  const { subscribe, set, update } = writable<DebugPanelState>({
    isVisible: true,
    isVariableInspectorEnabled: false,
    isInlineRenderingEnabled: true,
    isPixelInspectorEnabled: true,
  });

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
          set({
            isVisible: parsed.isVisible ?? true,
            isVariableInspectorEnabled: parsed.isVariableInspectorEnabled ?? false,
            isInlineRenderingEnabled: parsed.isInlineRenderingEnabled ?? true,
            isPixelInspectorEnabled: parsed.isPixelInspectorEnabled ?? true,
          });
        }
      } catch (error) {
        console.warn("Failed to restore debug panel state from localStorage:", error);
      }
    },
    setVariableInspectorEnabled: (enabled: boolean) =>
      update((state) => {
        const newState = { ...state, isVariableInspectorEnabled: enabled };
        persist(newState);
        return newState;
      }),
    setInlineRenderingEnabled: (enabled: boolean) =>
      update((state) => {
        const newState = { ...state, isInlineRenderingEnabled: enabled };
        persist(newState);
        return newState;
      }),
    setPixelInspectorEnabled: (enabled: boolean) =>
      update((state) => {
        const newState = { ...state, isPixelInspectorEnabled: enabled };
        persist(newState);
        return newState;
      }),
  };
}

export const debugPanelStore = createDebugPanelStore();
