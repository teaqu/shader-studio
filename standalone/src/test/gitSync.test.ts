import { describe, expect, it } from 'vitest';
import {
  describeRemoteEntry,
  diffSnapshots,
  isTrackedPath,
  normalizeRepoPath,
  snapshotTrackedFiles,
  toRepoPath,
} from '../git/gitSync';

describe('gitSync paths', () => {
  it('excludes standalone internal state from tracking', () => {
    expect(isTrackedPath('/shaders/a.glsl')).toBe(true);
    expect(isTrackedPath('/.shader-studio/active-shader')).toBe(false);
    expect(isTrackedPath('/.shader-studio/thumbnails/x.json')).toBe(false);
  });

  it('rejects reserved paths when mapping remote entries', () => {
    expect(() => normalizeRepoPath('/.shader-studio/active-shader')).toThrow('reserved');
    expect(() => normalizeRepoPath('.shader-studio/x')).toThrow('reserved');
    expect(normalizeRepoPath('shaders/a.glsl')).toBe('/shaders/a.glsl');
  });

  it('strips the workspace slash for repo paths', () => {
    expect(toRepoPath('/shaders/a.glsl')).toBe('shaders/a.glsl');
  });

  it('snapshots only tracked files', () => {
    const snapshot = snapshotTrackedFiles([
      { path: '/shaders/a.glsl', contents: 'a' },
      { path: '/.shader-studio/active-shader', contents: '/shaders/a.glsl' },
    ]);
    expect([...snapshot.keys()]).toEqual(['/shaders/a.glsl']);
  });
});

describe('diffSnapshots', () => {
  it('reports a clean tree', () => {
    const base = new Map([['/a.glsl', 'same']]);
    expect(diffSnapshots(base, new Map(base))).toEqual({ added: [], modified: [], deleted: [], clean: true });
  });

  it('reports added, modified, and deleted files sorted', () => {
    const base = new Map([['/b.glsl', 'b'], ['/a.glsl', 'a'], ['/gone.glsl', 'x']]);
    const current = new Map([['/a.glsl', 'a-changed'], ['/b.glsl', 'b'], ['/new.glsl', 'n'], ['/mid.glsl', 'm']]);
    const diff = diffSnapshots(base, current);
    expect(diff).toEqual({
      added: ['/mid.glsl', '/new.glsl'],
      modified: ['/a.glsl'],
      deleted: ['/gone.glsl'],
      clean: false,
    });
  });

  it('treats empty base as all-added', () => {
    const diff = diffSnapshots(new Map(), new Map([['/a.glsl', 'a']]));
    expect(diff.clean).toBe(false);
    expect(diff.added).toEqual(['/a.glsl']);
  });
});

describe('describeRemoteEntry', () => {
  it('maps fetched text to a workspace write', () => {
    expect(describeRemoteEntry('a.glsl', { text: 'hi', skipped: null })).toEqual({
      write: [{ path: '/a.glsl', contents: 'hi' }],
      remove: [],
      skipped: [],
    });
  });

  it('records skipped binary entries', () => {
    expect(describeRemoteEntry('logo.png', { text: null, skipped: 'binary' })).toEqual({
      write: [],
      remove: [],
      skipped: [{ path: '/logo.png', reason: 'binary' }],
    });
  });
});
