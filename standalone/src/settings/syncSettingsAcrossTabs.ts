import { CAMERA_STORAGE_KEY, SETTINGS_STORAGE_KEY, type StandaloneSettings } from './StandaloneSettings';

/** Storage events only fire in other tabs; reload without writing avoids an echo loop. */
export function syncSettingsAcrossTabs(settings: StandaloneSettings): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  const changed = (event: StorageEvent) => {
    if (event.key === SETTINGS_STORAGE_KEY || event.key === CAMERA_STORAGE_KEY || event.key === null) {
      try {
        if (event.storageArea && event.storageArea !== window.localStorage) {
          return;
        }
      } catch {
        return;
      }
      settings.reloadFromStorage();
    }
  };
  window.addEventListener('storage', changed);
  return () => window.removeEventListener('storage', changed);
}
