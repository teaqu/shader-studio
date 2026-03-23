import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

describe('compileModeStore', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  async function importStore() {
    const mod = await import('../../lib/stores/compileModeStore');
    return mod.compileModeStore;
  }

  it('defaults to hot mode', async () => {
    const store = await importStore();
    expect(get(store).mode).toBe('hot');
  });

  it('loads stored mode from localStorage', async () => {
    localStorage.setItem('shader-studio-compile-mode', JSON.stringify({ mode: 'manual' }));
    const store = await importStore();
    expect(get(store).mode).toBe('manual');
  });

  it('ignores invalid stored mode', async () => {
    localStorage.setItem('shader-studio-compile-mode', JSON.stringify({ mode: 'invalid' }));
    const store = await importStore();
    expect(get(store).mode).toBe('hot');
  });

  it('falls back to hot on invalid JSON and warns', async () => {
    localStorage.setItem('shader-studio-compile-mode', 'not-json');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const store = await importStore();

    expect(get(store).mode).toBe('hot');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('setMode updates and persists mode', async () => {
    const store = await importStore();

    store.setMode('save');

    expect(get(store).mode).toBe('save');
    expect(JSON.parse(localStorage.getItem('shader-studio-compile-mode') || '{}')).toEqual({ mode: 'save' });
  });

  it('cycleMode rotates hot -> save -> manual -> hot', async () => {
    const store = await importStore();

    store.cycleMode();
    expect(get(store).mode).toBe('save');

    store.cycleMode();
    expect(get(store).mode).toBe('manual');

    store.cycleMode();
    expect(get(store).mode).toBe('hot');
    expect(JSON.parse(localStorage.getItem('shader-studio-compile-mode') || '{}')).toEqual({ mode: 'hot' });
  });
});
