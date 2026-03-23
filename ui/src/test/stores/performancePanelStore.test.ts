import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

describe('performancePanelStore', () => {
  const SLOT_KEY = 'shader-studio-performance-panel-state:vscode:1';
  const OTHER_SLOT_KEY = 'shader-studio-performance-panel-state:vscode:2';

  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  async function importStore() {
    const mod = await import('../../lib/stores/performancePanelStore');
    return mod.performancePanelStore;
  }

  it('should have default initial state when localStorage is empty', async () => {
    const store = await importStore();
    store.setLayoutSlot('vscode:1');
    const state = get(store);
    expect(state.isVisible).toBe(false);
  });

  it('should not restore from localStorage on creation (deferred restore)', async () => {
    localStorage.setItem(SLOT_KEY, JSON.stringify({
      isVisible: true,
    }));
    const store = await importStore();
    store.setLayoutSlot('vscode:1');
    const state = get(store);
    expect(state.isVisible).toBe(false);
  });

  it('restoreFromStorage should apply saved state', async () => {
    localStorage.setItem(SLOT_KEY, JSON.stringify({
      isVisible: true,
    }));
    const store = await importStore();
    store.setLayoutSlot('vscode:1');
    store.restoreFromStorage();
    expect(get(store).isVisible).toBe(true);
  });

  it('restoreFromStorage should handle invalid localStorage gracefully', async () => {
    localStorage.setItem(SLOT_KEY, 'not-json');
    const store = await importStore();
    store.setLayoutSlot('vscode:1');
    store.restoreFromStorage();
    expect(get(store).isVisible).toBe(false);
  });

  it('should fall back to defaults on invalid localStorage', async () => {
    localStorage.setItem(SLOT_KEY, 'not-json');
    const store = await importStore();
    store.setLayoutSlot('vscode:1');
    const state = get(store);
    expect(state.isVisible).toBe(false);
  });

  it('toggle should flip isVisible', async () => {
    const store = await importStore();
    store.setLayoutSlot('vscode:1');
    expect(get(store).isVisible).toBe(false);
    store.toggle();
    expect(get(store).isVisible).toBe(true);
    store.toggle();
    expect(get(store).isVisible).toBe(false);
  });

  it('toggle should persist to localStorage', async () => {
    const store = await importStore();
    store.setLayoutSlot('vscode:1');
    store.toggle();
    const stored = JSON.parse(localStorage.getItem(SLOT_KEY)!);
    expect(stored.isVisible).toBe(true);
  });

  it('setVisible should set visibility directly', async () => {
    const store = await importStore();
    store.setLayoutSlot('vscode:1');
    store.setVisible(true);
    expect(get(store).isVisible).toBe(true);
    store.setVisible(false);
    expect(get(store).isVisible).toBe(false);
  });

  it('setVisible should persist to localStorage', async () => {
    const store = await importStore();
    store.setLayoutSlot('vscode:1');
    store.setVisible(true);
    const stored = JSON.parse(localStorage.getItem(SLOT_KEY)!);
    expect(stored.isVisible).toBe(true);
  });

  it('restores state independently per slot', async () => {
    localStorage.setItem(SLOT_KEY, JSON.stringify({ isVisible: true }));
    localStorage.setItem(OTHER_SLOT_KEY, JSON.stringify({ isVisible: false }));
    const store = await importStore();

    store.setLayoutSlot('vscode:1');
    store.restoreFromStorage();
    expect(get(store).isVisible).toBe(true);

    store.setLayoutSlot('vscode:2');
    store.restoreFromStorage();
    expect(get(store).isVisible).toBe(false);
  });
});
