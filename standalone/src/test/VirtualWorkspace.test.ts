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
  it.each(['glsl', 'slang', 'wgsl'])('commits all %s rename files in one persisted snapshot', async language => {
    const store = new MemoryWorkspaceStore();
    const files = ['main', 'common'].map(name => ({ path: `/shaders/${name}.${language}`, contents: 'tone', createdAt: 1, modifiedAt: 1 }));
    const workspace = await VirtualWorkspace.open(store, files);
    await workspace.applyTextTransaction(files.map(file => ({ path: file.path, before: 'tone', after: 'curve' })));
    expect((await VirtualWorkspace.open(store, [])).list().map(file => file.contents)).toEqual(['curve', 'curve']);
  });

  it('accepts a transaction whose stored copy lags an open buffer', async () => {
    // The editor holds unsaved text the stored copy does not have yet. The
    // edit was computed against the live buffer, so comparing against it
    // must accept; comparing against the stored copy would falsely refuse.
    const store = new MemoryWorkspaceStore();
    const workspace = await VirtualWorkspace.open(store, []);
    workspace.writeText('/shaders/main.glsl', 'tone');
    await workspace.applyTextTransaction(
      [{ path: '/shaders/main.glsl', before: 'tone-live', after: 'curve' }],
      () => true,
      () => {},
      new Map([['/shaders/main.glsl', 'tone-live']]),
    );
    expect(workspace.readText('/shaders/main.glsl')).toBe('curve');
  });

  it('still refuses when the open buffer moved after the edit was computed', async () => {
    // Stored and request-time text agree, so only the open-buffer comparison
    // can catch this genuine mid-flight change.
    const store = new MemoryWorkspaceStore();
    const workspace = await VirtualWorkspace.open(store, []);
    workspace.writeText('/shaders/main.glsl', 'tone');
    await expect(workspace.applyTextTransaction(
      [{ path: '/shaders/main.glsl', before: 'tone', after: 'curve' }],
      () => true,
      () => {},
      new Map([['/shaders/main.glsl', 'tone-moved']]),
    )).rejects.toThrow('stale');
    expect(workspace.readText('/shaders/main.glsl')).toBe('tone');
  });

  it('rejects a stale or missing target without changing or saving any target', async () => {
    const store = new MemoryWorkspaceStore();
    const workspace = await VirtualWorkspace.open(store, seedFiles);
    for (const path of ['/shaders/first.sha.json', '/missing']) {
      await expect(workspace.applyTextTransaction([
        { path: '/shaders/first.glsl', before: 'first', after: 'changed' },
        { path, before: 'stale', after: 'changed' },
      ])).rejects.toThrow();
      expect(workspace.list()).toEqual(seedFiles);
      expect(await store.load()).toEqual(seedFiles);
    }
  });

  it('keeps every file unchanged when persistence fails and allows subsequent saves', async () => {
    const store = new MemoryWorkspaceStore();
    const workspace = await VirtualWorkspace.open(store, seedFiles);
    const save = store.save.bind(store);
    store.save = async () => { throw new Error('disk full'); };
    await expect(workspace.applyTextTransaction([{ path: '/shaders/first.glsl', before: 'first', after: 'changed' }])).rejects.toThrow('disk full');
    expect(workspace.list()).toEqual(seedFiles);
    expect(await store.load()).toEqual(seedFiles);
    store.save = save;
    workspace.writeText('/shaders/first.glsl', 'recovered');
    await workspace.flush();
    expect((await store.load())?.[0].contents).toBe('recovered');
  });

  it('rolls back the whole persisted snapshot if cancellation arrives during save', async () => {
    const store = new MemoryWorkspaceStore();
    const workspace = await VirtualWorkspace.open(store, seedFiles);
    const save = store.save.bind(store);
    let current = true;
    store.save = async files => { await save(files); current = false; };
    await expect(workspace.applyTextTransaction([{ path: '/shaders/first.glsl', before: 'first', after: 'changed' }], () => current)).rejects.toThrow('stale');
    expect(workspace.list()).toEqual(seedFiles);
    expect(await store.load()).toEqual(seedFiles);
  });

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
