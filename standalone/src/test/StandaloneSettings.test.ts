import { describe, expect, it, vi } from 'vitest';
import { CAMERA_STORAGE_KEY, DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, StandaloneSettings } from '../settings/StandaloneSettings';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => {
    values.set(key, value);
  } };
}

describe('standalone global settings', () => {
  it('migrates camera preferences and preserves them across reloads', () => {
    const backend = storage();
    backend.setItem(CAMERA_STORAGE_KEY, 'false');
    const settings = new StandaloneSettings(backend);
    expect(settings.snapshot['webgpu.useViewerCamera']).toBe(false);
    settings.update('editor.fontSize', 22);
    expect(new StandaloneSettings(backend).snapshot['editor.fontSize']).toBe(22);
    expect(new StandaloneSettings(backend).snapshot['webgpu.useViewerCamera']).toBe(false);
  });
  it('rejects invalid values without saving or notifying', () => {
    const settings = new StandaloneSettings(storage());
    const listener = vi.fn(); settings.subscribe(listener);
    for (const value of [7, 41, 14.5, NaN, '18']) {
      expect(settings.update('editor.fontSize', value)).toBe(false);
    }
    expect(settings.update('editor.wordWrap', 'invalid')).toBe(false);
    expect(settings.update('editor.insertSpaces', 'false')).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    expect(settings.snapshot).toEqual(DEFAULT_SETTINGS);
  });
  it('loads valid values independently and ignores unknown or malformed values', () => {
    const backend = storage();
    backend.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, values: { 'editor.fontSize': 80, 'editor.tabSize': 2, 'editor.wordWrap': 'on', unrelated: false } }));
    const settings = new StandaloneSettings(backend);
    expect(settings.snapshot['editor.fontSize']).toBe(14);
    expect(settings.snapshot['editor.tabSize']).toBe(2);
    expect(settings.snapshot['editor.wordWrap']).toBe('on');
    expect(Object.keys(settings.snapshot)).toHaveLength(Object.keys(DEFAULT_SETTINGS).length);
  });
  it('notifies on changes and resets, and unsubscribes', () => {
    const settings = new StandaloneSettings(storage()); const listener = vi.fn();
    const unsubscribe = settings.subscribe(listener);
    settings.update('editor.tabSize', 2); settings.update('editor.tabSize', 2);
    expect(listener).toHaveBeenCalledTimes(1);
    settings.reset(); expect(settings.snapshot).toEqual(DEFAULT_SETTINGS);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe(); settings.update('editor.tabSize', 8);
    expect(listener).toHaveBeenCalledTimes(2);
  });
  it('retains live preferences when browser storage is inaccessible', () => {
    const backend = { getItem: () => {
      throw new Error('denied');
    }, setItem: () => {
      throw new Error('quota');
    } };
    const settings = new StandaloneSettings(backend);
    expect(settings.update('editor.minimap.enabled', true)).toBe(true);
    expect(settings.snapshot['editor.minimap.enabled']).toBe(true);
  });
});

it('reloads external preferences without writing them back to storage', () => {
  const backend = storage();
  const settings = new StandaloneSettings(backend);
  const listener = vi.fn(); settings.subscribe(listener);
  backend.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, values: { 'editor.fontSize': 28 } }));
  const write = vi.spyOn(backend, 'setItem');
  settings.reloadFromStorage();
  expect(settings.snapshot['editor.fontSize']).toBe(28);
  expect(listener).toHaveBeenCalledOnce();
  expect(write).not.toHaveBeenCalled();
});
