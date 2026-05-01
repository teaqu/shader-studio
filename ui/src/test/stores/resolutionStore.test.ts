import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

const STORAGE_KEY = 'shader-studio-resolution';
const OLD_QUALITY_KEY = 'shader-studio-quality';

describe('resolutionStore', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  async function importStore() {
    const mod = await import('../../lib/stores/resolutionStore');
    return mod.resolutionStore;
  }

  // --- Default state ---

  it('should have default initial state', async () => {
    const store = await importStore();
    const state = get(store);
    expect(state.scale).toBe(1);
    expect(state.source).toBe('session');
    expect(state.width).toBeUndefined();
    expect(state.height).toBeUndefined();
  });

  // --- localStorage persistence (not saved to config) ---

  it('should persist scale to localStorage when not saved to config', async () => {
    const store = await importStore();
    store.setScale(2);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.scale).toBe(2);
  });

  it('should persist custom resolution to localStorage when not saved to config', async () => {
    const store = await importStore();
    store.setCustomResolution('512', '256');
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.width).toBe('512');
    expect(stored.height).toBe('256');
  });

  it('should remove custom dimensions from localStorage when clearing', async () => {
    const store = await importStore();
    store.setCustomResolution('512', '256');
    store.clearCustomResolution();
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.width).toBeUndefined();
    expect(stored.height).toBeUndefined();
  });

  // --- Manual changes detach from config ownership ---

  it('should unsave config ownership when scale is changed manually', async () => {
    const store = await importStore();
    store.setScale(1);
    store.setSource('config');
    store.setScale(4);

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.scale).toBe(4);

    const state = get(store);
    expect(state.scale).toBe(4);
    expect(state.source).toBe('session');
  });

  it('should unsave config ownership when custom resolution is changed manually', async () => {
    const store = await importStore();
    store.setScale(1);
    store.setSource('config');
    store.setCustomResolution('1920', '1080');

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.width).toBe('1920');
    expect(stored.height).toBe('1080');

    const state = get(store);
    expect(state.width).toBe('1920');
    expect(state.height).toBe('1080');
    expect(state.source).toBe('session');
  });

  it('should unsave config ownership when clearing custom resolution manually', async () => {
    const store = await importStore();
    store.setCustomResolution('800', '600');
    store.setSource('config');
    store.clearCustomResolution();

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.width).toBeUndefined();
    expect(stored.height).toBeUndefined();

    const state = get(store);
    expect(state.width).toBeUndefined();
    expect(state.height).toBeUndefined();
    expect(state.source).toBe('session');
  });

  it('should keep persisting multiple manual scale changes after detaching from config', async () => {
    const store = await importStore();
    store.setScale(1);
    store.setSource('config');
    store.setScale(0.25);
    store.setScale(0.5);
    store.setScale(4);

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.scale).toBe(4);
    expect(get(store).scale).toBe(4);
    expect(get(store).source).toBe('session');
  });

  it('should resume persisting to localStorage after unsaving from config', async () => {
    const store = await importStore();
    store.setSource('config');
    store.setScale(2);
    const during = localStorage.getItem(STORAGE_KEY);

    store.setSource('session');
    store.setScale(0.5);
    const after = JSON.parse(localStorage.getItem(STORAGE_KEY)!);

    expect(after.scale).toBe(0.5);
    expect(during).not.toBe(localStorage.getItem(STORAGE_KEY));
  });

  // --- Loading from localStorage ---

  it('should load from localStorage on init', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ scale: 0.25 }));
    const store = await importStore();
    const state = get(store);
    expect(state.scale).toBe(0.25);
    expect(state.source).toBe('session');
  });

  it('should load custom resolution from localStorage on init', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ scale: 1, width: 512, height: 256 }));
    const store = await importStore();
    const state = get(store);
    expect(state.width).toBe('512');
    expect(state.height).toBe('256');
  });

  it('should discard percentage custom resolution from localStorage on init', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ scale: 1, width: '50%', height: '50%' }));
    const store = await importStore();
    const state = get(store);
    expect(state.width).toBeUndefined();
    expect(state.height).toBeUndefined();
  });

  it('should never load savedToConfig as true from localStorage', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ scale: 2, savedToConfig: true }));
    const store = await importStore();
    expect(get(store).source).toBe('session');
  });

  // --- Migration ---

  it('should migrate old SD quality to scale 0.5', async () => {
    localStorage.setItem(OLD_QUALITY_KEY, JSON.stringify({ mode: 'SD' }));
    const store = await importStore();
    expect(get(store).scale).toBe(0.5);
    expect(localStorage.getItem(OLD_QUALITY_KEY)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it('should migrate old HD quality to scale 1', async () => {
    localStorage.setItem(OLD_QUALITY_KEY, JSON.stringify({ mode: 'HD' }));
    const store = await importStore();
    expect(get(store).scale).toBe(1);
    expect(localStorage.getItem(OLD_QUALITY_KEY)).toBeNull();
  });

  // --- setFromConfig ---

  it('setFromConfig should hydrate from config settings', async () => {
    const store = await importStore();
    store.setFromConfig({ scale: 2, width: 512, height: 256 });
    const state = get(store);
    expect(state.scale).toBe(2);
    expect(state.width).toBe('512');
    expect(state.height).toBe('256');
    expect(state.source).toBe('config');
  });

  it('setFromConfig should discard percentage custom dimensions', async () => {
    const store = await importStore();
    store.setFromConfig({ scale: 2, width: '50%', height: '50%' } as any);
    const state = get(store);
    expect(state.scale).toBe(2);
    expect(state.width).toBeUndefined();
    expect(state.height).toBeUndefined();
    expect(state.source).toBe('config');
  });

  it('setFromConfig with undefined should fall back to global defaults', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ scale: 0.5 }));
    const store = await importStore();
    store.setFromConfig(undefined);
    const state = get(store);
    expect(state.scale).toBe(0.5);
    expect(state.source).toBe('session');
  });

  it('setFromConfig should default missing fields', async () => {
    const store = await importStore();
    store.setFromConfig({});
    const state = get(store);
    expect(state.scale).toBe(1);
    expect(state.width).toBeUndefined();
    expect(state.height).toBeUndefined();
    expect(state.source).toBe('config');
  });

  // --- setFromConfig no-op guard ---

  it('setFromConfig should not notify subscribers when called with same config settings', async () => {
    const store = await importStore();
    store.setFromConfig({ scale: 2, width: 512, height: 256 });

    let callCount = 0;
    const unsub = store.subscribe(() => {
      callCount++; 
    });
    // subscribe fires once immediately
    callCount = 0;

    // Call again with identical values — should be a no-op
    store.setFromConfig({ scale: 2, width: 512, height: 256 });
    expect(callCount).toBe(0);
    unsub();
  });

  it('setFromConfig should not notify subscribers when called repeatedly with undefined and no config saved', async () => {
    const store = await importStore();
    // Initial state: savedToConfig = false (global defaults)

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

  it('setFromConfig should notify subscribers when config values actually change', async () => {
    const store = await importStore();
    store.setFromConfig({ scale: 1 });

    let callCount = 0;
    const unsub = store.subscribe(() => {
      callCount++; 
    });
    callCount = 0;

    store.setFromConfig({ scale: 2 });
    expect(callCount).toBe(1);
    expect(get(store).scale).toBe(2);
    unsub();
  });

  it('setFromConfig should notify when switching from config to global defaults', async () => {
    const store = await importStore();
    store.setFromConfig({ scale: 2 });
    expect(get(store).source).toBe('config');

    let callCount = 0;
    const unsub = store.subscribe(() => {
      callCount++;
    });
    callCount = 0;

    store.setFromConfig(undefined);
    expect(callCount).toBe(1);
    expect(get(store).source).toBe('session');
    unsub();
  });

  it('setFromConfig should notify when switching from global defaults to config', async () => {
    const store = await importStore();
    // Start with global defaults (savedToConfig = false)

    let callCount = 0;
    const unsub = store.subscribe(() => {
      callCount++; 
    });
    callCount = 0;

    store.setFromConfig({ scale: 1 });
    expect(callCount).toBe(1);
    expect(get(store).source).toBe('config');
    unsub();
  });

  it('setFromConfig should detect width change', async () => {
    const store = await importStore();
    store.setFromConfig({ scale: 1, width: 512, height: 512 });

    let callCount = 0;
    const unsub = store.subscribe(() => {
      callCount++; 
    });
    callCount = 0;

    store.setFromConfig({ scale: 1, width: 1024, height: 512 });
    expect(callCount).toBe(1);
    expect(get(store).width).toBe('1024');
    unsub();
  });

  // --- setScale with custom resolution ---

  it('should preserve custom resolution when setScale is called', async () => {
    const store = await importStore();
    store.setCustomResolution('320', '240');
    store.setScale(2);
    const state = get(store);
    expect(state.scale).toBe(2);
    expect(state.width).toBe('320');
    expect(state.height).toBe('240');
  });

  it('should keep scale state separate from custom resolution dimensions', async () => {
    const store = await importStore();
    store.setCustomResolution('100', '50');
    store.setScale(4);
    const state = get(store);
    expect(state.scale).toBe(4);
    expect(state.width).toBe('100');
    expect(state.height).toBe('50');
  });

  // --- Reset ---

  describe('reset', () => {
    it('should restore default scale of 1', async () => {
      const store = await importStore();
      store.setScale(4);
      store.reset();
      expect(get(store).scale).toBe(1);
    });

    it('should clear custom resolution', async () => {
      const store = await importStore();
      store.setCustomResolution('1920', '1080');
      store.reset();
      const state = get(store);
      expect(state.width).toBeUndefined();
      expect(state.height).toBeUndefined();
    });

    it('should clear savedToConfig flag', async () => {
      const store = await importStore();
      store.setSource('config');
      store.reset();
      expect(get(store).source).toBe('session');
    });

    it('should preserve savedToConfig as false when it was false', async () => {
      const store = await importStore();
      expect(get(store).source).toBe('session');
      store.setScale(4);
      store.reset();
      expect(get(store).source).toBe('session');
    });

    it('should persist defaults to localStorage when not saved to config', async () => {
      const store = await importStore();
      store.setScale(4);
      store.reset();
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(stored.scale).toBe(1);
    });

    it('should clear custom resolution from localStorage when not saved to config', async () => {
      const store = await importStore();
      store.setCustomResolution('800', '600');
      store.reset();
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(stored.width).toBeUndefined();
      expect(stored.height).toBeUndefined();
    });

    it('should persist reset defaults even when previously saved to config', async () => {
      const store = await importStore();
      store.setScale(2);

      store.setSource('config');
      store.setScale(4);
      store.reset();

      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(stored.scale).toBe(1);
    });

    it('should reset scale and custom even when savedToConfig is true', async () => {
      const store = await importStore();
      store.setFromConfig({ scale: 4, width: 2560, height: 1440 });
      expect(get(store).source).toBe('config');

      store.reset();
      const state = get(store);
      expect(state.scale).toBe(1);
      expect(state.width).toBeUndefined();
      expect(state.height).toBeUndefined();
      expect(state.source).toBe('session');
    });

    it('should allow normal persistence after reset when not saved to config', async () => {
      const store = await importStore();
      store.reset();
      store.setScale(2);
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(stored.scale).toBe(2);
    });

    it('should reset scale and custom and clear savedToConfig in a single operation', async () => {
      const store = await importStore();
      store.setScale(0.25);
      store.setCustomResolution('640', '480');
      store.setSource('config');

      store.reset();

      const state = get(store);
      expect(state.scale).toBe(1);
      expect(state.width).toBeUndefined();
      expect(state.height).toBeUndefined();
      expect(state.source).toBe('session');
    });

    it('should be idempotent', async () => {
      const store = await importStore();
      store.setScale(4);
      store.reset();
      store.reset();
      store.reset();
      expect(get(store).scale).toBe(1);
    });
  });
});
