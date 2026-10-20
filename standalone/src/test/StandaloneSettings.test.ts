import { describe, expect, it, vi } from 'vitest';
import { CAMERA_STORAGE_KEY, DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, StandaloneSettings } from '../settings/StandaloneSettings';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => {
    values.set(key, value);
  } };
}

describe('standalone global settings', () => {
  it('defaults descriptions off on mobile and saves independent desktop and mobile choices', () => {
    const backend = storage();
    const settings = new StandaloneSettings(backend);
    expect(settings.snapshot['editor.mobileDescriptions']).toBe(false);
    expect(settings.snapshot['editor.desktopDescriptions']).toBe(true);
    expect(settings.update('editor.mobileDescriptions', 'true')).toBe(false);
    settings.update('editor.mobileDescriptions', true);
    settings.update('editor.desktopDescriptions', false);
    const reloaded = new StandaloneSettings(backend);
    expect(reloaded.snapshot['editor.mobileDescriptions']).toBe(true);
    expect(reloaded.snapshot['editor.desktopDescriptions']).toBe(false);
    expect(reloaded.snapshot['editor.autoSuggestions']).toBe(true);
    reloaded.reset();
    expect(reloaded.snapshot['editor.mobileDescriptions']).toBe(false);
    expect(reloaded.snapshot['editor.desktopDescriptions']).toBe(true);
  });
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
    expect(settings.update('editor.desktop', 'invalid')).toBe(false);
    expect(settings.update('editor.mobile', 'Monaco')).toBe(false);
    expect(settings.update('webgpu.defaultRenderAuthoring', 'invalid')).toBe(false);
    expect(settings.update('editor.insertSpaces', 'false')).toBe(false);
    expect(settings.update('editor.autoSuggestions', 'false')).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    expect(settings.snapshot).toEqual(DEFAULT_SETTINGS);
  });
  it('persists automatic suggestions independently of language services and restores the default on reset', () => {
    const backend = storage();
    const settings = new StandaloneSettings(backend);
    expect(settings.snapshot['editor.autoSuggestions']).toBe(true);
    settings.update('editor.autoSuggestions', false);
    expect(new StandaloneSettings(backend).snapshot['editor.autoSuggestions']).toBe(false);
    expect(settings.snapshot['languageServers.glsl.enabled']).toBe(true);
    settings.reset();
    expect(settings.snapshot['editor.autoSuggestions']).toBe(true);
  });
  it('remembers hidden mobile navigation and restores its enabled default on reset', () => {
    const backend = storage();
    const settings = new StandaloneSettings(backend);
    expect(settings.snapshot['editor.mobileNavigation']).toBe(true);
    expect(settings.update('editor.mobileNavigation', 'false')).toBe(false);
    settings.update('editor.mobileNavigation', false);
    const reloaded = new StandaloneSettings(backend);
    expect(reloaded.snapshot['editor.mobileNavigation']).toBe(false);
    reloaded.reset();
    expect(reloaded.snapshot['editor.mobileNavigation']).toBe(true);
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

it('defaults editor selection to Monaco on desktop and CodeMirror on mobile, persists valid choices, and resets them', () => {
  const backend = storage();
  const settings = new StandaloneSettings(backend);
  expect(settings.snapshot['editor.desktop']).toBe('monaco');
  expect(settings.snapshot['editor.mobile']).toBe('codemirror');
  expect(settings.update('editor.desktop', 'codemirror')).toBe(true);
  expect(settings.update('editor.mobile', 'monaco')).toBe(true);
  expect(new StandaloneSettings(backend).snapshot).toMatchObject({ 'editor.desktop': 'codemirror', 'editor.mobile': 'monaco' });
  settings.reset();
  expect(settings.snapshot).toMatchObject({ 'editor.desktop': 'monaco', 'editor.mobile': 'codemirror' });
});

it('ignores malformed persisted editor choices while retaining valid choices independently', () => {
  const backend = storage();
  backend.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, values: { 'editor.desktop': 'invalid', 'editor.mobile': 'monaco' } }));
  expect(new StandaloneSettings(backend).snapshot).toMatchObject({ 'editor.desktop': 'monaco', 'editor.mobile': 'monaco' });
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

it('persists the global canvas menu preference and broadcasts changes', async () => {
  const { HostSettingsController } = await import('../settings/HostSettingsController');
  const backend = storage(); const settings = new StandaloneSettings(backend); const emit = vi.fn(); const controller = new HostSettingsController(settings, emit);
  expect(settings.snapshot['preview.preventMouseDefaults']).toBe(true);
  expect(controller.handleMessage('requestCanvasInputSettings', {})).toBe(true);
  expect(emit).toHaveBeenLastCalledWith({ type: 'canvasInputSettings', payload: { preventMouseDefaults: true } });
  expect(settings.update('preview.preventMouseDefaults', 'false')).toBe(false);
  settings.update('preview.preventMouseDefaults', false);
  expect(emit).toHaveBeenLastCalledWith({ type: 'canvasInputSettings', payload: { preventMouseDefaults: false } });
  expect(new StandaloneSettings(backend).snapshot['preview.preventMouseDefaults']).toBe(false); controller.dispose();
});

it('persists the global mobile-mode override and resets it to automatic mobile layout', () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
  const settings = new StandaloneSettings(storage);
  expect(settings.snapshot['layout.mobileMode']).toBe(true);
  settings.update('layout.mobileMode', false);
  expect(new StandaloneSettings(storage).snapshot['layout.mobileMode']).toBe(false);
  settings.reset();
  expect(new StandaloneSettings(storage).snapshot['layout.mobileMode']).toBe(true);
});

it('persists Pixel style, rejects invalid styles and resets to Classic', () => {
  const backend = storage();
  const settings = new StandaloneSettings(backend);
  expect(settings.snapshot['theme.style']).toBe('classic');
  expect(settings.update('theme.style', 'pixel')).toBe(true);
  expect(new StandaloneSettings(backend).snapshot['theme.style']).toBe('pixel');
  for (const value of ['dark', '', null, true]) {
    expect(settings.update('theme.style', value)).toBe(false);
  }
  expect(settings.snapshot['theme.style']).toBe('pixel');
  settings.reset();
  expect(new StandaloneSettings(backend).snapshot['theme.style']).toBe('classic');
});
