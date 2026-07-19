import { normalizeInternalPath } from "./canonicalPaths";
import type { SlangWorkspaceSnapshot } from "./types";

export interface SlangFileSystem {
  mkdirTree(path: string): void;
  writeFile(path: string, source: string): void;
  unlink(path: string): void;
  analyzePath(path: string): { exists: boolean };
}

function parentPath(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator <= 0 ? "/" : path.slice(0, separator);
}

export function syncWorkspaceToFileSystem(
  fs: SlangFileSystem,
  snapshot: SlangWorkspaceSnapshot,
  openDocuments: ReadonlyMap<string, { source: string; version: number }> = new Map(),
  ownedPaths: Set<string> = new Set(),
): Set<string> {
  const files = snapshot.files.map((file) => ({
    ...file,
    path: normalizeInternalPath(file.path),
  }));
  const previousPaths = [...ownedPaths].map(normalizeInternalPath);
  const nextPaths = new Set(files.map((file) => file.path));

  for (const path of previousPaths) {
    if (!nextPaths.has(path) && fs.analyzePath(path).exists) {
      fs.unlink(path);
    }
  }

  ownedPaths.clear();
  for (const file of files) {
    fs.mkdirTree(parentPath(file.path));
    fs.writeFile(file.path, openDocuments.get(file.uri)?.source ?? file.source);
    ownedPaths.add(file.path);
  }

  return ownedPaths;
}
