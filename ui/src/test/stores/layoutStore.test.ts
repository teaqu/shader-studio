import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

const STORAGE_KEY = 'shader-studio-dockview-layout';

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

  it('should have null initial state', async () => {
    const store = await importStore();
    expect(get(store)).toBeNull();
  });

  it('save should update store value', async () => {
    const store = await importStore();
    store.save(mockLayout as any);
    expect(get(store)).toEqual(mockLayout);
  });

  it('save should persist to localStorage', async () => {
    const store = await importStore();
    store.save(mockLayout as any);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toEqual(mockLayout);
  });

  it('load should restore from localStorage and update store', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mockLayout));
    const store = await importStore();
    const result = store.load();
    expect(result).toEqual(mockLayout);
    expect(get(store)).toEqual(mockLayout);
  });

  it('load should return null when localStorage is empty', async () => {
    const store = await importStore();
    const result = store.load();
    expect(result).toBeNull();
    expect(get(store)).toBeNull();
  });

  it('load should return null on invalid JSON in localStorage', async () => {
    localStorage.setItem(STORAGE_KEY, 'not-valid-json');
    const store = await importStore();
    const result = store.load();
    expect(result).toBeNull();
  });

  it('clear should reset store to null', async () => {
    const store = await importStore();
    store.save(mockLayout as any);
    expect(get(store)).toEqual(mockLayout);
    store.clear();
    expect(get(store)).toBeNull();
  });

  it('clear should remove from localStorage', async () => {
    const store = await importStore();
    store.save(mockLayout as any);
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    store.clear();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('save should handle localStorage errors gracefully', async () => {
    const store = await importStore();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const origSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = () => { throw new Error('QuotaExceeded'); };

    // Should not throw
    store.save(mockLayout as any);
    expect(get(store)).toEqual(mockLayout); // store still updated
    expect(warnSpy).toHaveBeenCalled();

    localStorage.setItem = origSetItem;
    warnSpy.mockRestore();
  });

  it('load should handle localStorage errors gracefully', async () => {
    const store = await importStore();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const origGetItem = localStorage.getItem.bind(localStorage);
    localStorage.getItem = () => { throw new Error('SecurityError'); };

    const result = store.load();
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();

    localStorage.getItem = origGetItem;
    warnSpy.mockRestore();
  });

  it('clear should handle localStorage errors gracefully', async () => {
    const store = await importStore();
    store.save(mockLayout as any);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const origRemoveItem = localStorage.removeItem.bind(localStorage);
    localStorage.removeItem = () => { throw new Error('SecurityError'); };

    // Should not throw
    store.clear();
    expect(get(store)).toBeNull(); // store still cleared
    expect(warnSpy).toHaveBeenCalled();

    localStorage.removeItem = origRemoveItem;
    warnSpy.mockRestore();
  });

  it('save then load roundtrip should produce equal layout', async () => {
    const store = await importStore();
    store.save(mockLayout as any);

    // Reset module to simulate fresh load
    vi.resetModules();
    const freshStore = await importStore();
    const loaded = freshStore.load();
    expect(loaded).toEqual(mockLayout);
  });
});
