import { describe, expect, it } from 'vitest';
import {
  FileHistory,
  MemoryFileHistoryStore,
  type FileHistoryStore,
  type FileRevision,
} from '../FileHistory';

function createStores(): { store: FileHistoryStore } {
  return { store: new MemoryFileHistoryStore() };
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe('FileHistory', () => {
  it('records the previous contents when a file is overwritten', async () => {
    const { store } = createStores();
    const history = await FileHistory.open(store, {}, () => 1000);

    history.recordOverwrite('/shaders/aurora.glsl', 'original');

    expect(history.listRevisions('/shaders/aurora.glsl')).toEqual([
      expect.objectContaining({ path: '/shaders/aurora.glsl', contents: 'original', timestamp: 1000 }),
    ]);
    expect(history.listPaths()).toEqual(['/shaders/aurora.glsl']);
  });

  it('coalesces rapid overwrites so typing does not flood the database', async () => {
    let now = 1000;
    const { store } = createStores();
    const history = await FileHistory.open(store, { minIntervalMs: 30_000 }, () => now);

    history.recordOverwrite('/a.glsl', 'v1');
    now += 1000;
    history.recordOverwrite('/a.glsl', 'v2');
    now += 1000;
    history.recordOverwrite('/a.glsl', 'v3');

    expect(history.listRevisions('/a.glsl').map((revision) => revision.contents)).toEqual(['v1']);
  });

  it('records again once the coalescing interval has elapsed', async () => {
    let now = 1000;
    const { store } = createStores();
    const history = await FileHistory.open(store, { minIntervalMs: 30_000 }, () => now);

    history.recordOverwrite('/a.glsl', 'v1');
    now += 31_000;
    history.recordOverwrite('/a.glsl', 'v2');

    expect(history.listRevisions('/a.glsl').map((revision) => revision.contents)).toEqual(['v2', 'v1']);
  });

  it('skips duplicate contents even outside the coalescing window', async () => {
    let now = 1000;
    const { store } = createStores();
    const history = await FileHistory.open(store, { minIntervalMs: 30_000 }, () => now);

    history.recordOverwrite('/a.glsl', 'v1');
    now += 60_000;
    history.recordOverwrite('/a.glsl', 'v1');

    expect(history.listRevisions('/a.glsl')).toHaveLength(1);
  });

  it('ignores internal workspace bookkeeping files', async () => {
    const { store } = createStores();
    const history = await FileHistory.open(store, {}, () => 1000);

    history.recordOverwrite('/.shader-studio/active-shader', '/shaders/aurora.glsl');
    history.recordOverwrite('/.shader-studio/thumbnails/x.json', '{}');
    history.recordOverwrite('/.shader-studio/explorer-state.json', '{}');

    expect(history.listPaths()).toEqual([]);
  });

  it('never deletes snapshots before the recent window elapses', async () => {
    let now = 8 * DAY_MS;
    const { store } = createStores();
    const history = await FileHistory.open(store, { minIntervalMs: 0 }, () => now);

    for (let index = 0; index < 120; index++) {
      history.recordOverwrite('/a.glsl', `v${index}`);
      now += 60_000;
    }

    const revisions = history.listRevisions('/a.glsl');
    expect(revisions).toHaveLength(120);
    expect(revisions[0].contents).toBe('v119');
    expect(revisions.at(-1)?.contents).toBe('v0');
  });

  it('keeps every revision from the last seven days', async () => {
    let now = 8 * DAY_MS;
    const { store } = createStores();
    const history = await FileHistory.open(store, { minIntervalMs: 0 }, () => now);

    for (let index = 0; index < 60; index++) {
      history.recordOverwrite('/a.glsl', `v${index}`);
      now += 60_000;
    }

    const revisions = history.listRevisions('/a.glsl');
    expect(revisions).toHaveLength(60);
    expect(revisions[0].contents).toBe('v59');
  });

  it('combines revisions older than seven days to one per day', async () => {
    let now = 20 * DAY_MS;
    const { store } = createStores();
    const history = await FileHistory.open(store, { minIntervalMs: 0 }, () => now);

    history.recordOverwrite('/a.glsl', 'd20a');
    now += 1000;
    history.recordOverwrite('/a.glsl', 'd20b');
    now = 21 * DAY_MS;
    history.recordOverwrite('/a.glsl', 'd21a');
    now += 1000;
    history.recordOverwrite('/a.glsl', 'd21b');
    now = 30 * DAY_MS;
    history.recordOverwrite('/a.glsl', 'fresh');

    expect(history.listRevisions('/a.glsl').map((revision) => revision.contents)).toEqual([
      'fresh',
      'd21b',
      'd20b',
    ]);
  });

  it('keeps one combined snapshot per old day with no limit', async () => {
    let now = 0;
    const { store } = createStores();
    const history = await FileHistory.open(store, { minIntervalMs: 0 }, () => now);

    for (let day = 0; day < 10; day++) {
      now = day * DAY_MS;
      history.recordOverwrite('/a.glsl', `d${day}-first`);
      now += 1000;
      history.recordOverwrite('/a.glsl', `d${day}-second`);
    }
    now = 30 * DAY_MS;
    history.recordOverwrite('/a.glsl', 'fresh');

    expect(history.listRevisions('/a.glsl').map((revision) => revision.contents)).toEqual([
      'fresh',
      'd9-second',
      'd8-second',
      'd7-second',
      'd6-second',
      'd5-second',
      'd4-second',
      'd3-second',
      'd2-second',
      'd1-second',
      'd0-second',
    ]);
  });

  it('tracks files independently', async () => {
    const { store } = createStores();
    const history = await FileHistory.open(store, { minIntervalMs: 30_000 }, () => 1000);

    history.recordOverwrite('/a.glsl', 'a1');
    history.recordOverwrite('/b.glsl', 'b1');

    expect(history.listPaths()).toEqual(expect.arrayContaining(['/a.glsl', '/b.glsl']));
    expect(history.listRevisions('/b.glsl').map((revision) => revision.contents)).toEqual(['b1']);
  });

  it('moves revisions on rename and drops them on delete', async () => {
    const { store } = createStores();
    const history = await FileHistory.open(store, {}, () => 1000);

    history.recordOverwrite('/old.glsl', 'v1');
    history.renameHistory('/old.glsl', '/new.glsl');

    expect(history.listPaths()).toEqual(['/new.glsl']);
    expect(history.listRevisions('/new.glsl').map((revision) => revision.contents)).toEqual(['v1']);

    history.dropHistory('/new.glsl');
    expect(history.listPaths()).toEqual([]);
    expect(history.listRevisions('/new.glsl')).toEqual([]);
  });

  it('records a restore point that bypasses coalescing so a restore stays undoable', async () => {
    let now = 1000;
    const { store } = createStores();
    const history = await FileHistory.open(store, { minIntervalMs: 30_000 }, () => now);

    history.recordOverwrite('/a.glsl', 'v1');
    now += 1000;
    history.recordRestorePoint('/a.glsl', 'edited after v1');

    const revisions = history.listRevisions('/a.glsl');
    expect(revisions.map((revision) => revision.contents)).toEqual(['edited after v1', 'v1']);
  });

  it('skips restore points that duplicate the latest revision', async () => {
    const { store } = createStores();
    const history = await FileHistory.open(store, {}, () => 1000);

    history.recordOverwrite('/a.glsl', 'v1');
    history.recordRestorePoint('/a.glsl', 'v1');

    expect(history.listRevisions('/a.glsl')).toHaveLength(1);
  });

  it('persists revisions across instances', async () => {
    const { store } = createStores();
    const history = await FileHistory.open(store, {}, () => 1000);
    history.recordOverwrite('/a.glsl', 'v1');
    await history.flush();

    const restored = await FileHistory.open(store, {}, () => 2000);
    expect(restored.listRevisions('/a.glsl').map((revision) => revision.contents)).toEqual(['v1']);
  });

  it('returns copies so callers cannot mutate stored revisions', async () => {
    const { store } = createStores();
    const history = await FileHistory.open(store, {}, () => 1000);
    history.recordOverwrite('/a.glsl', 'v1');

    const revisions = history.listRevisions('/a.glsl');
    revisions[0].contents = 'mutated';
    expect(history.listRevisions('/a.glsl')[0].contents).toBe('v1');
    expect(history.getRevision('/a.glsl', revisions[0].id)).toMatchObject({ contents: 'v1' });
  });

  it('returns null for unknown revision lookups', async () => {
    const { store } = createStores();
    const history = await FileHistory.open(store, {}, () => 1000);

    expect(history.getRevision('/missing.glsl', 'nope')).toBeNull();
    history.recordOverwrite('/a.glsl', 'v1');
    const id = history.listRevisions('/a.glsl')[0].id;
    expect(history.getRevision('/a.glsl', 'nope')).toBeNull();
    expect(history.getRevision('/other.glsl', id)).toBeNull();
  });

  it('notifies subscribers on change and stops after unsubscribe', async () => {
    let now = 1000;
    const { store } = createStores();
    const history = await FileHistory.open(store, { minIntervalMs: 0 }, () => now);
    let calls = 0;
    const unsubscribe = history.onChange(() => {
      calls++;
    });

    history.recordOverwrite('/a.glsl', 'v1');
    expect(calls).toBe(1);
    unsubscribe();
    now += 1000;
    history.recordOverwrite('/a.glsl', 'v2');
    expect(calls).toBe(1);
  });

  it('does not notify when a write is coalesced away', async () => {
    const { store } = createStores();
    const history = await FileHistory.open(store, { minIntervalMs: 30_000 }, () => 1000);
    let calls = 0;
    history.onChange(() => {
      calls++;
    });

    history.recordOverwrite('/a.glsl', 'v1');
    history.recordOverwrite('/a.glsl', 'v2');
    expect(calls).toBe(1);
  });

  it('clears every revision and persists the empty state', async () => {
    const { store } = createStores();
    const history = await FileHistory.open(store, {}, () => 1000);
    let calls = 0;
    history.onChange(() => {
      calls++;
    });
    history.recordOverwrite('/a.glsl', 'v1');
    history.clearHistory();
    await history.flush();

    expect(history.listPaths()).toEqual([]);
    expect(calls).toBe(2);
    const restored = await FileHistory.open(store, {}, () => 2000);
    expect(restored.listPaths()).toEqual([]);
  });

  it('clearing an empty history is a no-op', async () => {
    const { store } = createStores();
    const history = await FileHistory.open(store, {}, () => 1000);
    let calls = 0;
    history.onChange(() => {
      calls++;
    });

    history.clearHistory();

    expect(calls).toBe(0);
  });

  it('orders paths by most recent activity', async () => {
    let now = 1000;
    const { store } = createStores();
    const history = await FileHistory.open(store, { minIntervalMs: 0 }, () => now);

    history.recordOverwrite('/a.glsl', 'a1');
    now += 1000;
    history.recordOverwrite('/b.glsl', 'b1');
    now += 1000;
    history.recordOverwrite('/a.glsl', 'a2');

    expect(history.listPaths()).toEqual(['/a.glsl', '/b.glsl']);
  });

  it('exposes revision metadata with unique ids', async () => {
    const { store } = createStores();
    const history = await FileHistory.open(store, { minIntervalMs: 0 }, () => 1000);
    history.recordOverwrite('/a.glsl', 'v1');
    history.recordOverwrite('/a.glsl', 'v2');

    const revisions: FileRevision[] = history.listRevisions('/a.glsl');
    expect(revisions).toHaveLength(2);
    expect(new Set(revisions.map((revision) => revision.id)).size).toBe(2);
    for (const revision of revisions) {
      expect(revision.size).toBe(revision.contents.length);
      expect(revision.timestamp).toBe(1000);
    }
  });
});
