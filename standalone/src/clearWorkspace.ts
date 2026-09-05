/** Clear this application's data without removing unrelated data on the same origin. */
export async function clearStandaloneWorkspace(
  workspace: { clearWorkspace(): Promise<void> },
  confirm: (message: string) => boolean = window.confirm.bind(window),
  reload: () => void = () => window.location.reload(),
): Promise<void> {
  if (!confirm('Clear the entire standalone workspace and its saved settings? This cannot be undone.')) {
    return;
  }
  await workspace.clearWorkspace();
  for (const storage of [localStorage, sessionStorage]) {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    for (const key of keys) {
      if (key?.startsWith('shader-studio')) {
        storage.removeItem(key);
      }
    }
  }
  reload();
}
