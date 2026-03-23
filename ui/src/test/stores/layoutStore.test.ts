import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

const STORAGE_KEY = 'shader-studio-dockview-layout:web:1';
const OTHER_STORAGE_KEY = 'shader-studio-dockview-layout:web:2';

describe('layoutStore', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  async function importStore() {
    const mod = await import('../../lib/stores/layoutStore');
    return mod.layoutStore;
  }

  const mockLayout = {
    grid: { root: { type: 'branch' as const, data: [] }, width: 800, height: 600, orientation: 0 },
    panels: {},
  };

  const mockState = {
    activeLayout: mockLayout,
    panelSnapshots: {
      debug: mockLayout,
    },
  };

  it('should have null initial state', async () => {
    const store = await importStore();
    expect(get(store)).toBeNull();
  });

  it('save should update store value', async () => {
    const store = await importStore();
    store.save('web:1', mockState as any);
    expect(get(store)).toEqual(mockState);
  });

  it('save should persist to localStorage by slot', async () => {
    const store = await importStore();
    store.save('web:1', mockState as any);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toEqual(mockState);
  });

  it('load should restore from localStorage and update store', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mockState));
    const store = await importStore();
    const result = store.load('web:1');
    expect(result).toEqual(mockState);
    expect(get(store)).toEqual(mockState);
  });

  it('load should return null when localStorage is empty', async () => {
    const store = await importStore();
    const result = store.load('web:1');
    expect(result).toBeNull();
    expect(get(store)).toBeNull();
  });

  it('load should isolate state by slot', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mockState));
    localStorage.setItem(OTHER_STORAGE_KEY, JSON.stringify({ activeLayout: null, panelSnapshots: {} }));
    const store = await importStore();
    const result = store.load('web:2');
    expect(result).toEqual({ activeLayout: null, panelSnapshots: {} });
  });

  it('load should return null on invalid JSON in localStorage', async () => {
    localStorage.setItem(STORAGE_KEY, 'not-valid-json');
    const store = await importStore();
    const result = store.load('web:1');
    expect(result).toBeNull();
  });

  it('clear should reset store to null', async () => {
    const store = await importStore();
    store.save('web:1', mockState as any);
    expect(get(store)).toEqual(mockState);
    store.clear('web:1');
    expect(get(store)).toBeNull();
  });

  it('clear should remove from localStorage for only the requested slot', async () => {
    const store = await importStore();
    store.save('web:1', mockState as any);
    store.save('web:2', { activeLayout: null, panelSnapshots: {} } as any);
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    expect(localStorage.getItem(OTHER_STORAGE_KEY)).not.toBeNull();
    store.clear('web:1');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(OTHER_STORAGE_KEY)).not.toBeNull();
  });

  it('save should handle localStorage errors gracefully', async () => {
    const store = await importStore();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const origSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = () => { throw new Error('QuotaExceeded'); };

    store.save('web:1', mockState as any);
    expect(get(store)).toEqual(mockState);
    expect(warnSpy).toHaveBeenCalled();

    localStorage.setItem = origSetItem;
    warnSpy.mockRestore();
  });

  it('load should handle localStorage errors gracefully', async () => {
    const store = await importStore();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const origGetItem = localStorage.getItem.bind(localStorage);
    localStorage.getItem = () => { throw new Error('SecurityError'); };

    const result = store.load('web:1');
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();

    localStorage.getItem = origGetItem;
    warnSpy.mockRestore();
  });

  it('clear should handle localStorage errors gracefully', async () => {
    const store = await importStore();
    store.save('web:1', mockState as any);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const origRemoveItem = localStorage.removeItem.bind(localStorage);
    localStorage.removeItem = () => { throw new Error('SecurityError'); };

    store.clear('web:1');
    expect(get(store)).toBeNull();
    expect(warnSpy).toHaveBeenCalled();

    localStorage.removeItem = origRemoveItem;
    warnSpy.mockRestore();
  });

  it('save then load roundtrip should produce equal state', async () => {
    const store = await importStore();
    store.save('web:1', mockState as any);

    vi.resetModules();
    const freshStore = await importStore();
    const loaded = freshStore.load('web:1');
    expect(loaded).toEqual(mockState);
  });
});
