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
    expect(state.isVariableInspectorEnabled).toBe(false);
    expect(state.isInlineRenderingEnabled).toBe(true);
    expect(state.isPixelInspectorEnabled).toBe(true);
  });

  it('should not restore from localStorage on creation (deferred restore)', async () => {
    localStorage.setItem('shader-studio-debug-panel-state', JSON.stringify({
      isVisible: false,
    }));
    const store = await importStore();
    const state = get(store);
    expect(state.isVisible).toBe(true);
  });

  it('restoreFromStorage should apply saved state', async () => {
    localStorage.setItem('shader-studio-debug-panel-state', JSON.stringify({
      isVisible: false,
      isVariableInspectorEnabled: true,
      isInlineRenderingEnabled: false,
      isPixelInspectorEnabled: false,
    }));
    const store = await importStore();
    store.restoreFromStorage();
    expect(get(store).isVisible).toBe(false);
    expect(get(store).isVariableInspectorEnabled).toBe(true);
    expect(get(store).isInlineRenderingEnabled).toBe(false);
    expect(get(store).isPixelInspectorEnabled).toBe(false);
  });

  it('restoreFromStorage should handle invalid localStorage gracefully', async () => {
    localStorage.setItem('shader-studio-debug-panel-state', 'not-json');
    const store = await importStore();
    store.restoreFromStorage();
    expect(get(store).isVisible).toBe(true);
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

  it('should persist variable inspector, inline rendering, and pixel inspector toggles', async () => {
    const store = await importStore();
    store.setVariableInspectorEnabled(true);
    store.setInlineRenderingEnabled(false);
    store.setPixelInspectorEnabled(false);

    const stored = JSON.parse(localStorage.getItem('shader-studio-debug-panel-state')!);
    expect(stored.isVariableInspectorEnabled).toBe(true);
    expect(stored.isInlineRenderingEnabled).toBe(false);
    expect(stored.isPixelInspectorEnabled).toBe(false);
  });
});
