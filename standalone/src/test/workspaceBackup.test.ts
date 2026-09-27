import { describe, expect, it } from 'vitest';
import {
  createWorkspaceBackup,
  parseWorkspaceBackup,
  serializeWorkspaceBackup,
  WORKSPACE_BACKUP_FORMAT,
  WORKSPACE_BACKUP_VERSION,
} from '../workspaceBackup';

const files = [{ path: '/shaders/main.glsl', contents: 'void main() {}', createdAt: 1, modifiedAt: 2 }];

describe('workspace backups', () => {
  it('serializes a versioned portable archive without sharing file objects', () => {
    const backup = createWorkspaceBackup(files);
    files[0].contents = 'changed';
    expect(backup).toEqual({ format: WORKSPACE_BACKUP_FORMAT, version: WORKSPACE_BACKUP_VERSION, files: [{ path: '/shaders/main.glsl', contents: 'void main() {}', createdAt: 1, modifiedAt: 2 }] });
    expect(parseWorkspaceBackup(serializeWorkspaceBackup(backup.files))).toEqual(backup);
  });

  it.each([
    '{bad',
    { format: WORKSPACE_BACKUP_FORMAT, version: 9, files: [] },
    { format: WORKSPACE_BACKUP_FORMAT, version: WORKSPACE_BACKUP_VERSION, files: [{ ...files[0], path: '../escape.glsl' }] },
    { format: WORKSPACE_BACKUP_FORMAT, version: WORKSPACE_BACKUP_VERSION, files: [{ ...files[0], modifiedAt: Infinity }] },
    { format: WORKSPACE_BACKUP_FORMAT, version: WORKSPACE_BACKUP_VERSION, files: [files[0], files[0]] },
  ])('rejects invalid or unsafe archive %j', value => {
    expect(() => parseWorkspaceBackup(value)).toThrow();
  });
});
