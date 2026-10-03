import { describe, expect, it, vi } from 'vitest';
import { ViewerCameraSettings } from '../ViewerCameraSettings';

describe('ViewerCameraSettings', () => {
  it('defaults to true and persists updates in local storage', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    const settings = new ViewerCameraSettings(storage);
    expect(settings.useViewerCamera).toBe(true);

    settings.set(false);
    expect(values.get('shader-studio.webgpu.useViewerCamera')).toBe('false');
    expect(new ViewerCameraSettings(storage).useViewerCamera).toBe(false);
  });

  it('uses the legacy true default for malformed and unreadable values', () => {
    const malformed = new ViewerCameraSettings({
      getItem: () => 'nope',
      setItem: () => undefined,
    });
    const unreadable = new ViewerCameraSettings({
      getItem: () => {
        throw new Error('storage blocked');
      },
      setItem: () => undefined,
    });

    expect(malformed.useViewerCamera).toBe(true);
    expect(unreadable.useViewerCamera).toBe(true);
  });

  it('handles settings messages and ignores malformed updates or unrelated requests', () => {
    const settings = new ViewerCameraSettings({ getItem: () => null, setItem: () => undefined });
    const reply = vi.fn();
    expect(settings.handleMessage('other', {}, reply)).toBe(false);
    expect(settings.handleMessage('updateViewerCameraSettings', { useViewerCamera: 'false' }, reply)).toBe(true);
    expect(reply).not.toHaveBeenCalled();
    settings.handleMessage('requestViewerCameraSettings', {}, reply);
    expect(reply).toHaveBeenLastCalledWith({ type: 'viewerCameraSettings', payload: { useViewerCamera: true } });
    settings.handleMessage('updateViewerCameraSettings', { useViewerCamera: false }, reply);
    expect(reply).toHaveBeenLastCalledWith({ type: 'viewerCameraSettings', payload: { useViewerCamera: false } });
  });

  it('defaults safely when accessing localStorage throws', () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => {
      throw new Error('storage blocked');
    } });
    try {
      expect(new ViewerCameraSettings().useViewerCamera).toBe(true);
    } finally {
      if (previous) {
        Object.defineProperty(globalThis, 'localStorage', previous);
      } else {
        Reflect.deleteProperty(globalThis, 'localStorage');
      }
    }
  });

  it('keeps the new value in memory when storage is unavailable or rejects writes', () => {
    vi.stubGlobal('localStorage', undefined);
    const unavailable = new ViewerCameraSettings();
    const writeBlocked = new ViewerCameraSettings({
      getItem: () => null,
      setItem: () => {
        throw new Error('storage blocked');
      },
    });

    unavailable.set(false);
    writeBlocked.set(false);

    expect(unavailable.useViewerCamera).toBe(false);
    expect(writeBlocked.useViewerCamera).toBe(false);
    vi.unstubAllGlobals();
  });
});
