import type { VirtualWorkspaceFile } from './VirtualWorkspace';

/** A portable, intentionally small workspace archive. Keep this independent of
 * IndexedDB so users can keep their own copy even when browser storage fails. */
export const WORKSPACE_BACKUP_FORMAT = 'shader-studio-workspace';
export const WORKSPACE_BACKUP_VERSION = 1;

export interface WorkspaceBackup {
  format: typeof WORKSPACE_BACKUP_FORMAT;
  version: typeof WORKSPACE_BACKUP_VERSION;
  files: VirtualWorkspaceFile[];
}

function cloneFiles(files: readonly VirtualWorkspaceFile[]): VirtualWorkspaceFile[] {
  return files.map(file => ({ ...file }));
}

/** Backups must use canonical workspace paths. This prevents an imported
 * archive from smuggling a traversal path through a future importer. */
function isCanonicalPath(path: string): boolean {
  return path.startsWith('/') && path !== '/'
    && !path.includes('\\') && !path.split('/').some(part => part === '.' || part === '..');
}

function isBackupFile(value: unknown): value is VirtualWorkspaceFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const file = value as Partial<VirtualWorkspaceFile>;
  return typeof file.path === 'string' && isCanonicalPath(file.path)
    && typeof file.contents === 'string'
    && typeof file.createdAt === 'number' && Number.isFinite(file.createdAt)
    && typeof file.modifiedAt === 'number' && Number.isFinite(file.modifiedAt);
}

/** Validate untrusted backup data before it gets near the workspace store. */
export function parseWorkspaceBackup(value: unknown): WorkspaceBackup {
  let raw: unknown = value;
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value);
    } catch {
      throw new Error('Backup is not valid JSON.');
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Backup must be an object.');
  }
  const backup = raw as Partial<WorkspaceBackup>;
  if (backup.format !== WORKSPACE_BACKUP_FORMAT || backup.version !== WORKSPACE_BACKUP_VERSION) {
    throw new Error('Backup format or version is not supported.');
  }
  if (!Array.isArray(backup.files) || !backup.files.every(isBackupFile)) {
    throw new Error('Backup contains an invalid workspace file.');
  }
  const paths = new Set<string>();
  for (const file of backup.files) {
    if (paths.has(file.path)) {
      throw new Error(`Backup contains duplicate path: ${file.path}`);
    }
    paths.add(file.path);
  }
  return { format: WORKSPACE_BACKUP_FORMAT, version: WORKSPACE_BACKUP_VERSION, files: cloneFiles(backup.files) };
}

export function createWorkspaceBackup(files: readonly VirtualWorkspaceFile[]): WorkspaceBackup {
  // Route generated archives through the same validator so this contract never
  // drifts from the import boundary.
  return parseWorkspaceBackup({
    format: WORKSPACE_BACKUP_FORMAT,
    version: WORKSPACE_BACKUP_VERSION,
    files: cloneFiles(files),
  });
}

export function serializeWorkspaceBackup(files: readonly VirtualWorkspaceFile[]): string {
  return `${JSON.stringify(createWorkspaceBackup(files), null, 2)}\n`;
}
