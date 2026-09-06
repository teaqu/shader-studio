import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getEditorOverlayVisible,
  getVimMode,
  restoreFromStorage,
  setEditorOverlayVisible,
  setLayoutSlot,
  toggleEditorOverlay,
  toggleVimMode,
} from '../../lib/state/editorOverlayState.svelte';

describe('editorOverlayStore', () => {
  const SLOT_KEY = 'shader-studio-editor-overlay-state:vscode:1';
  const OTHER_SLOT_KEY = 'shader-studio-editor-overlay-state:vscode:2';

  // setLayoutSlot resets every field, so tests share one module instance
  // instead of paying a fresh transform per case.
  beforeEach(() => {
    localStorage.clear();
    setLayoutSlot('vscode:1');
  });

  it('should have default initial state when localStorage is empty', () => {
    expect(getEditorOverlayVisible()).toBe(false);
    expect(getVimMode()).toBe(false);
  });

  it('should not restore from localStorage on a slot change (deferred restore)', () => {
    localStorage.setItem(SLOT_KEY, JSON.stringify({ isVisible: true, vimMode: true }));

    setLayoutSlot('vscode:1');

    expect(getEditorOverlayVisible()).toBe(false);
    expect(getVimMode()).toBe(false);
  });

  it('does not read localStorage while the module loads', async () => {
    localStorage.setItem('shader-studio-editor-overlay-state', JSON.stringify({ isVisible: true, vimMode: true }));
    localStorage.setItem(SLOT_KEY, JSON.stringify({ isVisible: true, vimMode: true }));
    vi.resetModules();

    const fresh = await import('../../lib/state/editorOverlayState.svelte');

    expect(fresh.getEditorOverlayVisible()).toBe(false);
    expect(fresh.getVimMode()).toBe(false);
  });

  it('restoreFromStorage should load state from localStorage', () => {
    localStorage.setItem(SLOT_KEY, JSON.stringify({ isVisible: true, vimMode: true }));

    restoreFromStorage();

    expect(getEditorOverlayVisible()).toBe(true);
    expect(getVimMode()).toBe(true);
  });

  it('should fall back to defaults on invalid localStorage', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      localStorage.setItem(SLOT_KEY, 'not-json');

      restoreFromStorage();

      expect(getEditorOverlayVisible()).toBe(false);
      expect(getVimMode()).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to load editor overlay state from localStorage:',
        expect.any(SyntaxError),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('restoreFromStorage should fall back to defaults when the slot has no entry', () => {
    setEditorOverlayVisible(true);
    toggleVimMode();
    localStorage.clear();

    restoreFromStorage();

    expect(getEditorOverlayVisible()).toBe(false);
    expect(getVimMode()).toBe(false);
  });

  it('toggleEditorOverlay should flip isVisible', () => {
    expect(getEditorOverlayVisible()).toBe(false);
    toggleEditorOverlay();
    expect(getEditorOverlayVisible()).toBe(true);
    toggleEditorOverlay();
    expect(getEditorOverlayVisible()).toBe(false);
  });

  it('toggleEditorOverlay should persist to localStorage', () => {
    toggleEditorOverlay();

    expect(JSON.parse(localStorage.getItem(SLOT_KEY)!).isVisible).toBe(true);
  });

  it('toggleEditorOverlay should not affect vimMode', () => {
    toggleVimMode();
    expect(getVimMode()).toBe(true);
    toggleEditorOverlay();
    expect(getVimMode()).toBe(true);
  });

  it('setEditorOverlayVisible should set visibility directly', () => {
    setEditorOverlayVisible(true);
    expect(getEditorOverlayVisible()).toBe(true);
    setEditorOverlayVisible(false);
    expect(getEditorOverlayVisible()).toBe(false);
  });

  it('setEditorOverlayVisible should persist to localStorage', () => {
    setEditorOverlayVisible(true);

    expect(JSON.parse(localStorage.getItem(SLOT_KEY)!).isVisible).toBe(true);
  });

  it('toggleVimMode should flip vimMode', () => {
    expect(getVimMode()).toBe(false);
    toggleVimMode();
    expect(getVimMode()).toBe(true);
    toggleVimMode();
    expect(getVimMode()).toBe(false);
  });

  it('toggleVimMode should persist to localStorage', () => {
    toggleVimMode();

    expect(JSON.parse(localStorage.getItem(SLOT_KEY)!).vimMode).toBe(true);
  });

  it('toggleVimMode should not affect isVisible', () => {
    toggleEditorOverlay();
    expect(getEditorOverlayVisible()).toBe(true);
    toggleVimMode();
    expect(getEditorOverlayVisible()).toBe(true);
  });

  it('restores state independently per slot', () => {
    localStorage.setItem(SLOT_KEY, JSON.stringify({ isVisible: true, vimMode: false }));
    localStorage.setItem(OTHER_SLOT_KEY, JSON.stringify({ isVisible: false, vimMode: true }));

    setLayoutSlot('vscode:1');
    restoreFromStorage();
    expect(getEditorOverlayVisible()).toBe(true);
    expect(getVimMode()).toBe(false);

    setLayoutSlot('vscode:2');
    restoreFromStorage();
    expect(getEditorOverlayVisible()).toBe(false);
    expect(getVimMode()).toBe(true);
  });

  it('persists under the unslotted key before a slot is assigned', () => {
    setLayoutSlot(null);

    toggleEditorOverlay();

    expect(JSON.parse(localStorage.getItem('shader-studio-editor-overlay-state')!).isVisible).toBe(true);
    expect(localStorage.getItem(SLOT_KEY)).toBe(null);
  });

  it('warns and keeps state when persisting fails', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    try {
      toggleEditorOverlay();

      expect(getEditorOverlayVisible()).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to save editor overlay state to localStorage:',
        expect.any(Error),
      );
    } finally {
      setItem.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
