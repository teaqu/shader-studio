import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { createSlotPersistedStore } from '../../lib/stores/createSlotPersistedStore';

interface TestState {
  count: number;
  enabled: boolean;
}

describe('createSlotPersistedStore', () => {
  const STORAGE_KEY = 'test-slot-persisted-store';
  const SLOT_ONE_KEY = `${STORAGE_KEY}:vscode:1`;
  const SLOT_TWO_KEY = `${STORAGE_KEY}:vscode:2`;
  const DEFAULT_STATE: TestState = { count: 0, enabled: false };

  function createStore() {
    return createSlotPersistedStore<TestState>({
      storageKey: STORAGE_KEY,
      defaultState: DEFAULT_STATE,
      loadErrorMessage: 'load failed',
      saveErrorMessage: 'save failed',
      parseStoredState: (parsed, defaultState) => {
        const state = parsed as Partial<TestState> | null;
        return {
          count: state?.count ?? defaultState.count,
          enabled: state?.enabled ?? defaultState.enabled,
        };
      },
    });
  }

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('starts with the default state', () => {
    const store = createStore();

    expect(get(store)).toEqual(DEFAULT_STATE);
  });

  it('resets to defaults when the layout slot changes', () => {
    const store = createStore();

    store.setLayoutSlot('vscode:1');
    store.updateAndPersist((state) => ({ ...state, count: 3, enabled: true }));
    expect(get(store)).toEqual({ count: 3, enabled: true });

    store.setLayoutSlot('vscode:2');
    expect(get(store)).toEqual(DEFAULT_STATE);
  });

  it('persists updates under the active slot key', () => {
    const store = createStore();

    store.setLayoutSlot('vscode:1');
    store.updateAndPersist((state) => ({ ...state, count: 2, enabled: true }));

    expect(JSON.parse(localStorage.getItem(SLOT_ONE_KEY)!)).toEqual({ count: 2, enabled: true });
    expect(localStorage.getItem(SLOT_TWO_KEY)).toBeNull();
  });

  it('restores parsed state from the active slot key', () => {
    localStorage.setItem(SLOT_ONE_KEY, JSON.stringify({ count: 7, enabled: true }));
    const store = createStore();

    store.setLayoutSlot('vscode:1');
    store.restoreFromStorage();

    expect(get(store)).toEqual({ count: 7, enabled: true });
  });

  it('falls back to defaults when no stored state exists', () => {
    const store = createStore();

    store.setLayoutSlot('vscode:1');
    store.updateAndPersist((state) => ({ ...state, count: 5, enabled: true }));
    store.setLayoutSlot('vscode:2');
    store.restoreFromStorage();

    expect(get(store)).toEqual(DEFAULT_STATE);
  });

  it('falls back to defaults and warns on invalid stored JSON', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(SLOT_ONE_KEY, 'not-json');
    const store = createStore();

    store.setLayoutSlot('vscode:1');
    store.restoreFromStorage();

    expect(get(store)).toEqual(DEFAULT_STATE);
    expect(warnSpy).toHaveBeenCalledWith('load failed', expect.any(SyntaxError));
  });

  it('uses the base storage key when no slot is set', () => {
    const store = createStore();

    store.updateAndPersist((state) => ({ ...state, count: 9 }));

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ count: 9, enabled: false });
  });
});
