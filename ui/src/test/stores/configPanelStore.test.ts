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
  });

  it('should restore isVisible from localStorage', async () => {
    localStorage.setItem('shader-studio-config-panel-state', JSON.stringify({
      isVisible: true,
    }));
    const store = await importStore();
    const state = get(store);
    expect(state.isVisible).toBe(true);
  });

  it('should fall back to defaults on invalid localStorage', async () => {
    localStorage.setItem('shader-studio-config-panel-state', 'not-json');
    const store = await importStore();
    const state = get(store);
    expect(state.isVisible).toBe(false);
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
