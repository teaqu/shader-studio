import { writable } from "svelte/store";

export type CompileMode = "hot" | "save" | "manual";

export interface CompileModeState {
  mode: CompileMode;
}

const STORAGE_KEY = "shader-studio-compile-mode";

function isCompileMode(value: unknown): value is CompileMode {
  return value === "hot" || value === "save" || value === "manual";
}

function getInitialState(): CompileModeState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (isCompileMode(parsed?.mode)) {
        return { mode: parsed.mode };
      }
    }
  } catch (error) {
    console.warn("Failed to load compile mode from localStorage:", error);
  }

  return { mode: "hot" };
}

function createCompileModeStore() {
  const { subscribe, set, update } = writable<CompileModeState>(getInitialState());

  const persist = (state: CompileModeState) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn("Failed to save compile mode to localStorage:", error);
    }
  };

  return {
    subscribe,
    setMode: (mode: CompileMode) => {
      const nextState = { mode };
      persist(nextState);
      set(nextState);
    },
    cycleMode: () =>
      update((state) => {
        const nextMode: CompileMode =
          state.mode === "hot" ? "save" : state.mode === "save" ? "manual" : "hot";
        const nextState = { mode: nextMode };
        persist(nextState);
        return nextState;
      }),
  };
}

export const compileModeStore = createCompileModeStore();
