import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

describe('aspectRatioStore', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  async function importStore() {
    const mod = await import('../../lib/stores/aspectRatioStore');
    return mod.aspectRatioStore;
  }

  it('should have default mode auto and savedToConfig false', async () => {
    const store = await importStore();
    const state = get(store);
    expect(state.mode).toBe('auto');
    expect(state.source).toBe('session');
  });

  it('should load mode from localStorage', async () => {
    localStorage.setItem('shader-studio-aspect-ratio', JSON.stringify({ mode: '4:3' }));
    const store = await importStore();
    expect(get(store).mode).toBe('4:3');
  });

  it('setMode should update and persist to localStorage', async () => {
    const store = await importStore();
    store.setMode('1:1');
    expect(get(store).mode).toBe('1:1');
    const stored = JSON.parse(localStorage.getItem('shader-studio-aspect-ratio')!);
    expect(stored.mode).toBe('1:1');
  });

  it('setMode should set savedToConfig to false', async () => {
    const store = await importStore();
    store.setFromConfig('4:3');
    expect(get(store).source).toBe('config');
    store.setMode('1:1');
    expect(get(store).source).toBe('session');
  });

  // --- setFromConfig ---

  it('setFromConfig should set mode and savedToConfig true', async () => {
    const store = await importStore();
    store.setFromConfig('4:3');
    const state = get(store);
    expect(state.mode).toBe('4:3');
    expect(state.source).toBe('config');
  });

  it('setFromConfig should not notify subscribers when called with same mode', async () => {
    const store = await importStore();
    store.setFromConfig('4:3');

    let callCount = 0;
    const unsub = store.subscribe(() => {
      callCount++; 
    });
    callCount = 0;

    store.setFromConfig('4:3');
    store.setFromConfig('4:3');
    expect(callCount).toBe(0);
    unsub();
  });

  it('setFromConfig should notify subscribers when mode actually changes', async () => {
    const store = await importStore();
    store.setFromConfig('4:3');

    let callCount = 0;
    const unsub = store.subscribe(() => {
      callCount++; 
    });
    callCount = 0;

    store.setFromConfig('1:1');
    expect(callCount).toBe(1);
    expect(get(store).mode).toBe('1:1');
    unsub();
  });

  it('setFromConfig should ignore invalid modes', async () => {
    const store = await importStore();
    store.setFromConfig('4:3');

    let callCount = 0;
    const unsub = store.subscribe(() => {
      callCount++; 
    });
    callCount = 0;

    store.setFromConfig('invalid' as any);
    expect(callCount).toBe(0);
    expect(get(store).mode).toBe('4:3');
    unsub();
  });

  // --- setFromConfig(undefined) resets to default when savedToConfig was true ---

  it('setFromConfig(undefined) should reset to default when previously set from config', async () => {
    const store = await importStore();
    store.setFromConfig('4:3');
    expect(get(store).source).toBe('config');

    let callCount = 0;
    const unsub = store.subscribe(() => {
      callCount++;
    });
    callCount = 0;

    store.setFromConfig(undefined);
    expect(callCount).toBe(1);
    expect(get(store).mode).toBe('auto');
    expect(get(store).source).toBe('session');
    unsub();
  });

  it('setFromConfig(undefined) should restore localStorage value when resetting', async () => {
    localStorage.setItem('shader-studio-aspect-ratio', JSON.stringify({ mode: 'fill' }));
    const store = await importStore();
    store.setFromConfig('4:3');

    store.setFromConfig(undefined);
    expect(get(store).mode).toBe('fill');
    expect(get(store).source).toBe('session');
  });

  it('setFromConfig(undefined) should be no-op when already at global defaults', async () => {
    const store = await importStore();
    // savedToConfig is false by default

    let callCount = 0;
    const unsub = store.subscribe(() => {
      callCount++;
    });
    callCount = 0;

    store.setFromConfig(undefined);
    store.setFromConfig(undefined);
    store.setFromConfig(undefined);
    expect(callCount).toBe(0);
    unsub();
  });

  it('setFromConfig should notify when switching from global defaults to config', async () => {
    const store = await importStore();

    let callCount = 0;
    const unsub = store.subscribe(() => {
      callCount++; 
    });
    callCount = 0;

    store.setFromConfig('4:3');
    expect(callCount).toBe(1);
    expect(get(store).source).toBe('config');
    unsub();
  });

  it('should ignore invalid JSON in localStorage', async () => {
    localStorage.setItem('shader-studio-aspect-ratio', 'not-json!!!');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = await importStore();
    expect(get(store).mode).toBe('auto');
    expect(warnSpy).toHaveBeenCalledWith('Failed to parse stored aspect ratio setting');
    warnSpy.mockRestore();
  });

  it('should ignore stored value with invalid mode', async () => {
    localStorage.setItem('shader-studio-aspect-ratio', JSON.stringify({ mode: 'invalid' }));
    const store = await importStore();
    expect(get(store).mode).toBe('auto');
  });

  // --- reset ---

  it('reset should restore default auto', async () => {
    const store = await importStore();
    store.setMode('fill');
    store.reset();
    expect(get(store).mode).toBe('auto');
  });

  it('reset should persist default to localStorage', async () => {
    const store = await importStore();
    store.setMode('4:3');
    store.reset();
    const stored = JSON.parse(localStorage.getItem('shader-studio-aspect-ratio')!);
    expect(stored.mode).toBe('auto');
  });

  it('reset should set savedToConfig to false', async () => {
    const store = await importStore();
    store.setFromConfig('4:3');
    expect(get(store).source).toBe('config');
    store.reset();
    expect(get(store).source).toBe('session');
  });
});

describe('getAspectRatio', () => {
  async function importHelper() {
    const mod = await import('../../lib/stores/aspectRatioStore');
    return mod.getAspectRatio;
  }

  it('should return 16/9 for 16:9', async () => {
    const getAspectRatio = await importHelper();
    expect(getAspectRatio('16:9')).toBeCloseTo(16 / 9);
  });

  it('should return 4/3 for 4:3', async () => {
    const getAspectRatio = await importHelper();
    expect(getAspectRatio('4:3')).toBeCloseTo(4 / 3);
  });

  it('should return 1 for 1:1', async () => {
    const getAspectRatio = await importHelper();
    expect(getAspectRatio('1:1')).toBe(1);
  });

  it('should return null for fill', async () => {
    const getAspectRatio = await importHelper();
    expect(getAspectRatio('fill')).toBeNull();
  });

  it('should return null for auto', async () => {
    const getAspectRatio = await importHelper();
    expect(getAspectRatio('auto')).toBeNull();
  });

  it('should return 16/9 as default for unknown mode', async () => {
    const getAspectRatio = await importHelper();
    expect(getAspectRatio('unknown' as any)).toBeCloseTo(16 / 9);
  });
});
