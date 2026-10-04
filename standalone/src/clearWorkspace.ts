import { CAMERA_STORAGE_KEY, SETTINGS_STORAGE_KEY } from './settings/StandaloneSettings';

/** Clear this application's data without removing unrelated data on the same origin. */
export async function clearStandaloneWorkspace(
  workspace: { clearWorkspace(): Promise<void> },
  confirm: (message: string) => boolean = window.confirm.bind(window),
  reload: () => void = () => window.location.reload(),
): Promise<void> {
  if (!confirm('Clear the entire standalone workspace and its saved layout? Global preferences will be kept. This cannot be undone.')) {
    return;
  }
  await workspace.clearWorkspace();
  try {
    for (const storage of [localStorage, sessionStorage]) {
      try {
        const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
        for (const key of keys) {
          if (key?.startsWith('shader-studio') && key !== SETTINGS_STORAGE_KEY && key !== CAMERA_STORAGE_KEY) {
            storage.removeItem(key);
          }
        }
      } catch {
        // Storage can be unavailable even after workspace persistence succeeds.
      }
    }
  } catch {
    // Reading a browser storage global can itself be denied.
  }
  reload();
}
