import { describe, expect, it } from 'vitest';
import {
  LocalStorageWorkspaceJournal,
  MemoryWorkspaceJournal,
  MemoryWorkspaceStore,
  VirtualWorkspace,
  workspaceRecordWrites,
  type VirtualWorkspaceFile,
  type VirtualWorkspaceStore,
} from '../VirtualWorkspace';

const seedFiles: VirtualWorkspaceFile[] = [
  { path: '/shaders/first.glsl', contents: 'first', createdAt: 10, modifiedAt: 10 },
  { path: '/shaders/first.sha.json', contents: '{}', createdAt: 10, modifiedAt: 10 },
];

/** A store whose writes never land, standing in for a reload that abandons
 * an in-flight save. Loads keep returning what was committed before it. */
class StalledWorkspaceStore implements VirtualWorkspaceStore {
  constructor(private readonly committed: VirtualWorkspaceFile[]) {}

  async load(): Promise<VirtualWorkspaceFile[]> {
    return this.committed.map(file => ({ ...file }));
  }

  save(): Promise<void> {
    return new Promise<void>(() => {});
  }

  async clear(): Promise<void> {}
}

/** A store whose saves resolve only when the test releases them, so a burst of
 * edits can be observed while the first write is still in flight. */
class GatedWorkspaceStore implements VirtualWorkspaceStore {
  readonly saved: VirtualWorkspaceFile[][] = [];
  private readonly gates: (() => void)[] = [];

  constructor(private files: VirtualWorkspaceFile[] | null = null) {}

  async load(): Promise<VirtualWorkspaceFile[] | null> {
    return this.files ? this.files.map(file => ({ ...file })) : null;
  }

  save(files: VirtualWorkspaceFile[]): Promise<void> {
    this.saved.push(files.map(file => ({ ...file })));
    this.files = files.map(file => ({ ...file }));
    return new Promise<void>(resolve => this.gates.push(resolve));
  }

  async clear(): Promise<void> {
    this.files = null;
  }

  /** Let every write issued so far complete. */
  release(): void {
    for (const gate of this.gates.splice(0)) {
      gate();
    }
  }
}

/** Release writes until the workspace has nothing left queued. Writes start on
 * a microtask, so the gates must be opened repeatedly rather than once. */
async function drain(store: GatedWorkspaceStore, workspace: VirtualWorkspace): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    store.release();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await workspace.flush();
}

describe('workspaceRecordWrites', () => {
  const file = (path: string, contents: string, modifiedAt = 1): VirtualWorkspaceFile =>
    ({ path, contents, createdAt: 1, modifiedAt });

  it('writes only the records whose contents or timestamps changed', () => {
    const previous = new Map([
      ['/a.wgsl', file('/a.wgsl', 'one')],
      ['/b.wgsl', file('/b.wgsl', 'two')],
    ]);
    const writes = workspaceRecordWrites(previous, [
      file('/a.wgsl', 'one'),
      file('/b.wgsl', 'two changed', 2),
    ]);
    expect(writes.put.map(entry => entry.path)).toEqual(['/b.wgsl']);
    expect(writes.delete).toEqual([]);
  });

  it('deletes records the snapshot no longer carries', () => {
    const previous = new Map([
      ['/a.wgsl', file('/a.wgsl', 'one')],
      ['/gone.wgsl', file('/gone.wgsl', 'bye')],
    ]);
    const writes = workspaceRecordWrites(previous, [file('/a.wgsl', 'one')]);
    expect(writes.put).toEqual([]);
    expect(writes.delete).toEqual(['/gone.wgsl']);
  });

  it('writes everything when nothing is known to be stored yet', () => {
    const writes = workspaceRecordWrites(new Map(), [file('/a.wgsl', 'one'), file('/b.wgsl', 'two')]);
    expect(writes.put.map(entry => entry.path)).toEqual(['/a.wgsl', '/b.wgsl']);
    expect(writes.delete).toEqual([]);
  });

  it('treats a same-path record with a new creation time as a write', () => {
    const previous = new Map([['/a.wgsl', file('/a.wgsl', 'one')]]);
    const writes = workspaceRecordWrites(previous, [
      { path: '/a.wgsl', contents: 'one', createdAt: 99, modifiedAt: 1 },
    ]);
    expect(writes.put.map(entry => entry.path)).toEqual(['/a.wgsl']);
  });
});

