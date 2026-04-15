import { writable } from 'svelte/store';
import type { ResolutionSettings } from '@shader-studio/types';

export type ResolutionSource = 'session' | 'config';

export interface ResolutionState {
    scale: number;           // 0.25, 0.5, 1, 2, 4
    customWidth?: string;    // "512" or "512px"
    customHeight?: string;
    forceBlackBackground: boolean;
    source: ResolutionSource;
}

const STORAGE_KEY = 'shader-studio-resolution';
const OLD_QUALITY_KEY = 'shader-studio-quality';
const SESSION_SOURCE: ResolutionSource = 'session';
const CONFIG_SOURCE: ResolutionSource = 'config';

/**
 * Parse a dimension string like "512" or "512px".
 * Returns undefined if invalid.
 */
export function parseDimension(value: string, _referenceSize: number): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (!/^\d+(\.\d+)?(px)?$/i.test(trimmed)) {
    return undefined;
  }

  // Strip optional "px" suffix
  const num = parseFloat(trimmed.replace(/px$/i, ''));
  if (isNaN(num) || num <= 0) {
    return undefined;
  }
  return Math.round(num);
}

function normalizeStoredDimension(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const normalized = parseDimension(String(value), 0);
  return normalized !== undefined ? String(value).trim() : undefined;
}

function loadInitialState(): ResolutionState {
  const defaultState: ResolutionState = {
    scale: 1,
    forceBlackBackground: false,
    source: SESSION_SOURCE,
  };

  if (typeof window === 'undefined') {
    return defaultState;
  }

  // Try new key first
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed.scale === 'number') {
        const customWidth = normalizeStoredDimension(parsed.customWidth);
        const customHeight = normalizeStoredDimension(parsed.customHeight);
        return {
          ...defaultState,
          ...parsed,
          customWidth,
          customHeight,
          source: SESSION_SOURCE,
        };
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

function createStateFromSettings(
  settings: Partial<ResolutionSettings> | undefined,
  forceBlackBackground: boolean,
  source: ResolutionSource,
): ResolutionState {
  return {
    scale: settings?.scale ?? 1,
    customWidth: normalizeStoredDimension(settings?.customWidth),
    customHeight: normalizeStoredDimension(settings?.customHeight),
    forceBlackBackground,
    source,
  };
}

const createResolutionStore = () => {
  const initial = loadInitialState();
  const { subscribe, set, update } = writable<ResolutionState>(initial);
  let current = initial;

  // Keep current in sync with all store changes
  subscribe(s => {
    current = s; 
  });

  const commit = (next: ResolutionState) => {
    current = next;
    set(next);
  };

  return {
    subscribe,
    setScale: (scale: number) => {
      update(state => {
        const newState: ResolutionState = {
          ...state,
          scale,
          source: SESSION_SOURCE,
        };
        persistGlobal(newState);
        return newState;
      });
    },
    setCustomResolution: (width: string, height: string) => {
      update(state => {
        const newState: ResolutionState = {
          ...state,
          customWidth: width,
          customHeight: height,
          source: SESSION_SOURCE,
        };
        persistGlobal(newState); 
        return newState;
      });
    },
    clearCustomResolution: () => {
      update(state => {
        const newState: ResolutionState = {
          ...state,
          customWidth: undefined,
          customHeight: undefined,
          source: SESSION_SOURCE,
        };
        persistGlobal(newState); 
        return newState;
      });
    },
    setFromConfig: (settings?: ResolutionSettings) => {
      if (settings) {
        const next = createStateFromSettings(
          settings,
          current.forceBlackBackground,
          CONFIG_SOURCE,
        );
        // Skip if store already matches
        if (current.scale === next.scale && current.customWidth === next.customWidth &&
                    current.customHeight === next.customHeight && current.source === CONFIG_SOURCE) {
          return;
        }
        commit(next);
      } else {
        // No config — fall back to global defaults (skip if already there)
        if (current.source !== CONFIG_SOURCE) {
          return; 
        }
        const next = loadInitialState();
        commit(next);
      }
    },
    setSessionSettings: (settings?: Partial<ResolutionSettings>) => {
      const next = createStateFromSettings(
        settings,
        current.forceBlackBackground,
        SESSION_SOURCE,
      );
      if (current.scale === next.scale && current.customWidth === next.customWidth &&
                  current.customHeight === next.customHeight && current.source === SESSION_SOURCE) {
        return;
      }
      commit(next);
    },
    setSource: (source: ResolutionSource) => {
      update(state => ({ ...state, source }));
    },
    setForceBlackBackground: (forceBlackBackground: boolean) => {
      update(state => {
        const newState: ResolutionState = {
          ...state,
          forceBlackBackground,
        };
        if (newState.source === SESSION_SOURCE) {
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
          source: SESSION_SOURCE,
        };
        persistGlobal(newState);
        return newState;
      });
    },
  };
};

export const resolutionStore = createResolutionStore();
