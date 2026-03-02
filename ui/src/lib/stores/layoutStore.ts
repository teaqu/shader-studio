import { writable } from "svelte/store";
import type { SerializedDockview } from "dockview-core";

const STORAGE_KEY = "shader-studio-dockview-layout";

function createLayoutStore() {
  const { subscribe, set } = writable<SerializedDockview | null>(null);

  return {
    subscribe,
    save(layout: SerializedDockview) {
      set(layout);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
      } catch (error) {
        console.warn("Failed to save layout to localStorage:", error);
      }
    },
    load(): SerializedDockview | null {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const layout = JSON.parse(stored) as SerializedDockview;
          set(layout);
          return layout;
        }
      } catch (error) {
        console.warn("Failed to load layout from localStorage:", error);
      }
      return null;
    },
    clear() {
      set(null);
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (error) {
        console.warn("Failed to clear layout from localStorage:", error);
      }
    },
  };
}

export const layoutStore = createLayoutStore();
