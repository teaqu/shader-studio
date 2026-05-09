import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

const STORAGE_KEY = 'shader-studio-theme';

async function createFreshStore() {
  const { currentTheme, applyTheme, toggleTheme, snapshotTheme, applyThemeProfile } = await import('../../lib/stores/themeStore');
  return { currentTheme, applyTheme, toggleTheme, snapshotTheme, applyThemeProfile };
}

describe('themeStore', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    document.documentElement.removeAttribute('data-theme');
    vi.resetModules();
  });

  describe('default state', () => {
    it('should default to light theme when no saved theme', async () => {
      const { currentTheme } = await createFreshStore();
      expect(get(currentTheme)).toBe('light');
    });

    it('should use saved theme from localStorage', async () => {
      localStorage.setItem(STORAGE_KEY, 'dark');
      const { currentTheme } = await createFreshStore();
      expect(get(currentTheme)).toBe('dark');
    });

    it('should apply default theme to document on load', async () => {
      await createFreshStore();
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });

    it('should apply saved dark theme to document on load', async () => {
      localStorage.setItem(STORAGE_KEY, 'dark');
      await createFreshStore();
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
  });

  describe('applyTheme', () => {
    it('should set data-theme attribute on document element', async () => {
      const { applyTheme } = await createFreshStore();
      applyTheme('dark');
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    it('should save theme to localStorage', async () => {
      const { applyTheme } = await createFreshStore();
      applyTheme('dark');
      expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
    });

    it('should overwrite previously saved theme', async () => {
      const { applyTheme } = await createFreshStore();
      applyTheme('dark');
      applyTheme('light');
      expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });
  });

  describe('toggleTheme', () => {
    it('should toggle from light to dark', async () => {
      const { currentTheme, toggleTheme } = await createFreshStore();
      expect(get(currentTheme)).toBe('light');
      toggleTheme();
      expect(get(currentTheme)).toBe('dark');
    });

    it('should toggle from dark to light', async () => {
      localStorage.setItem(STORAGE_KEY, 'dark');
      const { currentTheme, toggleTheme } = await createFreshStore();
      expect(get(currentTheme)).toBe('dark');
      toggleTheme();
      expect(get(currentTheme)).toBe('light');
    });

    it('should apply the toggled theme to document', async () => {
      const { toggleTheme } = await createFreshStore();
      toggleTheme();
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    it('should persist the toggled theme to localStorage', async () => {
      const { toggleTheme } = await createFreshStore();
      toggleTheme();
      expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
    });

    it('should round-trip back to original after two toggles', async () => {
      const { currentTheme, toggleTheme } = await createFreshStore();
      toggleTheme();
      toggleTheme();
      expect(get(currentTheme)).toBe('light');
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
      expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
    });
  });

  describe('store subscription behavior', () => {
    it('should notify subscribers on toggle', async () => {
      const { currentTheme, toggleTheme } = await createFreshStore();
      const values: string[] = [];
      const unsubscribe = currentTheme.subscribe(theme => values.push(theme));
      toggleTheme();
      toggleTheme();
      unsubscribe();
      expect(values).toEqual(['light', 'dark', 'light']);
    });
  });

  describe('snapshotTheme', () => {
    it('returns current theme value', async () => {
      const { snapshotTheme } = await createFreshStore();
      expect(snapshotTheme()).toBe('light');
    });

    it('returns dark after toggling', async () => {
      const { toggleTheme, snapshotTheme } = await createFreshStore();
      toggleTheme();
      expect(snapshotTheme()).toBe('dark');
    });

    it('returns saved theme from localStorage', async () => {
      localStorage.setItem(STORAGE_KEY, 'dark');
      const { snapshotTheme } = await createFreshStore();
      expect(snapshotTheme()).toBe('dark');
    });
  });

  describe('applyThemeProfile', () => {
    it('sets the theme store to the given value', async () => {
      const { currentTheme, applyThemeProfile } = await createFreshStore();
      applyThemeProfile('dark');
      expect(get(currentTheme)).toBe('dark');
    });

    it('applies data-theme attribute to document', async () => {
      const { applyThemeProfile } = await createFreshStore();
      applyThemeProfile('dark');
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    it('persists theme to localStorage', async () => {
      const { applyThemeProfile } = await createFreshStore();
      applyThemeProfile('dark');
      expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
    });

    it('can switch back to light', async () => {
      const { currentTheme, applyThemeProfile } = await createFreshStore();
      applyThemeProfile('dark');
      applyThemeProfile('light');
      expect(get(currentTheme)).toBe('light');
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });
  });
});
