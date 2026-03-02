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
  });

  it('should load state from localStorage', async () => {
    localStorage.setItem('shader-studio-debug-panel-state', JSON.stringify({
      isVisible: false,
    }));
    const store = await importStore();
    const state = get(store);
    expect(state.isVisible).toBe(false);
  });

  it('should fall back to defaults on invalid localStorage', async () => {
    localStorage.setItem('shader-studio-debug-panel-state', 'not-json');
    const store = await importStore();
    const state = get(store);
    expect(state.isVisible).toBe(true);
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
