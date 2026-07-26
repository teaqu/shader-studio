import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'shader-studio-preview-3d:v1';

async function importState() {
  const modulePath = '../../lib/state/preview3dState.svelte.ts';
  return import(/* @vite-ignore */ modulePath);
}

describe('preview3dState', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('starts with a fresh immutable 2D cube preview', async () => {
    const state = await importState();

    const settings = state.getPreviewSettings();
    expect(settings).toEqual({
      mode: '2d',
      mesh: 'cube',
      mapping: { scale: [1, 1], offset: [0, 0], rotation: 0, wrap: 'repeat' },
      object: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      lighting: 'unlit',
      scene: { grid: true, axes: true },
    });
    expect(Object.isFrozen(settings)).toBe(true);
    expect(Object.isFrozen(settings.mapping.scale)).toBe(true);
  });

  it('persists updates in a versioned record and returns immutable snapshots', async () => {
    const state = await importState();

    state.setPreviewMode('3d');
    state.setPreviewMesh('sphere');
    state.setPreviewMappingScale(0, 5);
    state.setPreviewMappingOffset(1, -3);
    state.setPreviewMappingRotation(Math.PI / 2);
    state.setPreviewWrapMode('mirror');
    state.setPreviewObjectPosition(2, 4);
    state.setPreviewObjectRotation(1, Math.PI / 3);
    state.setPreviewObjectScale(2);
    state.setPreviewLightingMode('lit');
    state.setPreviewGridVisible(false);
    state.setPreviewAxesVisible(false);

    const settings = state.getPreviewSettings();
    expect(settings).toMatchObject({
      mode: '3d', mesh: 'sphere', lighting: 'lit',
      mapping: { scale: [5, 1], offset: [0, -3], rotation: Math.PI / 2, wrap: 'mirror' },
      object: { position: [0, 0, 4], rotation: [0, Math.PI / 3, 0], scale: [2, 2, 2] },
      scene: { grid: false, axes: false },
    });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({ version: 1, settings });

    const later = state.getPreviewSettings();
    expect(later).not.toBe(settings);
    expect(later.mapping).not.toBe(settings.mapping);
    expect(Object.isFrozen(later.object.rotation)).toBe(true);
  });

  it('restores a partial stored record field by field', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      settings: {
        mode: '3d',
        mapping: { offset: [2, -2], wrap: 'clamp' },
        object: { position: [1, 2, 3] },
        scene: { axes: false },
      },
    }));
    const state = await importState();

    state.restorePreviewSettingsFromStorage();

    expect(state.getPreviewSettings()).toEqual({
      mode: '3d', mesh: 'cube', lighting: 'unlit',
      mapping: { scale: [1, 1], offset: [2, -2], rotation: 0, wrap: 'clamp' },
      object: { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] },
      scene: { grid: true, axes: false },
    });
  });

  it('rejects invalid enums and clamps every persisted numeric field', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      settings: {
        mode: 'other', mesh: 'model', lighting: 'bright',
        mapping: { scale: [-1, 99], offset: [-99, 99], rotation: 99, wrap: 'bad' },
        object: {
          position: [-99, 99, Number.NaN], rotation: [-99, 99, Number.POSITIVE_INFINITY], scale: [-1, 99, 0],
        },
        scene: { grid: 'yes', axes: 1 },
      },
    }));
    const state = await importState();

    state.restorePreviewSettingsFromStorage();

    expect(state.getPreviewSettings()).toEqual({
      mode: '2d', mesh: 'cube', lighting: 'unlit',
      mapping: { scale: [0.05, 16], offset: [-16, 16], rotation: Math.PI * 2, wrap: 'repeat' },
      object: {
        position: [-20, 20, 0], rotation: [-Math.PI * 2, Math.PI * 2, 0], scale: [0.05, 10, 0.05],
      },
      scene: { grid: true, axes: true },
    });
  });

  it('falls back to defaults for malformed or unsupported storage', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      localStorage.setItem(STORAGE_KEY, '{ no');
      const malformed = await importState();
      malformed.restorePreviewSettingsFromStorage();
      expect(malformed.getPreviewSettings().mode).toBe('2d');
      expect(warn).toHaveBeenCalledWith('Failed to load 3D preview settings from localStorage:', expect.any(SyntaxError));

      vi.resetModules();
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 99, settings: { mode: '3d' } }));
      const unsupported = await importState();
      unsupported.restorePreviewSettingsFromStorage();
      expect(unsupported.getPreviewSettings()).toEqual(malformed.getDefaultPreviewSettings());
    } finally {
      warn.mockRestore();
    }
  });

  it('contains storage access failures without losing in-memory updates', async () => {
    const state = await importState();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { setItem: () => {
        throw new Error('quota');
      } },
    });
    try {
      state.setPreviewMode('3d');
      expect(state.getPreviewSettings().mode).toBe('3d');
      expect(warn).toHaveBeenCalledWith('Failed to save 3D preview settings to localStorage:', expect.any(Error));
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalStorage });
      warn.mockRestore();
    }

    const fresh = await importState();
    const loadWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: () => {
        throw new Error('blocked');
      } },
    });
    try {
      fresh.restorePreviewSettingsFromStorage();
      expect(fresh.getPreviewSettings().mode).toBe('2d');
      expect(loadWarn).toHaveBeenCalledWith('Failed to load 3D preview settings from localStorage:', expect.any(Error));
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalStorage });
      loadWarn.mockRestore();
    }
  });

  it('resets mapping and object independently, persists them, and increments only the camera reset token', async () => {
    const state = await importState();
    state.setPreviewMappingScale(0, 7);
    state.setPreviewMappingOffset(0, 4);
    state.setPreviewObjectPosition(0, 8);
    state.setPreviewObjectRotation(2, 1);
    state.setPreviewObjectScale(3);
    const beforeCamera = state.getPreviewCameraResetToken();

    state.resetPreviewMapping();
    expect(state.getPreviewSettings().mapping).toEqual({ scale: [1, 1], offset: [0, 0], rotation: 0, wrap: 'repeat' });
    expect(state.getPreviewSettings().object.position).toEqual([8, 0, 0]);

    state.resetPreviewObject();
    expect(state.getPreviewSettings().object).toEqual({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });

    state.resetPreviewCamera();
    expect(state.getPreviewCameraResetToken()).toBe(beforeCamera + 1);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).not.toHaveProperty('cameraResetToken');
  });

  it('clamps setters and resets every persisted preference without resetting camera navigation', async () => {
    const state = await importState();
    state.setPreviewMappingScale(1, Number.NaN);
    state.setPreviewObjectPosition(0, Infinity);
    state.setPreviewObjectRotation(2, -99);
    state.setPreviewObjectScale(-3);
    state.setPreviewMode('wrong' as never);
    expect(state.getPreviewSettings()).toMatchObject({
      mapping: { scale: [1, 0.05] }, object: { position: [-20, 0, 0], rotation: [0, 0, -Math.PI * 2], scale: [0.05, 0.05, 0.05] },
    });

    const token = state.getPreviewCameraResetToken();
    state.resetPreviewSettings();
    expect(state.getPreviewSettings()).toEqual(state.getDefaultPreviewSettings());
    expect(state.getPreviewCameraResetToken()).toBe(token);
  });
});
