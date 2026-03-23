import { writable, type Updater } from "svelte/store";

interface SlotPersistedStoreOptions<T> {
  storageKey: string;
  defaultState: T;
  loadErrorMessage: string;
  saveErrorMessage: string;
  parseStoredState: (parsed: unknown, defaultState: T) => T;
}

export function createSlotPersistedStore<T>(options: SlotPersistedStoreOptions<T>) {
  const { storageKey, defaultState, loadErrorMessage, saveErrorMessage, parseStoredState } = options;
  let layoutSlot: string | null = null;
  const { subscribe, set, update } = writable<T>(defaultState);

  const getStorageKey = () => (layoutSlot ? `${storageKey}:${layoutSlot}` : storageKey);

  const persist = (state: T) => {
    try {
      localStorage.setItem(getStorageKey(), JSON.stringify(state));
    } catch (error) {
      console.warn(saveErrorMessage, error);
    }
  };

  const updateAndPersist = (updater: Updater<T>) =>
    update((state) => {
      const nextState = updater(state);
      persist(nextState);
      return nextState;
    });

  return {
    subscribe,
    set,
    update,
    setLayoutSlot: (slot: string | null) => {
      layoutSlot = slot;
      set(defaultState);
    },
    restoreFromStorage: () => {
      try {
        const stored = localStorage.getItem(getStorageKey());
        if (!stored) {
          set(defaultState);
          return;
        }

        const parsed = JSON.parse(stored);
        set(parseStoredState(parsed, defaultState));
      } catch (error) {
        console.warn(loadErrorMessage, error);
        set(defaultState);
      }
    },
    persist,
    updateAndPersist,
  };
}
