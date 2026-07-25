import type { SlangWorkspaceSnapshot } from "@shader-studio/types";

export interface SlangFileSystem {
  mkdirTree(path: string): void;
  writeFile(path: string, source: string): void;
  unlink(path: string): void;
  analyzePath(path: string): { exists: boolean };
}

const activeOwners = new WeakMap<SlangFileSystem, Set<string>>();

export function normalizeInternalPath(path: string): string {
  const slashPath = path.replace(/\\/g, "/");
  if (!slashPath.startsWith("/")) {
    throw new Error(`Path must be absolute within /workspace: ${path}`);
  }
  const parts: string[] = [];
  for (const part of slashPath.split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      if (parts.length) {
        parts.pop();
      } else {
        throw new Error(`Path escapes /workspace: ${path}`);
      }
    } else {
      parts.push(part);
    }
  }
  const normalized = `/${parts.join("/")}`;
  if (normalized !== "/workspace" && !normalized.startsWith("/workspace/")) {
    throw new Error(`Path must be within /workspace: ${path}`);
  }
  return normalized;
}

function parent(path: string): string {
  return path.slice(0, path.lastIndexOf("/")) || "/";
}
function removeIfPresent(fs: SlangFileSystem, path: string): void {
  if (fs.analyzePath(path).exists) {
    fs.unlink(path);
  }
}

export function syncWorkspaceToFileSystem(fs: SlangFileSystem, snapshot: SlangWorkspaceSnapshot, ownedPaths: Set<string>): void {
  const desired = new Map<string, string>();
  for (const file of snapshot.files) {
    const path = normalizeInternalPath(file.path);
    const existing = desired.get(path);
    if (existing !== undefined && existing !== file.source) {
      throw new Error(`Conflicting duplicate workspace path: ${path}`);
    }
    desired.set(path, file.source);
  }
  const previous = activeOwners.get(fs);
  for (const path of [...ownedPaths, ...(previous ?? [])]) {
    if (normalizeInternalPath(path) !== path) {
      throw new Error(`Owned path must be normalized: ${path}`);
    }
  }
  const stale = new Set<string>([...ownedPaths, ...(previous ?? [])]);
  for (const path of desired.keys()) {
    stale.delete(path);
  }
  try {
    for (const [path, source] of desired) {
      ownedPaths.add(path);
      fs.mkdirTree(parent(path));
      fs.writeFile(path, source);
    }
    for (const path of stale) {
      removeIfPresent(fs, path);
    }
  } catch (error) {
    for (const path of stale) {
      ownedPaths.add(path);
    }
    throw error;
  }
  if (previous && previous !== ownedPaths) {
    previous.clear();
  }
  ownedPaths.clear();
  for (const path of desired.keys()) {
    ownedPaths.add(path);
  }
  activeOwners.set(fs, ownedPaths);
}

export function releaseWorkspaceFileSystem(fs: SlangFileSystem, ownedPaths: Set<string>): void {
  if (activeOwners.get(fs) !== ownedPaths) {
    return;
  }
  for (const path of ownedPaths) {
    removeIfPresent(fs, path);
  }
  ownedPaths.clear();
  activeOwners.delete(fs);
}
