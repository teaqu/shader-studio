import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

describe('debugPanelStore', () => {
  beforeEach(() => {
    localStorage.clear();
    // Re-import fresh module each test to get clean initial state
    vi.resetModules();
  });

  async function importStore() {
    const mod = await import('../../lib/stores/debugPanelStore');
    return mod.debugPanelStore;
  }

  it('should have default initial state when localStorage is empty', async () => {
    const store = await importStore();
    const state = get(store);
    expect(state.isVisible).toBe(true);
    expect(state.splitRatio).toBe(0.7);
  });

  it('should load state from localStorage', async () => {
    localStorage.setItem('shader-studio-debug-panel-state', JSON.stringify({
      isVisible: false,
      splitRatio: 0.5,
    }));
    const store = await importStore();
    const state = get(store);
    expect(state.isVisible).toBe(false);
    expect(state.splitRatio).toBe(0.5);
  });

  it('should fall back to defaults on invalid localStorage', async () => {
    localStorage.setItem('shader-studio-debug-panel-state', 'not-json');
    const store = await importStore();
    const state = get(store);
    expect(state.isVisible).toBe(true);
    expect(state.splitRatio).toBe(0.7);
  });

  it('toggle should flip isVisible', async () => {
    const store = await importStore();
    expect(get(store).isVisible).toBe(true);
    store.toggle();
    expect(get(store).isVisible).toBe(false);
    store.toggle();
    expect(get(store).isVisible).toBe(true);
  });

  it('toggle should persist to localStorage', async () => {
    const store = await importStore();
    store.toggle();
    const stored = JSON.parse(localStorage.getItem('shader-studio-debug-panel-state')!);
    expect(stored.isVisible).toBe(false);
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
    store.setSplitRatio(0.6);
    const stored = JSON.parse(localStorage.getItem('shader-studio-debug-panel-state')!);
    expect(stored.splitRatio).toBe(0.6);
  });

  it('setVisible should set visibility directly', async () => {
    const store = await importStore();
    store.setVisible(false);
    expect(get(store).isVisible).toBe(false);
    store.setVisible(true);
    expect(get(store).isVisible).toBe(true);
  });

  it('setVisible should persist to localStorage', async () => {
    const store = await importStore();
    store.setVisible(false);
    const stored = JSON.parse(localStorage.getItem('shader-studio-debug-panel-state')!);
    expect(stored.isVisible).toBe(false);
  });
});
