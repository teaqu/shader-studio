import { describe, expect, it, vi } from 'vitest';
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

  it('notifies the history sink when an existing file is overwritten', async () => {
    const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), seedFiles);
    const sink = {
      recordOverwrite: (...args: unknown[]) => void args,
      renameHistory: (...args: unknown[]) => void args,
      dropHistory: (...args: unknown[]) => void args,
      clearHistory: (...args: unknown[]) => void args,
    };
    const record = vi.fn(sink.recordOverwrite);
    workspace.setHistorySink({ ...sink, recordOverwrite: record });

    workspace.writeText('/shaders/first.glsl', 'edited');

    expect(record).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith('/shaders/first.glsl', 'first');
  });

  it('skips history for new files, identical writes, and detached sinks', async () => {
    const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), seedFiles);
    const record = vi.fn();
    const rename = vi.fn();
    const drop = vi.fn();
    const clear = vi.fn();
    workspace.setHistorySink({ recordOverwrite: record, renameHistory: rename, dropHistory: drop, clearHistory: clear });

    workspace.writeText('/shaders/created.glsl', 'new');
    workspace.writeText('/shaders/first.glsl', 'first');

    expect(record).not.toHaveBeenCalled();

    workspace.setHistorySink(null);
    workspace.writeText('/shaders/first.glsl', 'edited without sink');
    expect(record).not.toHaveBeenCalled();
  });

  it('forwards rename, delete, and clear to the history sink', async () => {
    const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), seedFiles);
    const rename = vi.fn();
    const drop = vi.fn();
    const clear = vi.fn();
    workspace.setHistorySink({ recordOverwrite: vi.fn(), renameHistory: rename, dropHistory: drop, clearHistory: clear });

    workspace.rename('/shaders/first.glsl', '/shaders/renamed.glsl');
    expect(rename).toHaveBeenCalledWith('/shaders/first.glsl', '/shaders/renamed.glsl');

    workspace.delete('/shaders/renamed.glsl');
    expect(drop).toHaveBeenCalledWith('/shaders/renamed.glsl');

    await workspace.clear();
    expect(clear).toHaveBeenCalledOnce();
  });
});
