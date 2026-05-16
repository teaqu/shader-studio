import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

describe('debugPanelStore', () => {
  const SLOT_KEY = 'shader-studio-debug-panel-state:vscode:1';
  const OTHER_SLOT_KEY = 'shader-studio-debug-panel-state:vscode:2';

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
    store.setLayoutSlot('vscode:1');
    const state = get(store);
    expect(state.isVisible).toBe(false);
    expect(state.isVariableInspectorEnabled).toBe(false);
    expect(state.isInlineRenderingEnabled).toBe(true);
    expect(state.isPixelInspectorEnabled).toBe(true);
    expect(state.isErrorsEnabled).toBe(false);
  });

  it('should not restore from localStorage on creation (deferred restore)', async () => {
    localStorage.setItem(SLOT_KEY, JSON.stringify({
      isVisible: false,
    }));
    const store = await importStore();
    store.setLayoutSlot('vscode:1');
    const state = get(store);
    expect(state.isVisible).toBe(false);
  });

  it('restoreFromStorage should apply saved state', async () => {
    localStorage.setItem(SLOT_KEY, JSON.stringify({
      isVisible: false,
      isVariableInspectorEnabled: true,
      isInlineRenderingEnabled: false,
      isPixelInspectorEnabled: false,
      isErrorsEnabled: true,
    }));
    const store = await importStore();
    store.setLayoutSlot('vscode:1');
    store.restoreFromStorage();
    expect(get(store).isVisible).toBe(false);
    expect(get(store).isVariableInspectorEnabled).toBe(true);
    expect(get(store).isInlineRenderingEnabled).toBe(false);
    expect(get(store).isPixelInspectorEnabled).toBe(false);
    expect(get(store).isErrorsEnabled).toBe(true);
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
    store.setVisible(false);
    expect(get(store).isVisible).toBe(false);
    store.setVisible(true);
    expect(get(store).isVisible).toBe(true);
  });

  it('setVisible should persist to localStorage', async () => {
    const store = await importStore();
    store.setLayoutSlot('vscode:1');
    store.setVisible(false);
    const stored = JSON.parse(localStorage.getItem(SLOT_KEY)!);
    expect(stored.isVisible).toBe(false);
  });

  it('should persist variable inspector, inline rendering, pixel inspector, and errors toggles', async () => {
    const store = await importStore();
    store.setLayoutSlot('vscode:1');
    store.setVariableInspectorEnabled(true);
    store.setInlineRenderingEnabled(false);
    store.setPixelInspectorEnabled(false);
    store.setErrorsEnabled(true);

    const stored = JSON.parse(localStorage.getItem(SLOT_KEY)!);
    expect(stored.isVariableInspectorEnabled).toBe(true);
    expect(stored.isInlineRenderingEnabled).toBe(false);
    expect(stored.isPixelInspectorEnabled).toBe(false);
    expect(stored.isErrorsEnabled).toBe(true);
  });

  it('restores and persists state independently per slot', async () => {
    localStorage.setItem(SLOT_KEY, JSON.stringify({ isVisible: false }));
    localStorage.setItem(OTHER_SLOT_KEY, JSON.stringify({ isVisible: true, isVariableInspectorEnabled: true }));
    const store = await importStore();

    store.setLayoutSlot('vscode:1');
    store.restoreFromStorage();
    expect(get(store).isVisible).toBe(false);
    expect(get(store).isVariableInspectorEnabled).toBe(false);
    expect(get(store).isErrorsEnabled).toBe(false);

    store.setLayoutSlot('vscode:2');
    store.restoreFromStorage();
    expect(get(store).isVisible).toBe(true);
    expect(get(store).isVariableInspectorEnabled).toBe(true);
    expect(get(store).isErrorsEnabled).toBe(false);
  });
});
