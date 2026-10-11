import { realpathSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

export function textRevision(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Resolve existing regular files under canonical workspace roots only. */
export function resolveWorkspaceFile(filePath: string, roots: readonly string[], openFiles: readonly string[] = []): string {
  if (!path.isAbsolute(filePath)) {
    if (roots.length !== 1) {
      throw new Error('Use an absolute file path when there is not exactly one workspace folder.');
    }
    filePath = path.resolve(roots[0], filePath);
  }
  const canonical = realpathSync(filePath);
  const withinRoot = roots.some(root => {
    const relative = path.relative(realpathSync(root), canonical);
    return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
  });
  const isOpen = openFiles.some(file => path.relative(realpathSync(file), canonical) === '');
  if (!withinRoot && !isOpen) {
    throw new Error('File must belong to the open workspace or be an already-open document.');
  }
  const relativeParts = path.relative(path.parse(canonical).root, canonical).split(path.sep);
  if (relativeParts.includes('.git')) {
    throw new Error('Git internal files are not editable through MCP.');
  }
  const stat = statSync(canonical);
  if (!stat.isFile() || stat.size > 1_000_000) {
    throw new Error('Use an existing text file no larger than 1 MB.');
  }
  return filePath;
}
