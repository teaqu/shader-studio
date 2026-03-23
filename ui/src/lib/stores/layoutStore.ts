import { writable } from "svelte/store";
import type { SerializedDockview } from "dockview-core";

const STORAGE_KEY_PREFIX = "shader-studio-dockview-layout";

export interface PersistedLayoutState {
  activeLayout: SerializedDockview | null;
  panelSnapshots: Record<string, SerializedDockview>;
}

function storageKey(layoutSlot: string): string {
  return `${STORAGE_KEY_PREFIX}:${layoutSlot}`;
}

function createLayoutStore() {
  const { subscribe, set } = writable<PersistedLayoutState | null>(null);

  return {
    subscribe,
    save(layoutSlot: string, state: PersistedLayoutState) {
      set(state);
      try {
        localStorage.setItem(storageKey(layoutSlot), JSON.stringify(state));
      } catch (error) {
        console.warn("Failed to save layout to localStorage:", error);
      }
    },
    load(layoutSlot: string): PersistedLayoutState | null {
      try {
        const stored = localStorage.getItem(storageKey(layoutSlot));
        if (stored) {
          const parsed = JSON.parse(stored) as PersistedLayoutState | SerializedDockview;
          const state = isPersistedLayoutState(parsed)
            ? parsed
            : { activeLayout: parsed as SerializedDockview, panelSnapshots: {} };
          set(state);
          return state;
        }
      } catch (error) {
        console.warn("Failed to load layout from localStorage:", error);
      }
      return null;
    },
    clear(layoutSlot: string) {
      set(null);
      try {
        localStorage.removeItem(storageKey(layoutSlot));
      } catch (error) {
        console.warn("Failed to clear layout from localStorage:", error);
      }
    },
  };
}

function isPersistedLayoutState(value: PersistedLayoutState | SerializedDockview): value is PersistedLayoutState {
  return typeof value === 'object' && value !== null && ('activeLayout' in value || 'panelSnapshots' in value);
}

export const layoutStore = createLayoutStore();
