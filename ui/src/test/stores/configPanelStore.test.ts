import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

describe('configPanelStore', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  async function importStore() {
    const mod = await import('../../lib/stores/configPanelStore');
    return mod.configPanelStore;
  }

  it('should have default initial state when localStorage is empty', async () => {
    const store = await importStore();
    const state = get(store);
    expect(state.isVisible).toBe(false);
    expect(state.splitRatio).toBe(0.6);
  });

  it('should restore only splitRatio from localStorage, never isVisible', async () => {
    localStorage.setItem('shader-studio-config-panel-state', JSON.stringify({
      isVisible: true,
      splitRatio: 0.5,
    }));
    const store = await importStore();
    const state = get(store);
    // isVisible is always false on load, regardless of stored value
    expect(state.isVisible).toBe(false);
    expect(state.splitRatio).toBe(0.5);
  });

  it('should fall back to defaults on invalid localStorage', async () => {
    localStorage.setItem('shader-studio-config-panel-state', 'not-json');
    const store = await importStore();
    const state = get(store);
    expect(state.isVisible).toBe(false);
    expect(state.splitRatio).toBe(0.6);
  });

  it('toggle should flip isVisible', async () => {
    const store = await importStore();
    expect(get(store).isVisible).toBe(false);
    store.toggle();
    expect(get(store).isVisible).toBe(true);
    store.toggle();
    expect(get(store).isVisible).toBe(false);
  });

  it('toggle should persist to localStorage', async () => {
    const store = await importStore();
    store.toggle();
    const stored = JSON.parse(localStorage.getItem('shader-studio-config-panel-state')!);
    expect(stored.isVisible).toBe(true);
  });

  it('setSplitRatio should update ratio', async () => {
    const store = await importStore();
    store.setSplitRatio(0.5);
    expect(get(store).splitRatio).toBe(0.5);
  });

  it('setSplitRatio should clamp to min 0.3', async () => {
    const store = await importStore();
    store.setSplitRatio(0.1);
    expect(get(store).splitRatio).toBe(0.3);
  });

  it('setSplitRatio should clamp to max 0.9', async () => {
    const store = await importStore();
    store.setSplitRatio(0.99);
    expect(get(store).splitRatio).toBe(0.9);
  });

  it('setSplitRatio should persist to localStorage', async () => {
    const store = await importStore();
    store.setSplitRatio(0.7);
    const stored = JSON.parse(localStorage.getItem('shader-studio-config-panel-state')!);
    expect(stored.splitRatio).toBe(0.7);
  });

  it('setVisible should set visibility directly', async () => {
    const store = await importStore();
    store.setVisible(true);
    expect(get(store).isVisible).toBe(true);
    store.setVisible(false);
    expect(get(store).isVisible).toBe(false);
  });

  it('setVisible should persist to localStorage', async () => {
    const store = await importStore();
    store.setVisible(true);
    const stored = JSON.parse(localStorage.getItem('shader-studio-config-panel-state')!);
    expect(stored.isVisible).toBe(true);
  });
});
