import { writable } from 'svelte/store';
import type { AspectRatioMode } from '@shader-studio/types';
export type { AspectRatioMode } from '@shader-studio/types';

export type AspectRatioSource = 'session' | 'config';

export interface AspectRatioState {
    mode: AspectRatioMode;
    source: AspectRatioSource;
}

const STORAGE_KEY = 'shader-studio-aspect-ratio';
const VALID_MODES: AspectRatioMode[] = ['16:9', '4:3', '1:1', 'fill', 'auto'];
const DEFAULT_MODE: AspectRatioMode = 'auto';
const SESSION_SOURCE: AspectRatioSource = 'session';
const CONFIG_SOURCE: AspectRatioSource = 'config';

function loadStoredMode(): AspectRatioMode {
  if (typeof window === 'undefined') {
    return DEFAULT_MODE;
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed && VALID_MODES.includes(parsed.mode)) {
        return parsed.mode;
      }
    } catch (e) {
      console.warn('Failed to parse stored aspect ratio setting');
    }
  }
  return DEFAULT_MODE;
}

const createAspectRatioStore = () => {
  const storedMode = loadStoredMode();
  let currentMode: AspectRatioMode = storedMode;
  let currentSource: AspectRatioSource = SESSION_SOURCE;

  const { subscribe, set, update } = writable<AspectRatioState>({
    mode: storedMode,
    source: SESSION_SOURCE,
  });

  const commit = (mode: AspectRatioMode, source: AspectRatioSource) => {
    currentMode = mode;
    currentSource = source;
    set({ mode, source });
  };

  return {
    subscribe,
    setMode: (mode: AspectRatioMode) => {
      if (currentMode === mode && currentSource === SESSION_SOURCE) {
        return;
      }
      commit(mode, SESSION_SOURCE);
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode }));
      }
    },
    setFromConfig: (mode?: AspectRatioMode) => {
      if (mode !== undefined) {
        // Has a value — ignore if invalid
        if (!VALID_MODES.includes(mode)) {
          return;
        }
        if (currentMode === mode && currentSource === CONFIG_SOURCE) {
          return;
        }
        commit(mode, CONFIG_SOURCE);
      } else {
        // No config — fall back to global defaults (skip if already there)
        if (currentSource !== CONFIG_SOURCE) {
          return;
        }
        const defaultMode = loadStoredMode();
        commit(defaultMode, SESSION_SOURCE);
      }
    },
    setSessionMode: (mode?: AspectRatioMode) => {
      const nextMode = mode && VALID_MODES.includes(mode) ? mode : DEFAULT_MODE;
      if (currentMode === nextMode && currentSource === SESSION_SOURCE) {
        return;
      }
      commit(nextMode, SESSION_SOURCE);
    },
    reset: () => {
      commit(DEFAULT_MODE, SESSION_SOURCE);
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: DEFAULT_MODE }));
      }
    }
  };
};

export const aspectRatioStore = createAspectRatioStore();

// Helper function to get aspect ratio value
export const getAspectRatio = (mode: AspectRatioMode): number | null => {
  switch (mode) {
    case '16:9':
      return 16 / 9;
    case '4:3':
      return 4 / 3;
    case '1:1':
      return 1;
    case 'fill':
      return null;
    case 'auto':
      return null;
    default:
      return 16 / 9;
  }
};
