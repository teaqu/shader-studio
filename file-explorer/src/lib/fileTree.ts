import type { WorkspaceFileEntry, WorkspaceTreeEntry } from './FileExplorerHost';

export function normalizeFilePath(path: string): string {
  const parts = path.replace(/\\/g, '/').replace(/^\//, '').split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[\x00-\x1f]/.test(part))) {
    throw new Error('Enter a file or folder path inside the workspace.');
  }
  return `/${parts.join('/')}`;
}

/** Flat, depth-first rows retain folder semantics without recursive components. */
export function workspaceTree(files: readonly WorkspaceFileEntry[], collapsed: ReadonlySet<string>, filter = ''): WorkspaceTreeEntry[] {
  const entries = new Map<string, WorkspaceTreeEntry>();
  const query = filter.toLowerCase();
  for (const file of files.filter(file => file.path.toLowerCase().includes(query))) {
    const parts = file.path.slice(1).split('/');
    parts.forEach((name, index) => {
      const path = `/${parts.slice(0, index + 1).join('/')}`;
      entries.set(path, { path, name, directory: index < parts.length - 1 || file.directory === true, depth: index });
    });
  }
  const children = (parent: string): WorkspaceTreeEntry[] => [...entries.values()]
    .filter(entry => entry.path.slice(0, entry.path.lastIndexOf('/')) === parent)
    .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const visit = (parent: string): WorkspaceTreeEntry[] => children(parent).flatMap(entry =>
    [entry, ...entry.directory && (query || !collapsed.has(entry.path)) ? visit(entry.path) : []]);
  return visit('');
}
