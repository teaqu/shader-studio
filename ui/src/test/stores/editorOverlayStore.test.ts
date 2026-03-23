import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

describe('editorOverlayStore', () => {
  const SLOT_KEY = 'shader-studio-editor-overlay-state:vscode:1';
  const OTHER_SLOT_KEY = 'shader-studio-editor-overlay-state:vscode:2';

  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  async function importStore() {
    const mod = await import('../../lib/stores/editorOverlayStore');
    return mod.editorOverlayStore;
  }

  it('should have default initial state when localStorage is empty', async () => {
    const store = await importStore();
    store.setLayoutSlot('vscode:1');
    const state = get(store);
    expect(state.isVisible).toBe(false);
    expect(state.vimMode).toBe(false);
  });

  it('should not restore from localStorage on creation (deferred restore)', async () => {
    localStorage.setItem(SLOT_KEY, JSON.stringify({
      isVisible: true,
      vimMode: true,
    }));
    const store = await importStore();
    store.setLayoutSlot('vscode:1');
    const state = get(store);
    expect(state.isVisible).toBe(false);
    expect(state.vimMode).toBe(false);
  });

  it('restoreFromStorage should load state from localStorage', async () => {
    localStorage.setItem(SLOT_KEY, JSON.stringify({
      isVisible: true,
      vimMode: true,
    }));
    const store = await importStore();
    store.setLayoutSlot('vscode:1');
    store.restoreFromStorage();
    const state = get(store);
    expect(state.isVisible).toBe(true);
    expect(state.vimMode).toBe(true);
  });

  it('should fall back to defaults on invalid localStorage', async () => {
    localStorage.setItem(SLOT_KEY, 'not-json');
    const store = await importStore();
    store.setLayoutSlot('vscode:1');
    store.restoreFromStorage();
    const state = get(store);
    expect(state.isVisible).toBe(false);
    expect(state.vimMode).toBe(false);
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

  it('toggle should not affect vimMode', async () => {
    const store = await importStore();
    store.setLayoutSlot('vscode:1');
    store.toggleVimMode();
    expect(get(store).vimMode).toBe(true);
    store.toggle();
    expect(get(store).vimMode).toBe(true);
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

  it('toggleVimMode should flip vimMode', async () => {
    const store = await importStore();
    store.setLayoutSlot('vscode:1');
    expect(get(store).vimMode).toBe(false);
    store.toggleVimMode();
    expect(get(store).vimMode).toBe(true);
    store.toggleVimMode();
    expect(get(store).vimMode).toBe(false);
  });

  it('toggleVimMode should persist to localStorage', async () => {
    const store = await importStore();
    store.setLayoutSlot('vscode:1');
    store.toggleVimMode();
    const stored = JSON.parse(localStorage.getItem(SLOT_KEY)!);
    expect(stored.vimMode).toBe(true);
  });

  it('toggleVimMode should not affect isVisible', async () => {
    const store = await importStore();
    store.setLayoutSlot('vscode:1');
    store.toggle(); // set visible = true
    expect(get(store).isVisible).toBe(true);
    store.toggleVimMode();
    expect(get(store).isVisible).toBe(true);
  });

  it('restores state independently per slot', async () => {
    localStorage.setItem(SLOT_KEY, JSON.stringify({ isVisible: true, vimMode: false }));
    localStorage.setItem(OTHER_SLOT_KEY, JSON.stringify({ isVisible: false, vimMode: true }));
    const store = await importStore();

    store.setLayoutSlot('vscode:1');
    store.restoreFromStorage();
    expect(get(store)).toEqual({ isVisible: true, vimMode: false });

    store.setLayoutSlot('vscode:2');
    store.restoreFromStorage();
    expect(get(store)).toEqual({ isVisible: false, vimMode: true });
  });
});
