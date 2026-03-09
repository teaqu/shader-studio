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
    expect(state.savedToConfig).toBe(false);
    expect(state.customWidth).toBeUndefined();
    expect(state.customHeight).toBeUndefined();
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
    expect(stored.customWidth).toBe('512');
    expect(stored.customHeight).toBe('256');
  });

  it('should remove custom dimensions from localStorage when clearing', async () => {
    const store = await importStore();
    store.setCustomResolution('512', '256');
    store.clearCustomResolution();
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.customWidth).toBeUndefined();
    expect(stored.customHeight).toBeUndefined();
  });

  // --- No localStorage persistence when saved to config ---

  it('should NOT persist scale to localStorage when saved to config', async () => {
    const store = await importStore();
    store.setScale(1);
    const before = localStorage.getItem(STORAGE_KEY);

    store.setSavedToConfig(true);
    store.setScale(4);

    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);

    const state = get(store);
    expect(state.scale).toBe(4);
    expect(state.savedToConfig).toBe(true);
  });

  it('should NOT persist custom resolution to localStorage when saved to config', async () => {
    const store = await importStore();
    store.setScale(1);
    const before = localStorage.getItem(STORAGE_KEY);

    store.setSavedToConfig(true);
    store.setCustomResolution('1920', '1080');

    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);

    const state = get(store);
    expect(state.customWidth).toBe('1920');
    expect(state.customHeight).toBe('1080');
  });

  it('should NOT update localStorage when clearing custom resolution while saved to config', async () => {
    const store = await importStore();
    store.setCustomResolution('800', '600');
    const before = localStorage.getItem(STORAGE_KEY);

    store.setSavedToConfig(true);
    store.clearCustomResolution();

    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);

    const state = get(store);
    expect(state.customWidth).toBeUndefined();
    expect(state.customHeight).toBeUndefined();
  });

  it('should NOT persist multiple scale changes while saved to config', async () => {
    const store = await importStore();
    store.setScale(1);
    const before = localStorage.getItem(STORAGE_KEY);

    store.setSavedToConfig(true);
    store.setScale(0.25);
    store.setScale(0.5);
    store.setScale(4);

    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
    expect(get(store).scale).toBe(4);
  });

  it('should resume persisting to localStorage after unsaving from config', async () => {
    const store = await importStore();
    store.setSavedToConfig(true);
    store.setScale(2);
    const during = localStorage.getItem(STORAGE_KEY);

    store.setSavedToConfig(false);
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
    expect(state.savedToConfig).toBe(false);
  });

  it('should load custom resolution from localStorage on init', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ scale: 1, customWidth: '50%', customHeight: '50%' }));
    const store = await importStore();
    const state = get(store);
    expect(state.customWidth).toBe('50%');
    expect(state.customHeight).toBe('50%');
  });

  it('should never load savedToConfig as true from localStorage', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ scale: 2, savedToConfig: true }));
    const store = await importStore();
    expect(get(store).savedToConfig).toBe(false);
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
    store.setFromConfig({ scale: 2, customWidth: '50%', customHeight: '50%' });
    const state = get(store);
    expect(state.scale).toBe(2);
    expect(state.customWidth).toBe('50%');
    expect(state.customHeight).toBe('50%');
    expect(state.savedToConfig).toBe(true);
  });

  it('setFromConfig with undefined should fall back to global defaults', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ scale: 0.5 }));
    const store = await importStore();
    store.setFromConfig(undefined);
    const state = get(store);
    expect(state.scale).toBe(0.5);
    expect(state.savedToConfig).toBe(false);
  });

  it('setFromConfig should default missing fields', async () => {
    const store = await importStore();
    store.setFromConfig({});
    const state = get(store);
    expect(state.scale).toBe(1);
    expect(state.customWidth).toBeUndefined();
    expect(state.customHeight).toBeUndefined();
    expect(state.savedToConfig).toBe(true);
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
      expect(state.customWidth).toBeUndefined();
      expect(state.customHeight).toBeUndefined();
    });

    it('should NOT change savedToConfig flag', async () => {
      const store = await importStore();
      store.setSavedToConfig(true);
      store.reset();
      expect(get(store).savedToConfig).toBe(true);
    });

    it('should preserve savedToConfig as false when it was false', async () => {
      const store = await importStore();
      expect(get(store).savedToConfig).toBe(false);
      store.setScale(4);
      store.reset();
      expect(get(store).savedToConfig).toBe(false);
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
      expect(stored.customWidth).toBeUndefined();
      expect(stored.customHeight).toBeUndefined();
    });

    it('should NOT persist to localStorage when saved to config', async () => {
      const store = await importStore();
      store.setScale(2);
      const before = localStorage.getItem(STORAGE_KEY);

      store.setSavedToConfig(true);
      store.setScale(4);
      store.reset();

      // localStorage should still have the value from before savedToConfig was set
      expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
    });

    it('should reset scale and custom even when savedToConfig is true', async () => {
      const store = await importStore();
      store.setFromConfig({ scale: 4, customWidth: '2560', customHeight: '1440' });
      expect(get(store).savedToConfig).toBe(true);

      store.reset();
      const state = get(store);
      expect(state.scale).toBe(1);
      expect(state.customWidth).toBeUndefined();
      expect(state.customHeight).toBeUndefined();
      expect(state.savedToConfig).toBe(true);
    });

    it('should allow normal persistence after reset when not saved to config', async () => {
      const store = await importStore();
      store.reset();
      store.setScale(2);
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(stored.scale).toBe(2);
    });

    it('should reset scale and custom but keep savedToConfig in a single operation', async () => {
      const store = await importStore();
      store.setScale(0.25);
      store.setCustomResolution('640', '480');
      store.setSavedToConfig(true);

      store.reset();

      const state = get(store);
      expect(state.scale).toBe(1);
      expect(state.customWidth).toBeUndefined();
      expect(state.customHeight).toBeUndefined();
      expect(state.savedToConfig).toBe(true);
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
