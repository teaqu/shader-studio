import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveNewWorkspaceFile, resolveWorkspaceFile, textRevision } from '../../src/app/mcp/WorkspaceFiles';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});
function fixture() {
  const parent = mkdtempSync(path.join(tmpdir(), 'shader-mcp-'));
  dirs.push(parent);
  const root = path.join(parent, 'workspace');
  mkdirSync(root);
  const file = path.join(root, 'shader.glsl');
  writeFileSync(file, 'shader');
  return { parent, root, file };
}

describe('WorkspaceFiles', () => {
  it.runIf(process.platform === 'win32')('recognizes an open document with a differently cased drive letter', () => {
    const { file } = fixture();
    const lowerDrive = file[0].toLowerCase() + file.slice(1);
    const upperDrive = file[0].toUpperCase() + file.slice(1);
    expect(resolveWorkspaceFile(upperDrive, [], [lowerDrive])).toBe(upperDrive);
  });
  it('resolves existing text files and stable revisions', () => {
    const { root, file } = fixture();
    expect(resolveWorkspaceFile('shader.glsl', [root])).toBe(file);
    expect(resolveWorkspaceFile(file, [root])).toBe(file);
    expect(textRevision('shader')).toBe(textRevision('shader'));
    expect(textRevision('edited')).not.toBe(textRevision('shader'));
    expect(() => resolveWorkspaceFile('shader.glsl', [])).toThrow('absolute');
    expect(() => resolveWorkspaceFile('shader.glsl', [root, root])).toThrow('absolute');
  });

  it('blocks traversal, symlink escapes, directories, Git internals and oversized files', () => {
    const { parent, root, file } = fixture();
    const outside = path.join(parent, 'outside');
    mkdirSync(outside);
    const external = path.join(outside, 'private.glsl');
    writeFileSync(external, 'private');
    expect(() => resolveWorkspaceFile('../outside/private.glsl', [root])).toThrow('workspace');
    const link = path.join(root, 'link');
    symlinkSync(outside, link, 'junction');
    expect(() => resolveWorkspaceFile(path.join(link, 'private.glsl'), [root])).toThrow('workspace');
    expect(resolveWorkspaceFile(external, [], [external])).toBe(external);
    expect(() => resolveWorkspaceFile(root, [root])).toThrow();
    expect(() => resolveWorkspaceFile(outside, [parent])).toThrow('text file');
    mkdirSync(path.join(root, '.git'));
    writeFileSync(path.join(root, '.git', 'config'), 'git');
    expect(() => resolveWorkspaceFile('.git/config', [root])).toThrow('Git internal');
    writeFileSync(file, 'x'.repeat(1_000_001));
    expect(() => resolveWorkspaceFile(file, [root])).toThrow('1 MB');
    expect(() => resolveWorkspaceFile('missing', [root])).toThrow();
  });

  it('resolves only new files with an existing workspace parent', () => {
    const { root, file, parent } = fixture();
    expect(resolveNewWorkspaceFile('new.glsl', [root])).toBe(path.join(root, 'new.glsl'));
    expect(() => resolveNewWorkspaceFile(file, [root])).toThrow('already exists');
    expect(() => resolveNewWorkspaceFile('../new.glsl', [root])).toThrow('workspace');
    expect(() => resolveNewWorkspaceFile('missing/new.glsl', [root])).toThrow('Parent directory');
    mkdirSync(path.join(root, '.git'));
    expect(() => resolveNewWorkspaceFile('.git/new.glsl', [root])).toThrow('Git internal');
    expect(() => resolveNewWorkspaceFile(path.join(parent, 'outside.glsl'), [root])).toThrow('workspace');
  });
});
