import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

const STORAGE_KEY = 'shader-studio-audio';

async function createFreshStore() {
  const { audioStore, linearToPerceptualVolume } = await import('../../lib/stores/audioStore');
  return { audioStore, linearToPerceptualVolume };
}

describe('audioStore', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    vi.resetModules();
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

  describe('localStorage corruption/missing data', () => {
    it('should handle corrupted JSON in localStorage gracefully', async () => {
      localStorage.setItem(STORAGE_KEY, '{not valid json!!!');
      const { audioStore } = await createFreshStore();
      const state = get(audioStore);
      expect(state.volume).toBe(1.0);
      expect(state.muted).toBe(true);
    });

    it('should handle localStorage with missing volume field', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ muted: false }));
      const { audioStore } = await createFreshStore();
      const state = get(audioStore);
      expect(state.volume).toBe(1.0);
      expect(state.muted).toBe(false);
    });

    it('should handle localStorage with missing muted field', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ volume: 0.7 }));
      const { audioStore } = await createFreshStore();
      const state = get(audioStore);
      expect(state.volume).toBe(0.7);
      expect(state.muted).toBe(true);
    });

    it('should handle localStorage with non-number volume', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ volume: 'loud', muted: false }));
      const { audioStore } = await createFreshStore();
      const state = get(audioStore);
      expect(state.volume).toBe(1.0);
      expect(state.muted).toBe(false);
    });

    it('should handle localStorage with non-boolean muted', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ volume: 0.5, muted: 'yes' }));
      const { audioStore } = await createFreshStore();
      const state = get(audioStore);
      expect(state.volume).toBe(0.5);
      expect(state.muted).toBe(true);
    });

    it('should clamp volume outside 0-1 range from localStorage', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ volume: 5.0, muted: false }));
      const { audioStore } = await createFreshStore();
      expect(get(audioStore).volume).toBe(1);

      vi.resetModules();
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ volume: -3.0, muted: false }));
      const { audioStore: audioStore2 } = await createFreshStore();
      expect(get(audioStore2).volume).toBe(0);
    });
  });

  describe('store subscription behavior', () => {
    it('should notify subscribers on volume change', async () => {
      const { audioStore } = await createFreshStore();
      const values: number[] = [];
      const unsubscribe = audioStore.subscribe(state => values.push(state.volume));
      audioStore.setVolume(0.3);
      audioStore.setVolume(0.8);
      unsubscribe();
      // First value is the initial subscription callback, then two updates
      expect(values).toEqual([1.0, 0.3, 0.8]);
    });

    it('should notify subscribers on muted change', async () => {
      const { audioStore } = await createFreshStore();
      const values: boolean[] = [];
      const unsubscribe = audioStore.subscribe(state => values.push(state.muted));
      audioStore.setMuted(false);
      audioStore.setMuted(true);
      unsubscribe();
      expect(values).toEqual([true, false, true]);
    });

    it('should notify subscribers on toggleMute', async () => {
      const { audioStore } = await createFreshStore();
      const values: boolean[] = [];
      const unsubscribe = audioStore.subscribe(state => values.push(state.muted));
      audioStore.toggleMute();
      audioStore.toggleMute();
      unsubscribe();
      // Default muted is true, toggle to false, toggle back to true
      expect(values).toEqual([true, false, true]);
    });
  });

  describe('linearToPerceptualVolume edge cases', () => {
    it('should return correct value for 0.25', async () => {
      const { linearToPerceptualVolume } = await createFreshStore();
      expect(linearToPerceptualVolume(0.25)).toBeCloseTo(0.015625);
    });

    it('should return correct value for 0.75', async () => {
      const { linearToPerceptualVolume } = await createFreshStore();
      expect(linearToPerceptualVolume(0.75)).toBeCloseTo(0.421875);
    });

    it('should handle very small values near zero', async () => {
      const { linearToPerceptualVolume } = await createFreshStore();
      const result = linearToPerceptualVolume(0.001);
      expect(result).toBeCloseTo(0.000000001);
      expect(result).toBeGreaterThan(0);
    });

    it('should handle NaN input (returns NaN since Math.max/min do not clamp NaN)', async () => {
      const { linearToPerceptualVolume } = await createFreshStore();
      expect(linearToPerceptualVolume(NaN)).toBeNaN();
    });
  });

  describe('multiple rapid updates', () => {
    it('should result in latest value after multiple setVolume calls', async () => {
      const { audioStore } = await createFreshStore();
      audioStore.setVolume(0.1);
      audioStore.setVolume(0.2);
      audioStore.setVolume(0.3);
      audioStore.setVolume(0.9);
      expect(get(audioStore).volume).toBe(0.9);
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(stored.volume).toBe(0.9);
    });

    it('should track correctly after toggling mute multiple times rapidly', async () => {
      const { audioStore } = await createFreshStore();
      const initial = get(audioStore).muted;
      // Toggle 5 times — odd number of toggles should flip the state
      audioStore.toggleMute();
      audioStore.toggleMute();
      audioStore.toggleMute();
      audioStore.toggleMute();
      audioStore.toggleMute();
      expect(get(audioStore).muted).toBe(!initial);
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(stored.muted).toBe(!initial);
    });
  });
});
