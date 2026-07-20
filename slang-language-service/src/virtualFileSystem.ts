import { normalizeInternalPath } from "./canonicalPaths";
import type { SlangWorkspaceSnapshot } from "./types";

export interface SlangFileSystem {
  mkdirTree(path: string): void;
  writeFile(path: string, source: string): void;
  unlink(path: string): void;
  analyzePath(path: string): { exists: boolean };
}

const activeOwners = new WeakMap<SlangFileSystem, Set<string>>();

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
  const activeOwner = activeOwners.get(fs);
  const previousOwners = activeOwner && activeOwner !== ownedPaths
    ? [activeOwner, ownedPaths]
    : [ownedPaths];
  const previousPaths = [...new Set(previousOwners.flatMap((owner) => [...owner]))]
    .map(normalizeInternalPath);
  const nextPaths = new Set(files.map((file) => file.path));

  try {
    for (const file of files) {
      fs.mkdirTree(parentPath(file.path));
      fs.writeFile(file.path, openDocuments.get(file.uri)?.source ?? file.source);
    }

    for (const path of previousPaths) {
      if (!nextPaths.has(path) && fs.analyzePath(path).exists) {
        fs.unlink(path);
      }
    }
  } catch (error) {
    // A failed operation may still have created or written a path. Retaining
    // both ownership generations lets a later sync safely clean either one.
    for (const owner of previousOwners) {
      for (const path of owner) {
        ownedPaths.add(path);
      }
    }
    for (const path of nextPaths) {
      ownedPaths.add(path);
    }
    if (activeOwner && activeOwner !== ownedPaths) {
      activeOwner.clear();
    }
    activeOwners.set(fs, ownedPaths);
    throw error;
  }

  if (activeOwner && activeOwner !== ownedPaths) {
    activeOwner.clear();
  }
  ownedPaths.clear();
  for (const path of nextPaths) {
    ownedPaths.add(path);
  }
  activeOwners.set(fs, ownedPaths);

  return ownedPaths;
}

export function releaseWorkspaceFileSystem(
  fs: SlangFileSystem,
  ownedPaths: Set<string>,
): void {
  if (activeOwners.get(fs) !== ownedPaths) {
    ownedPaths.clear();
    return;
  }

  const paths = [...ownedPaths].map(normalizeInternalPath);
  for (const path of paths) {
    if (fs.analyzePath(path).exists) {
      fs.unlink(path);
    }
  }
  ownedPaths.clear();
  activeOwners.delete(fs);
}
