/** File selection belongs to the standalone shell, outside the embedded viewer. */
let pending = $state<{ paths: string[]; resolve: (path: string | null) => void } | null>(null);
export function getFileSelection() {
  return pending;
}
export function finishFileSelection(path: string | null): void {
  const request = pending; pending = null; request?.resolve(path);
}
export function requestFileSelection(paths: string[]): Promise<string | null> {
  finishFileSelection(null);
  return new Promise(resolve => {
    pending = { paths, resolve };
  });
}
