import { normalizeFilePath, type WorkspaceFileEntry } from '@shader-studio/file-explorer';
export { workspaceTree } from '@shader-studio/file-explorer';
export type { WorkspaceFileEntry } from '@shader-studio/file-explorer';
import { configPathForShader, shaderLanguageForPath } from '@shader-studio/types';
import type { VirtualWorkspace } from './VirtualWorkspace';

export interface WorkspaceFileMove { from: string; to: string }
const FOLDER_RECORDS = '/.shader-studio/folders/';

function folderRecordPath(path: string): string {
  return `${FOLDER_RECORDS}${encodeURIComponent(path)}`;
}

function folderRecords(workspace: VirtualWorkspace): { record: string; path: string }[] {
  return workspace.list(FOLDER_RECORDS).flatMap(file => {
    try {
      return [{ record: file.path, path: workspaceUserPath(file.contents) }];
    } catch {
      return [];
    }
  });
}

export function userWorkspaceFiles(workspace: VirtualWorkspace): WorkspaceFileEntry[] {
  return [
    ...workspace.list().filter(file => !file.path.startsWith('/.shader-studio/'))
      .map(file => ({ path: file.path, asset: file.contents.startsWith('data:') })),
    ...folderRecords(workspace).map(folder => ({ path: folder.path, asset: false, directory: true })),
  ];
}

export function workspaceFolderExists(workspace: VirtualWorkspace, path: string): boolean {
  return workspace.list(path).length > 0 || folderRecords(workspace).some(folder => folder.path === path || folder.path.startsWith(`${path}/`));
}

export function workspaceUserPath(path: string): string {
  const normalized = normalizeFilePath(path);
  if (normalized === '/.shader-studio' || normalized.startsWith('/.shader-studio/')) {
    throw new Error('Enter a file or folder path inside the workspace.');
  }
  return normalized;
}

export function assertWorkspaceFolder(workspace: VirtualWorkspace, path: string): void {
  if (!path) {
    return;
  }
  const parts = path.slice(1).split('/');
  for (let index = 1; index <= parts.length; index++) {
    if (workspace.exists(`/${parts.slice(0, index).join('/')}`)) {
      throw new Error('A file already occupies a parent folder path.');
    }
  }
}

function assertDestination(workspace: VirtualWorkspace, path: string): void {
  assertWorkspaceFolder(workspace, path.slice(0, path.lastIndexOf('/')));
  if (workspace.exists(path) || workspaceFolderExists(workspace, path)) {
    throw new Error(`File or folder already exists: ${path}`);
  }
}

function workspaceEntryFiles(workspace: VirtualWorkspace, requested: string): string[] {
  const path = workspaceUserPath(requested);
  const files = workspace.exists(path) ? [path] : workspace.list(path).map(file => file.path);
  if (!files.length && !workspaceFolderExists(workspace, path)) {
    throw new Error('This file or folder no longer exists.');
  }
  return files;
}
export function createWorkspaceFile(workspace: VirtualWorkspace, requested: string): string {
  const path = workspaceUserPath(requested);
  assertDestination(workspace, path);
  workspace.writeText(path, '');
  return path;
}

export function createWorkspaceFolder(workspace: VirtualWorkspace, requested: string): string {
  const path = workspaceUserPath(requested);
  assertDestination(workspace, path);
  workspace.writeText(folderRecordPath(path), path);
  return path;
}

function planRename(workspace: VirtualWorkspace, requested: string, destination: string) {
  const source = workspaceUserPath(requested);
  const target = workspaceUserPath(destination);
  const files = workspaceEntryFiles(workspace, source);
  if (source === target) {
    return { source, target, moves: [], folders: [] };
  }
  if (target.startsWith(`${source}/`)) {
    throw new Error('A folder cannot be moved inside itself.');
  }
  const moves = files.map(from => ({ from, to: target + from.slice(source.length) }));
  const folders = folderRecords(workspace).filter(folder => folder.path === source || folder.path.startsWith(`${source}/`));
  if (workspace.exists(source) && shaderLanguageForPath(source)) {
    if (!shaderLanguageForPath(target)) {
      throw new Error('Keep a shader file extension when renaming a shader.');
    }
    const config = configPathForShader(source);
    if (workspace.exists(config)) {
      moves.push({ from: config, to: configPathForShader(target) });
    }
  }
  assertDestination(workspace, target);
  for (const move of moves) {
    assertDestination(workspace, move.to);
  }
  return { source, target, moves, folders };
}

function applyRename(workspace: VirtualWorkspace, { source, target, moves, folders }: ReturnType<typeof planRename>) {
  for (const move of moves) {
    workspace.rename(move.from, move.to);
  }
  for (const folder of folders) {
    const path = target + folder.path.slice(source.length);
    workspace.delete(folder.record);
    workspace.writeText(folderRecordPath(path), path);
  }
  return moves;
}

export function renameWorkspacePath(workspace: VirtualWorkspace, requested: string, destination: string): WorkspaceFileMove[] {
  return applyRename(workspace, planRename(workspace, requested, destination));
}

function operationRoots(requested: readonly string[]): string[] {
  const paths = [...new Set(requested.map(workspaceUserPath))];
  return paths.filter(path => !paths.some(other => other !== path && (path.startsWith(`${other}/`)
    || (shaderLanguageForPath(other) && configPathForShader(other) === path))));
}

/** Validate every destination before moving any selected file or folder. */
export function moveWorkspacePaths(workspace: VirtualWorkspace, requested: readonly string[], directory: string): WorkspaceFileMove[] {
  const base = directory === '/' ? '' : workspaceUserPath(directory);
  const plans = operationRoots(requested).map(path => planRename(workspace, path, `${base}/${path.split('/').pop()}`));
  const destinations = new Set<string>();
  for (const plan of plans) {
    for (const path of [plan.target, ...plan.moves.map(move => move.to)].filter((path, index, paths) => paths.indexOf(path) === index)) {
      if (destinations.has(path)) {
        throw new Error(`Selected items have the same destination: ${path}`);
      }
      destinations.add(path);
    }
  }
  return plans.flatMap(plan => applyRename(workspace, plan));
}

/** Preflight every selection before deleting, including implied shader configs. */
export function deleteWorkspacePaths(workspace: VirtualWorkspace, requested: readonly string[]): string[] {
  const roots = operationRoots(requested);
  roots.forEach(path => workspaceEntryFiles(workspace, path));
  return roots.flatMap(path => deleteWorkspacePath(workspace, path));
}

export function deleteWorkspacePath(workspace: VirtualWorkspace, requested: string): string[] {
  const path = workspaceUserPath(requested);
  const files = workspaceEntryFiles(workspace, path);
  files.push(...folderRecords(workspace).filter(folder => folder.path === path || folder.path.startsWith(`${path}/`)).map(folder => folder.record));
  if (workspace.exists(path) && shaderLanguageForPath(path)) {
    const config = configPathForShader(path);
    if (workspace.exists(config)) {
      files.push(config);
    }
  }
  for (const file of files) {
    workspace.delete(file);
  }
  return files;
}
