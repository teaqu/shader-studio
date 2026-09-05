import { describe, expect, it } from 'vitest';
import {
  MemoryWorkspaceStore,
  VirtualWorkspace,
  type VirtualWorkspaceFile,
} from '../VirtualWorkspace';

const seedFiles: VirtualWorkspaceFile[] = [
  { path: '/shaders/first.glsl', contents: 'first', createdAt: 10, modifiedAt: 10 },
  { path: '/shaders/first.sha.json', contents: '{}', createdAt: 10, modifiedAt: 10 },
];

describe('VirtualWorkspace', () => {
  it('seeds an empty store and persists edits across workspace instances', async () => {
    const store = new MemoryWorkspaceStore();
    const first = await VirtualWorkspace.open(store, seedFiles, () => 20);

    expect(first.readText('/shaders/first.glsl')).toBe('first');
    first.writeText('/shaders/first.glsl', 'edited');
    await first.flush();

    const restored = await VirtualWorkspace.open(store, [
      { path: '/shaders/new-default.glsl', contents: 'new default', createdAt: 30, modifiedAt: 30 },
    ]);
    expect(restored.readText('/shaders/first.glsl')).toBe('edited');
    expect(restored.exists('/shaders/new-default.glsl')).toBe(false);
  });

  it('normalizes paths and rejects traversal outside the workspace root', async () => {
    const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), seedFiles);

    expect(workspace.readText('shaders/./first.glsl')).toBe('first');
    expect(() => workspace.readText('../../outside.glsl')).toThrow('outside the virtual workspace');
  });

  it('lists files recursively with stable metadata', async () => {
    const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), seedFiles);

    expect(workspace.list('/shaders')).toEqual(seedFiles);
  });

  it('creates, renames, and deletes files while preserving creation time', async () => {
    let now = 100;
    const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), [], () => now++);

    workspace.writeText('/shaders/new.glsl', 'one');
    workspace.writeText('/shaders/new.glsl', 'two');
    workspace.rename('/shaders/new.glsl', '/shaders/renamed.glsl');

    expect(workspace.stat('/shaders/renamed.glsl')).toMatchObject({ createdAt: 100, modifiedAt: 101 });
    expect(workspace.readText('/shaders/renamed.glsl')).toBe('two');
    workspace.delete('/shaders/renamed.glsl');
    expect(workspace.exists('/shaders/renamed.glsl')).toBe(false);
  });

  it('reports missing files and refuses to overwrite on rename', async () => {
    const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), seedFiles);
    workspace.writeText('/shaders/other.glsl', 'other');

    expect(() => workspace.readText('/missing.glsl')).toThrow('File not found');
    expect(() => workspace.rename('/missing.glsl', '/shaders/new.glsl')).toThrow('File not found');
    expect(() => workspace.rename('/shaders/first.glsl', '/shaders/other.glsl')).toThrow('already exists');
  });

  it('clears persisted files so the next workspace is seeded again', async () => {
    const store = new MemoryWorkspaceStore();
    const workspace = await VirtualWorkspace.open(store, seedFiles);
    workspace.writeText('/shaders/first.glsl', 'edited');
    await workspace.clear();

    expect(workspace.list()).toEqual([]);

    const restored = await VirtualWorkspace.open(store, seedFiles);
    expect(restored.list()).toEqual(seedFiles);
  });
});
