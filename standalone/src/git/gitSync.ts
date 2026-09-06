/** Pure workspace-vs-remote diff helpers for standalone git sync. */

export const GIT_INTERNAL_PREFIX = '/.shader-studio/';
export const GIT_MAX_FILE_BYTES = 950_000;

export interface WorkspaceSnapshotFile {
  path: string;
  contents: string;
}

export function normalizeRepoPath(path: string): string {
  const normalized = `/${path.replace(/\\/g, '/').replace(/^\/+/, '')}`;
  if (normalized === '/' || normalized.startsWith(GIT_INTERNAL_PREFIX)) {
    throw new Error(`Path is reserved for standalone state: ${path}`);
  }
  return normalized;
}

/** Internal standalone state (active shader, thumbnails) never syncs to git. */
export function isTrackedPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith(GIT_INTERNAL_PREFIX);
}

/** Display paths inside the repo without the workspace leading slash. */
export function toRepoPath(path: string): string {
  return path.replace(/^\//, '');
}

export function snapshotTrackedFiles(files: WorkspaceSnapshotFile[]): Map<string, string> {
  const snapshot = new Map<string, string>();
  for (const file of files) {
    if (isTrackedPath(file.path)) {
      snapshot.set(file.path, file.contents);
    }
  }
  return snapshot;
}

export interface WorkspaceDiff {
  added: string[];
  modified: string[];
  deleted: string[];
  clean: boolean;
}

function sorted(paths: Iterable<string>): string[] {
  return [...paths].sort((a, b) => a.localeCompare(b));
}

export function diffSnapshots(base: Map<string, string>, current: Map<string, string>): WorkspaceDiff {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  for (const [path, contents] of current) {
    if (!base.has(path)) {
      added.push(path);
    } else if (base.get(path) !== contents) {
      modified.push(path);
    }
  }
  for (const path of base.keys()) {
    if (!current.has(path)) {
      deleted.push(path);
    }
  }
  added.sort((a, b) => a.localeCompare(b));
  modified.sort((a, b) => a.localeCompare(b));
  deleted.sort((a, b) => a.localeCompare(b));
  return { added, modified, deleted, clean: added.length + modified.length + deleted.length === 0 };
}

export interface SyncPlan {
  /** Workspace paths to write with remote contents. */
  write: WorkspaceSnapshotFile[];
  /** Tracked workspace paths absent from the remote (removed on sync). */
  remove: string[];
  /** Remote entries skipped (binary / too large) with reasons. */
  skipped: { path: string; reason: 'binary' | 'too-large' }[];
}

export function describeRemoteEntry(
  repoPath: string,
  fetched: { text: string | null; skipped: 'binary' | 'too-large' | null },
): SyncPlan {
  if (fetched.text !== null) {
    return { write: [{ path: `/${repoPath}`, contents: fetched.text }], remove: [], skipped: [] };
  }
  return {
    write: [],
    remove: [],
    skipped: fetched.skipped ? [{ path: `/${repoPath}`, reason: fetched.skipped }] : [],
  };
}

export { sorted };
