import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';

// Re-create the store for each test by dynamically importing
// after clearing localStorage.
const STORAGE_KEY = 'shader-studio-audio';

async function createFreshStore() {
  // Clear module cache so the store is re-created
  const modules = Object.keys(await import.meta.glob('../../lib/stores/audioStore.ts'));
  for (const mod of modules) {
    // Dynamic re-import won't work with cached modules, use the factory directly
  }
  // Since we can't easily invalidate the module cache in vitest,
  // we test via the exported store and reset localStorage between tests.
  const { audioStore, linearToPerceptualVolume } = await import('../../lib/stores/audioStore');
  return { audioStore, linearToPerceptualVolume };
}

describe('audioStore', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  describe('linearToPerceptualVolume', () => {
    it('should return 0 for 0', async () => {
      const { linearToPerceptualVolume } = await createFreshStore();
      expect(linearToPerceptualVolume(0)).toBe(0);
    });

    it('should return 1 for 1', async () => {
      const { linearToPerceptualVolume } = await createFreshStore();
      expect(linearToPerceptualVolume(1)).toBe(1);
    });

    it('should return cube of input (power curve)', async () => {
      const { linearToPerceptualVolume } = await createFreshStore();
      expect(linearToPerceptualVolume(0.5)).toBeCloseTo(0.125);
    });

    it('should clamp values above 1', async () => {
      const { linearToPerceptualVolume } = await createFreshStore();
      expect(linearToPerceptualVolume(2)).toBe(1);
    });

    it('should clamp values below 0', async () => {
      const { linearToPerceptualVolume } = await createFreshStore();
      expect(linearToPerceptualVolume(-1)).toBe(0);
    });
  });

  describe('setVolume', () => {
    it('should update volume and persist', async () => {
      const { audioStore } = await createFreshStore();
      audioStore.setVolume(0.5);
      expect(get(audioStore).volume).toBe(0.5);
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(stored.volume).toBe(0.5);
    });

    it('should clamp volume to 0-1 range', async () => {
      const { audioStore } = await createFreshStore();
      audioStore.setVolume(1.5);
      expect(get(audioStore).volume).toBe(1);
      audioStore.setVolume(-0.5);
      expect(get(audioStore).volume).toBe(0);
    });
  });

  describe('setMuted', () => {
    it('should update muted and persist', async () => {
      const { audioStore } = await createFreshStore();
      audioStore.setMuted(false);
      expect(get(audioStore).muted).toBe(false);
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(stored.muted).toBe(false);
    });
  });

  describe('toggleMute', () => {
    it('should toggle muted state', async () => {
      const { audioStore } = await createFreshStore();
      const initial = get(audioStore).muted;
      audioStore.toggleMute();
      expect(get(audioStore).muted).toBe(!initial);
      audioStore.toggleMute();
      expect(get(audioStore).muted).toBe(initial);
    });
  });
});
