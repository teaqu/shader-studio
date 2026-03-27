import { writable } from 'svelte/store';
import type { ResolutionSettings } from '@shader-studio/types';

export interface ResolutionState {
    scale: number;           // 0.25, 0.5, 1, 2, 4
    customWidth?: string;    // "512" (px) or "50%" (percentage)
    customHeight?: string;
    forceBlackBackground: boolean;
    savedToConfig: boolean;  // whether these settings are pinned to the shader config
}

const STORAGE_KEY = 'shader-studio-resolution';
const OLD_QUALITY_KEY = 'shader-studio-quality';

/**
 * Parse a dimension string like "512", "512px", or "50%".
 * Returns resolved pixel value given a reference size (for %).
 * Returns undefined if invalid.
 */
export function parseDimension(value: string, referenceSize: number): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.endsWith('%')) {
    const pct = parseFloat(trimmed);
    if (isNaN(pct) || pct <= 0) {
      return undefined;
    }
    return Math.round(referenceSize * pct / 100);
  }

  // Strip optional "px" suffix
  const num = parseFloat(trimmed.replace(/px$/i, ''));
  if (isNaN(num) || num <= 0) {
    return undefined;
  }
  return Math.round(num);
}

function loadInitialState(): ResolutionState {
  const defaultState: ResolutionState = { scale: 1, forceBlackBackground: false, savedToConfig: false };

  if (typeof window === 'undefined') {
    return defaultState;
  }

  // Try new key first
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed.scale === 'number') {
        return { ...defaultState, ...parsed, savedToConfig: false };
      }
    } catch (e) {
      console.warn('Failed to parse stored resolution setting');
    }
  }

  // Migrate old quality key
  const oldStored = localStorage.getItem(OLD_QUALITY_KEY);
  if (oldStored) {
    try {
      const parsed = JSON.parse(oldStored);
      if (parsed?.mode === 'SD') {
        const migrated = { ...defaultState, scale: 0.5 };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        localStorage.removeItem(OLD_QUALITY_KEY);
        return migrated;
      } else if (parsed?.mode === 'HD') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultState));
        localStorage.removeItem(OLD_QUALITY_KEY);
        return defaultState;
      }
    } catch (e) {
      // ignore
    }
  }

  return defaultState;
}

function persistGlobal(state: ResolutionState): void {
  if (typeof window === 'undefined') {
    return;
  }
  const toStore: Partial<ResolutionState> = {
    scale: state.scale,
    forceBlackBackground: state.forceBlackBackground,
  };
  if (state.customWidth !== undefined && state.customHeight !== undefined) {
    toStore.customWidth = state.customWidth;
    toStore.customHeight = state.customHeight;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
}

const createResolutionStore = () => {
  const initial = loadInitialState();
  const { subscribe, set, update } = writable<ResolutionState>(initial);
  let current = initial;

  // Keep current in sync with all store changes
  subscribe(s => {
    current = s; 
  });

  return {
    subscribe,
    setScale: (scale: number) => {
      update(state => {
        const newState: ResolutionState = {
          ...state,
          scale,
          customWidth: undefined,
          customHeight: undefined,
        };
        if (!newState.savedToConfig) {
          persistGlobal(newState); 
        }
        return newState;
      });
    },
    setCustomResolution: (width: string, height: string) => {
      update(state => {
        const newState: ResolutionState = {
          ...state,
          customWidth: width,
          customHeight: height,
        };
        if (!newState.savedToConfig) {
          persistGlobal(newState); 
        }
        return newState;
      });
    },
    clearCustomResolution: () => {
      update(state => {
        const newState: ResolutionState = {
          ...state,
          customWidth: undefined,
          customHeight: undefined,
        };
        if (!newState.savedToConfig) {
          persistGlobal(newState); 
        }
        return newState;
      });
    },
    setFromConfig: (settings?: ResolutionSettings) => {
      if (settings) {
        const next: ResolutionState = {
          scale: settings.scale ?? 1,
          customWidth: settings.customWidth !== undefined ? String(settings.customWidth) : undefined,
          customHeight: settings.customHeight !== undefined ? String(settings.customHeight) : undefined,
          forceBlackBackground: current.forceBlackBackground,
          savedToConfig: true,
        };
        // Skip if store already matches
        if (current.scale === next.scale && current.customWidth === next.customWidth &&
                    current.customHeight === next.customHeight && current.savedToConfig) {
          return;
        }
        set(next);
      } else {
        // No config — fall back to global defaults (skip if already there)
        if (!current.savedToConfig) {
          return; 
        }
        set({ ...loadInitialState(), savedToConfig: false });
      }
    },
    setSavedToConfig: (saved: boolean) => {
      update(state => ({ ...state, savedToConfig: saved }));
    },
    setForceBlackBackground: (forceBlackBackground: boolean) => {
      update(state => {
        const newState: ResolutionState = {
          ...state,
          forceBlackBackground,
        };
        if (!newState.savedToConfig) {
          persistGlobal(newState);
        }
        return newState;
      });
    },
    reset: () => {
      update(state => {
        const newState: ResolutionState = {
          scale: 1,
          forceBlackBackground: false,
          savedToConfig: state.savedToConfig,
        };
        if (!newState.savedToConfig) {
          persistGlobal(newState);
        }
        return newState;
      });
    },
  };
};

export const resolutionStore = createResolutionStore();