describe('VirtualWorkspace', () => {
  it('coalesces queued saves so a typing burst writes once more, not once each', async () => {
    // Every save carries a complete snapshot, so a queued-but-unstarted write
    // is superseded by the next one. Without coalescing, N keystrokes queue N
    // full writes when only the last matters.
    const store = new GatedWorkspaceStore(seedFiles);
    const workspace = await VirtualWorkspace.open(store, seedFiles);
    workspace.writeText('/shaders/first.glsl', 'a');
    workspace.writeText('/shaders/first.glsl', 'ab');
    workspace.writeText('/shaders/first.glsl', 'abc');
    workspace.writeText('/shaders/first.glsl', 'abcd');
    await drain(store, workspace);

    // At most one write in flight plus one carrying the coalesced remainder;
    // without coalescing this is four.
    expect(store.saved.length).toBeLessThanOrEqual(2);
    expect(store.saved.at(-1)!.find(file => file.path === '/shaders/first.glsl')!.contents).toBe('abcd');
    expect((await VirtualWorkspace.open(store, [])).readText('/shaders/first.glsl')).toBe('abcd');
  });

  it('replays the last edit of a burst whose writes a reload abandoned', async () => {
    // Coalescing drops queued writes, so the journal is what stands between a
    // typing burst and a reload that lands before the store catches up.
    const store = new StalledWorkspaceStore(seedFiles);
    const journal = new MemoryWorkspaceJournal();
    const workspace = await VirtualWorkspace.open(store, seedFiles, () => 20, journal);
    for (const text of ['b', 'bu', 'buf', 'buff', 'buffer edit']) {
      workspace.writeText('/shaders/first.glsl', text);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    const reopened = await VirtualWorkspace.open(store, seedFiles, () => 30, journal);
    expect(reopened.readText('/shaders/first.glsl')).toBe('buffer edit');
  });

  it('keeps the journal until the coalesced write commits', async () => {
    const store = new GatedWorkspaceStore(seedFiles);
    const journal = new MemoryWorkspaceJournal();
    const workspace = await VirtualWorkspace.open(store, seedFiles, () => 20, journal);
    workspace.writeText('/shaders/first.glsl', 'a');
    workspace.writeText('/shaders/first.glsl', 'ab');
    expect(journal.read()?.files.map(file => file.contents)).toEqual(['ab']);
    await drain(store, workspace);
    expect(journal.read()).toBeNull();
  });

  it('coalesces deletions and renames with the edits around them', async () => {
    const store = new GatedWorkspaceStore(seedFiles);
    const workspace = await VirtualWorkspace.open(store, seedFiles);
    workspace.writeText('/shaders/second.glsl', 'second');
    workspace.rename('/shaders/second.glsl', '/shaders/third.glsl');
    workspace.delete('/shaders/first.sha.json');
    await drain(store, workspace);
    const reopened = await VirtualWorkspace.open(store, []);
    expect(reopened.list().map(file => file.path)).toEqual(['/shaders/first.glsl', '/shaders/third.glsl']);
  });

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
    store.save = async () => {
      throw new Error('disk full'); 
    };
    await expect(workspace.applyTextTransaction([{ path: '/shaders/first.glsl', before: 'first', after: 'changed' }])).rejects.toThrow('disk full');
    expect(workspace.list()).toEqual(seedFiles);
    expect(await store.load()).toEqual(seedFiles);
    store.save = save;
    workspace.writeText('/shaders/first.glsl', 'recovered');
    await workspace.flush();
    expect((await store.load())?.[0].contents).toBe('recovered');
  });

  it('writes exactly once and never rolls back when currency lapses mid-save', async () => {
    // Validation runs entirely before the single write, so there is no
    // rollback write to fail: a transaction that was valid when the write
    // began commits once. Currency that lapses mid-save is accepted as a
    // last-writer-wins commit rather than a half-rolled-back workspace.
    const store = new MemoryWorkspaceStore();
    const workspace = await VirtualWorkspace.open(store, seedFiles);
    const save = store.save.bind(store);
    let saves = 0;
    let current = true;
    store.save = async files => {
      saves++; await save(files); current = false; 
    };
    await workspace.applyTextTransaction([{ path: '/shaders/first.glsl', before: 'first', after: 'changed' }], () => current);
    expect(saves).toBe(1);
    expect(workspace.readText('/shaders/first.glsl')).toBe('changed');
    expect((await store.load())?.find(file => file.path === '/shaders/first.glsl')?.contents).toBe('changed');
  });

  it('leaves memory untouched and reports when the store only partially persists', async () => {
    // A store that resolves without persisting the whole snapshot cannot be
    // unwound without a rollback, so the read-back rejects instead: memory
    // never swaps to a state the store does not hold, and the error surfaces.
    const backing = new Map<string, { contents: string; createdAt: number; modifiedAt: number }>();
    let lieSaves = false;
    const store = {
      load: async () => backing.size === 0 ? null : [...backing].map(([path, file]) => ({ path, ...file })),
      save: async (files: { path: string; contents: string; createdAt: number; modifiedAt: number }[]) => {
        const partial = lieSaves ? files.slice(0, 1) : files;
        for (const file of partial) {
          backing.set(file.path, { contents: file.contents, createdAt: file.createdAt, modifiedAt: file.modifiedAt });
        }
      },
      clear: async () => {
        backing.clear(); 
      },
    };
    const workspace = await VirtualWorkspace.open(store as unknown as MemoryWorkspaceStore, [
      { path: '/shaders/first.glsl', contents: 'first', createdAt: 1, modifiedAt: 1 },
      { path: '/shaders/second.glsl', contents: 'second', createdAt: 1, modifiedAt: 1 },
    ]);
    lieSaves = true;
    await expect(workspace.applyTextTransaction([
      { path: '/shaders/first.glsl', before: 'first', after: 'changed' },
      { path: '/shaders/second.glsl', before: 'second', after: 'changed' },
    ])).rejects.toThrow('did not persist');
    expect(workspace.readText('/shaders/first.glsl')).toBe('first');
    expect(workspace.readText('/shaders/second.glsl')).toBe('second');
  });

  it('advances the revision counter only on commit', async () => {
    const store = new MemoryWorkspaceStore();
    const workspace = await VirtualWorkspace.open(store, seedFiles);
    const committed = workspace.revisionCount;
    await expect(workspace.applyTextTransaction(
      [{ path: '/shaders/first.glsl', before: 'stale', after: 'changed' }],
    )).rejects.toThrow('stale');
    expect(workspace.revisionCount).toBe(committed);
    await workspace.applyTextTransaction(
      [{ path: '/shaders/first.glsl', before: 'first', after: 'changed' }],
    );
    expect(workspace.revisionCount).toBe(committed + 1);
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

  it('replays an edit whose store save never committed', async () => {
    // A reload can abandon the queued write. The edit is journalled the moment
    // it is made, so the next workspace opens with it rather than the text the
    // store last committed.
    const store = new StalledWorkspaceStore(seedFiles);
    const journal = new MemoryWorkspaceJournal();
    const workspace = await VirtualWorkspace.open(store, seedFiles, () => 20, journal);
    workspace.writeText('/shaders/first.glsl', 'edited');

    const reloaded = await VirtualWorkspace.open(store, seedFiles, () => 30, journal);
    expect(reloaded.readText('/shaders/first.glsl')).toBe('edited');
    expect(reloaded.readText('/shaders/first.sha.json')).toBe('{}');
  });

  it('replays a creation and a deletion whose save never committed', async () => {
    const store = new StalledWorkspaceStore(seedFiles);
    const journal = new MemoryWorkspaceJournal();
    let now = 20;
    const workspace = await VirtualWorkspace.open(store, seedFiles, () => now++, journal);
    workspace.writeText('/shaders/second.glsl', 'second');
    workspace.delete('/shaders/first.glsl');

    const reloaded = await VirtualWorkspace.open(store, seedFiles, () => 99, journal);
    expect(reloaded.readText('/shaders/second.glsl')).toBe('second');
    expect(reloaded.exists('/shaders/first.glsl')).toBe(false);
  });

  it('drops the journal once the store has committed the same state', async () => {
    const store = new MemoryWorkspaceStore();
    const journal = new MemoryWorkspaceJournal();
    const workspace = await VirtualWorkspace.open(store, seedFiles, () => 20, journal);
    workspace.writeText('/shaders/first.glsl', 'edited');
    await workspace.flush();

    expect(journal.read()).toBeNull();
    expect((await VirtualWorkspace.open(store, seedFiles, () => 30, journal)).readText('/shaders/first.glsl'))
      .toBe('edited');
  });

  it('keeps the stored copy when the journal describes an older edit', async () => {
    // A save that committed without the journal being cleared must not undo
    // the newer text a later session persisted over it.
    const store = new MemoryWorkspaceStore();
    const journal = new MemoryWorkspaceJournal();
    journal.record({
      files: [{ path: '/shaders/first.glsl', contents: 'stale', createdAt: 10, modifiedAt: 15 }],
      deleted: [{ path: '/shaders/first.sha.json', at: 15 }],
    });
    await store.save([
      { path: '/shaders/first.glsl', contents: 'newer', createdAt: 10, modifiedAt: 40 },
      { path: '/shaders/first.sha.json', contents: '{}', createdAt: 10, modifiedAt: 40 },
    ]);

    const workspace = await VirtualWorkspace.open(store, seedFiles, () => 50, journal);
    expect(workspace.readText('/shaders/first.glsl')).toBe('newer');
    expect(workspace.exists('/shaders/first.sha.json')).toBe(true);
  });

  it('lets a committed transaction retire a journalled edit, and a refused one add none', async () => {
    // A transaction round-trips the whole snapshot, so it is authoritative
    // once it commits. A refused one changed nothing and must leave nothing
    // behind for the next open to replay.
    const store = new MemoryWorkspaceStore();
    const journal = new MemoryWorkspaceJournal();
    const workspace = await VirtualWorkspace.open(store, seedFiles, () => 20, journal);
    workspace.writeText('/shaders/first.glsl', 'edited');
    expect(journal.read()?.files.map(file => file.contents)).toEqual(['edited']);
    await workspace.flush();
    expect(journal.read()).toBeNull();

    await expect(workspace.applyTextTransaction(
      [{ path: '/shaders/first.glsl', before: 'stale', after: 'renamed' }],
    )).rejects.toThrow('stale or duplicated');
    expect(journal.read()).toBeNull();

    await workspace.applyTextTransaction(
      [{ path: '/shaders/first.glsl', before: 'edited', after: 'renamed' }],
    );
    expect(journal.read()).toBeNull();
    expect((await VirtualWorkspace.open(store, seedFiles, () => 30, journal)).readText('/shaders/first.glsl'))
      .toBe('renamed');
  });

  it('folds a replayed edit back into the store so the next open needs no journal', async () => {
    const stalled = new StalledWorkspaceStore(seedFiles);
    const journal = new MemoryWorkspaceJournal();
    (await VirtualWorkspace.open(stalled, seedFiles, () => 20, journal))
      .writeText('/shaders/first.glsl', 'edited');

    const store = new MemoryWorkspaceStore();
    await store.save(seedFiles);
    const reloaded = await VirtualWorkspace.open(store, seedFiles, () => 30, journal);
    expect(reloaded.readText('/shaders/first.glsl')).toBe('edited');
    // Opening does not wait on the write, so the journal stands until it lands.
    expect(journal.read()?.files.map(file => file.contents)).toEqual(['edited']);
    await reloaded.flush();
    expect(journal.read()).toBeNull();
    expect((await VirtualWorkspace.open(store, seedFiles, () => 40, new MemoryWorkspaceJournal()))
      .readText('/shaders/first.glsl')).toBe('edited');
  });

  it('clearing the workspace discards the journal with it', async () => {
    const store = new MemoryWorkspaceStore();
    const journal = new MemoryWorkspaceJournal();
    const workspace = await VirtualWorkspace.open(store, seedFiles, () => 20, journal);
    workspace.writeText('/shaders/first.glsl', 'edited');
    await workspace.clear();

    expect(journal.read()).toBeNull();
    expect((await VirtualWorkspace.open(store, seedFiles, () => 30, journal)).readText('/shaders/first.glsl'))
      .toBe('first');
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

describe('LocalStorageWorkspaceJournal', () => {
  const key = 'shader-studio-workspace-journal';
  const record = {
    files: [{ path: '/shaders/first.glsl', contents: 'edited', createdAt: 10, modifiedAt: 20 }],
    deleted: [{ path: '/shaders/second.glsl', at: 20 }],
  };

  function fakeStorage(entries: Record<string, string> = {}) {
    const items = new Map(Object.entries(entries));
    return {
      getItem: (name: string) => items.get(name) ?? null,
      setItem: (name: string, value: string) => void items.set(name, value),
      removeItem: (name: string) => void items.delete(name),
      items,
    } as unknown as Storage & { items: Map<string, string> };
  }

  it('round-trips a record and clears it', () => {
    const storage = fakeStorage();
    const journal = new LocalStorageWorkspaceJournal(key, () => storage);
    expect(journal.read()).toBeNull();
    journal.record(record);
    // Written before the store is even asked, so a fresh page sees it.
    expect(new LocalStorageWorkspaceJournal(key, () => storage).read()).toEqual(record);
    journal.clear();
    expect(journal.read()).toBeNull();
  });

  it.each([
    ['not JSON', 'not json at all'],
    ['a scalar', '42'],
    ['an array', '[1, 2]'],
    ['null', 'null'],
  ])('reads %s as no record', (_label, stored) => {
    const storage = fakeStorage({ [key]: stored });
    expect(new LocalStorageWorkspaceJournal(key, () => storage).read()).toBeNull();
  });

  it('drops entries that are not whole workspace files', () => {
    const storage = fakeStorage({
      [key]: JSON.stringify({
        files: [{ path: '/shaders/first.glsl' }, ...record.files, 'nonsense'],
        deleted: [{ path: '/shaders/second.glsl' }, ...record.deleted, null],
      }),
    });
    expect(new LocalStorageWorkspaceJournal(key, () => storage).read()).toEqual(record);
  });

  it('treats a missing files or deleted list as empty', () => {
    const storage = fakeStorage({ [key]: JSON.stringify({ files: record.files }) });
    expect(new LocalStorageWorkspaceJournal(key, () => storage).read()).toEqual({ files: record.files, deleted: [] });
  });

  it('discards the record rather than keeping a stale one when storage is full', () => {
    const storage = fakeStorage();
    let full = false;
    const journal = new LocalStorageWorkspaceJournal(key, () => full
      ? { ...storage, setItem: () => {
        throw new Error('QuotaExceededError');
      } } as unknown as Storage
      : storage);
    journal.record(record);
    full = true;
    journal.record({ files: [{ path: '/shaders/first.glsl', contents: 'later', createdAt: 10, modifiedAt: 30 }], deleted: [] });
    full = false;
    expect(journal.read()).toBeNull();
  });

  it('survives storage that is absent or throws on every access', () => {
    for (const storage of [
      () => undefined as unknown as Storage,
      () => {
        throw new Error('SecurityError');
      },
    ]) {
      const journal = new LocalStorageWorkspaceJournal(key, storage);
      expect(journal.read()).toBeNull();
      expect(() => journal.record(record)).not.toThrow();
      expect(() => journal.clear()).not.toThrow();
    }
  });
});
