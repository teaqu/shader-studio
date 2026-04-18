import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('editorOverlayStore', () => {
  const SLOT_KEY = 'shader-studio-editor-overlay-state:vscode:1';
  const OTHER_SLOT_KEY = 'shader-studio-editor-overlay-state:vscode:2';

  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  async function importState() {
    return import('../../lib/state/editorOverlayState.svelte');
  }

  it('should have default initial state when localStorage is empty', async () => {
    const s = await importState();
    s.setLayoutSlot('vscode:1');
    expect(s.getEditorOverlayVisible()).toBe(false);
    expect(s.getVimMode()).toBe(false);
  });

  it('should not restore from localStorage on creation (deferred restore)', async () => {
    localStorage.setItem(SLOT_KEY, JSON.stringify({ isVisible: true, vimMode: true }));
    const s = await importState();
    s.setLayoutSlot('vscode:1');
    expect(s.getEditorOverlayVisible()).toBe(false);
    expect(s.getVimMode()).toBe(false);
  });

  it('restoreFromStorage should load state from localStorage', async () => {
    localStorage.setItem(SLOT_KEY, JSON.stringify({ isVisible: true, vimMode: true }));
    const s = await importState();
    s.setLayoutSlot('vscode:1');
    s.restoreFromStorage();
    expect(s.getEditorOverlayVisible()).toBe(true);
    expect(s.getVimMode()).toBe(true);
  });

  it('should fall back to defaults on invalid localStorage', async () => {
    localStorage.setItem(SLOT_KEY, 'not-json');
    const s = await importState();
    s.setLayoutSlot('vscode:1');
    s.restoreFromStorage();
    expect(s.getEditorOverlayVisible()).toBe(false);
    expect(s.getVimMode()).toBe(false);
  });

  it('toggleEditorOverlay should flip isVisible', async () => {
    const s = await importState();
    s.setLayoutSlot('vscode:1');
    expect(s.getEditorOverlayVisible()).toBe(false);
    s.toggleEditorOverlay();
    expect(s.getEditorOverlayVisible()).toBe(true);
    s.toggleEditorOverlay();
    expect(s.getEditorOverlayVisible()).toBe(false);
  });

  it('toggleEditorOverlay should persist to localStorage', async () => {
    const s = await importState();
    s.setLayoutSlot('vscode:1');
    s.toggleEditorOverlay();
    const stored = JSON.parse(localStorage.getItem(SLOT_KEY)!);
    expect(stored.isVisible).toBe(true);
  });

  it('toggleEditorOverlay should not affect vimMode', async () => {
    const s = await importState();
    s.setLayoutSlot('vscode:1');
    s.toggleVimMode();
    expect(s.getVimMode()).toBe(true);
    s.toggleEditorOverlay();
    expect(s.getVimMode()).toBe(true);
  });

  it('setEditorOverlayVisible should set visibility directly', async () => {
    const s = await importState();
    s.setLayoutSlot('vscode:1');
    s.setEditorOverlayVisible(true);
    expect(s.getEditorOverlayVisible()).toBe(true);
    s.setEditorOverlayVisible(false);
    expect(s.getEditorOverlayVisible()).toBe(false);
  });

  it('setEditorOverlayVisible should persist to localStorage', async () => {
    const s = await importState();
    s.setLayoutSlot('vscode:1');
    s.setEditorOverlayVisible(true);
    const stored = JSON.parse(localStorage.getItem(SLOT_KEY)!);
    expect(stored.isVisible).toBe(true);
  });

  it('toggleVimMode should flip vimMode', async () => {
    const s = await importState();
    s.setLayoutSlot('vscode:1');
    expect(s.getVimMode()).toBe(false);
    s.toggleVimMode();
    expect(s.getVimMode()).toBe(true);
    s.toggleVimMode();
    expect(s.getVimMode()).toBe(false);
  });

  it('toggleVimMode should persist to localStorage', async () => {
    const s = await importState();
    s.setLayoutSlot('vscode:1');
    s.toggleVimMode();
    const stored = JSON.parse(localStorage.getItem(SLOT_KEY)!);
    expect(stored.vimMode).toBe(true);
  });

  it('toggleVimMode should not affect isVisible', async () => {
    const s = await importState();
    s.setLayoutSlot('vscode:1');
    s.toggleEditorOverlay();
    expect(s.getEditorOverlayVisible()).toBe(true);
    s.toggleVimMode();
    expect(s.getEditorOverlayVisible()).toBe(true);
  });

  it('restores state independently per slot', async () => {
    localStorage.setItem(SLOT_KEY, JSON.stringify({ isVisible: true, vimMode: false }));
    localStorage.setItem(OTHER_SLOT_KEY, JSON.stringify({ isVisible: false, vimMode: true }));
    const s = await importState();

    s.setLayoutSlot('vscode:1');
    s.restoreFromStorage();
    expect(s.getEditorOverlayVisible()).toBe(true);
    expect(s.getVimMode()).toBe(false);

    s.setLayoutSlot('vscode:2');
    s.restoreFromStorage();
    expect(s.getEditorOverlayVisible()).toBe(false);
    expect(s.getVimMode()).toBe(true);
  });
});
