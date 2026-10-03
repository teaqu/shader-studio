import { afterEach, expect, it, vi } from 'vitest';
import { SETTINGS_STORAGE_KEY, StandaloneSettings } from '../settings/StandaloneSettings';
import { syncSettingsAcrossTabs } from '../settings/syncSettingsAcrossTabs';

afterEach(() => vi.restoreAllMocks());
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
