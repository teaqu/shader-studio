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

  it.each([
    ['null', null],
    ['an array', []],
    ['a number', 7],
    ['JSON null', 'null'],
    ['a JSON array', '[]'],
  ])('rejects %s as the archive itself', (_label, value) => {
    expect(() => parseWorkspaceBackup(value)).toThrow('Backup must be an object.');
  });

  it('rejects an archive whose files field is not an array', () => {
    expect(() => parseWorkspaceBackup({ format: WORKSPACE_BACKUP_FORMAT, version: WORKSPACE_BACKUP_VERSION, files: {} }))
      .toThrow('invalid workspace file');
  });

  it('rejects an archive for another application', () => {
    expect(() => parseWorkspaceBackup({ format: 'other-app', version: WORKSPACE_BACKUP_VERSION, files: [] }))
      .toThrow('format or version is not supported');
  });

  it.each([
    ['null', null],
    ['an array', ['/shaders/main.glsl', 'void main() {}', 1, 2]],
    ['a string', '/shaders/main.glsl'],
  ])('rejects %s in place of a file record', (_label, entry) => {
    expect(() => parseWorkspaceBackup({ format: WORKSPACE_BACKUP_FORMAT, version: WORKSPACE_BACKUP_VERSION, files: [entry] }))
      .toThrow('invalid workspace file');
  });

  it.each([
    ['a relative path', 'shaders/main.glsl'],
    ['the workspace root', '/'],
    ['a Windows separator', '/shaders\\main.glsl'],
    ['a current-directory segment', '/shaders/./main.glsl'],
    ['a parent segment inside the path', '/shaders/../main.glsl'],
  ])('rejects %s so imports cannot smuggle non-canonical paths', (_label, path) => {
    expect(() => parseWorkspaceBackup({ format: WORKSPACE_BACKUP_FORMAT, version: WORKSPACE_BACKUP_VERSION, files: [{ ...files[0], path }] }))
      .toThrow('invalid workspace file');
  });

  it.each([
    ['contents', { contents: 42 }],
    ['createdAt', { createdAt: '1' }],
    ['createdAt', { createdAt: Number.NaN }],
    ['modifiedAt', { modifiedAt: undefined }],
  ])('rejects a file whose %s has the wrong type', (_field, override) => {
    expect(() => parseWorkspaceBackup({ format: WORKSPACE_BACKUP_FORMAT, version: WORKSPACE_BACKUP_VERSION, files: [{ ...files[0], ...override }] }))
      .toThrow('invalid workspace file');
  });

  it('names the duplicated path', () => {
    expect(() => parseWorkspaceBackup({ format: WORKSPACE_BACKUP_FORMAT, version: WORKSPACE_BACKUP_VERSION, files: [files[0], { ...files[0] }] }))
      .toThrow(`duplicate path: ${files[0].path}`);
  });

  it('accepts an empty workspace archive', () => {
    expect(parseWorkspaceBackup({ format: WORKSPACE_BACKUP_FORMAT, version: WORKSPACE_BACKUP_VERSION, files: [] }).files).toEqual([]);
  });

  it('does not share file objects with the parsed input', () => {
    const input = { format: WORKSPACE_BACKUP_FORMAT, version: WORKSPACE_BACKUP_VERSION, files: [{ ...files[0] }] };
    const parsed = parseWorkspaceBackup(input);
    input.files[0].contents = 'mutated';
    expect(parsed.files[0].contents).not.toBe('mutated');
  });

  it('serializes with a trailing newline so saved files end cleanly', () => {
    expect(serializeWorkspaceBackup([])).toMatch(/\}\n$/);
  });
});
