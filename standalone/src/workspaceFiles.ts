import { configPathForShader, shaderLanguageForPath } from '@shader-studio/types';
import type { VirtualWorkspace } from './VirtualWorkspace';

export interface WorkspaceFileEntry { path: string; asset: boolean }
export interface WorkspaceTreeEntry { path: string; name: string; directory: boolean; depth: number }
export interface WorkspaceFileMove { from: string; to: string }

export function userWorkspaceFiles(workspace: VirtualWorkspace): WorkspaceFileEntry[] {
  return workspace.list().filter(file => !file.path.startsWith('/.shader-studio/'))
    .map(file => ({ path: file.path, asset: file.contents.startsWith('data:') }));
}

export function workspaceUserPath(path: string): string {
  const parts = path.replace(/\\/g, '/').replace(/^\//, '').split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[\x00-\x1f]/.test(part)) || parts[0] === '.shader-studio') {
    throw new Error('Enter a file or folder path inside the workspace.');
  }
  return `/${parts.join('/')}`;
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
  if (workspace.exists(path) || workspace.list(path).length) {
    throw new Error(`File or folder already exists: ${path}`);
  }
}

export function workspaceEntryFiles(workspace: VirtualWorkspace, requested: string): string[] {
  const path = workspaceUserPath(requested);
  const files = workspace.exists(path) ? [path] : workspace.list(path).map(file => file.path);
  if (!files.length) {
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

export function renameWorkspacePath(workspace: VirtualWorkspace, requested: string, destination: string): WorkspaceFileMove[] {
  const source = workspaceUserPath(requested);
  const target = workspaceUserPath(destination);
  const files = workspaceEntryFiles(workspace, source);
  if (source === target) {
    return [];
  }
  if (target.startsWith(`${source}/`)) {
    throw new Error('A folder cannot be moved inside itself.');
  }
  const moves = files.map(from => ({ from, to: target + from.slice(source.length) }));
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
  for (const move of moves) {
    workspace.rename(move.from, move.to);
  }
  return moves;
}

export function deleteWorkspacePath(workspace: VirtualWorkspace, requested: string): string[] {
  const path = workspaceUserPath(requested);
  const files = workspaceEntryFiles(workspace, path);
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

/** Flat, depth-first rows retain folder semantics without recursive components. */
export function workspaceTree(files: readonly WorkspaceFileEntry[], collapsed: ReadonlySet<string>, filter = ''): WorkspaceTreeEntry[] {
  const entries = new Map<string, WorkspaceTreeEntry>();
  const query = filter.toLowerCase();
  for (const file of files.filter(file => file.path.toLowerCase().includes(query))) {
    const parts = file.path.slice(1).split('/');
    parts.forEach((name, index) => {
      const path = `/${parts.slice(0, index + 1).join('/')}`;
      entries.set(path, { path, name, directory: index < parts.length - 1, depth: index });
    });
  }
  const children = (parent: string): WorkspaceTreeEntry[] => [...entries.values()]
    .filter(entry => entry.path.slice(0, entry.path.lastIndexOf('/')) === parent)
    .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const visit = (parent: string): WorkspaceTreeEntry[] => children(parent).flatMap(entry =>
    [entry, ...entry.directory && (query || !collapsed.has(entry.path)) ? visit(entry.path) : []]);
  return visit('');
}
