import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

describe('editorOverlayStore', () => {
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
    const state = get(store);
    expect(state.isVisible).toBe(false);
    expect(state.vimMode).toBe(false);
  });

  it('should load state from localStorage', async () => {
    localStorage.setItem('shader-studio-editor-overlay-state', JSON.stringify({
      isVisible: true,
      vimMode: true,
    }));
    const store = await importStore();
    const state = get(store);
    expect(state.isVisible).toBe(true);
    expect(state.vimMode).toBe(true);
  });

  it('should fall back to defaults on invalid localStorage', async () => {
    localStorage.setItem('shader-studio-editor-overlay-state', 'not-json');
    const store = await importStore();
    const state = get(store);
    expect(state.isVisible).toBe(false);
    expect(state.vimMode).toBe(false);
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
    const stored = JSON.parse(localStorage.getItem('shader-studio-editor-overlay-state')!);
    expect(stored.isVisible).toBe(true);
  });

  it('toggle should not affect vimMode', async () => {
    const store = await importStore();
    store.toggleVimMode();
    expect(get(store).vimMode).toBe(true);
    store.toggle();
    expect(get(store).vimMode).toBe(true);
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
    const stored = JSON.parse(localStorage.getItem('shader-studio-editor-overlay-state')!);
    expect(stored.isVisible).toBe(true);
  });

  it('toggleVimMode should flip vimMode', async () => {
    const store = await importStore();
    expect(get(store).vimMode).toBe(false);
    store.toggleVimMode();
    expect(get(store).vimMode).toBe(true);
    store.toggleVimMode();
    expect(get(store).vimMode).toBe(false);
  });

  it('toggleVimMode should persist to localStorage', async () => {
    const store = await importStore();
    store.toggleVimMode();
    const stored = JSON.parse(localStorage.getItem('shader-studio-editor-overlay-state')!);
    expect(stored.vimMode).toBe(true);
  });

  it('toggleVimMode should not affect isVisible', async () => {
    const store = await importStore();
    store.toggle(); // set visible = true
    expect(get(store).isVisible).toBe(true);
    store.toggleVimMode();
    expect(get(store).isVisible).toBe(true);
  });
});
