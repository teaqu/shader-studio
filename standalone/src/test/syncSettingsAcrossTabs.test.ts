import { afterEach, expect, it, vi } from 'vitest';
import { CAMERA_STORAGE_KEY, SETTINGS_STORAGE_KEY, StandaloneSettings } from '../settings/StandaloneSettings';
import { syncSettingsAcrossTabs } from '../settings/syncSettingsAcrossTabs';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('reloads global storage changes and removes the listener on disposal', () => {
  const settings = new StandaloneSettings({ getItem: () => null, setItem: vi.fn() });
  const reload = vi.spyOn(settings, 'reloadFromStorage');
  const stop = syncSettingsAcrossTabs(settings);
  window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }));
  expect(reload).not.toHaveBeenCalled();
  window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_STORAGE_KEY }));
  expect(reload).toHaveBeenCalledOnce();
  const sessionChange = new StorageEvent('storage', { key: SETTINGS_STORAGE_KEY });
  Object.defineProperty(sessionChange, 'storageArea', { value: sessionStorage });
  window.dispatchEvent(sessionChange);
  expect(reload).toHaveBeenCalledOnce();
  stop(); window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_STORAGE_KEY }));
  expect(reload).toHaveBeenCalledOnce();
});

it('reloads camera preferences and complete storage clears from local storage', () => {
  const settings = new StandaloneSettings({ getItem: () => null, setItem: vi.fn() });
  const reload = vi.spyOn(settings, 'reloadFromStorage');
  const stop = syncSettingsAcrossTabs(settings);
  const cameraChange = new StorageEvent('storage', { key: CAMERA_STORAGE_KEY });
  Object.defineProperty(cameraChange, 'storageArea', { value: window.localStorage });
  window.dispatchEvent(cameraChange);
  window.dispatchEvent(new StorageEvent('storage', { key: null }));
  expect(reload).toHaveBeenCalledTimes(2);
  stop();
});

it('ignores storage events when the browser denies access to local storage', () => {
  const settings = new StandaloneSettings({ getItem: () => null, setItem: vi.fn() });
  const reload = vi.spyOn(settings, 'reloadFromStorage');
  const event = new StorageEvent('storage', { key: SETTINGS_STORAGE_KEY });
  Object.defineProperty(event, 'storageArea', { value: window.localStorage });
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new Error('Storage access denied');
  });
  const stop = syncSettingsAcrossTabs(settings);
  window.dispatchEvent(event);
  expect(reload).not.toHaveBeenCalled();
  stop();
});

it('returns an inert disposal function outside a browser', () => {
  const settings = new StandaloneSettings({ getItem: () => null, setItem: vi.fn() });
  const reload = vi.spyOn(settings, 'reloadFromStorage');
  vi.stubGlobal('window', undefined);
  const stop = syncSettingsAcrossTabs(settings);
  expect(() => stop()).not.toThrow();
  expect(reload).not.toHaveBeenCalled();
});
