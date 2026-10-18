import { expect, it, vi } from 'vitest';
import { WebTransport } from '../WebTransport';
import { WebExtensionHost } from '../WebExtensionHost';
import { MemoryWorkspaceStore, VirtualWorkspace } from '../VirtualWorkspace';
import { createWorkspaceFile, createWorkspaceFolder, deleteWorkspacePath, deleteWorkspacePaths, moveWorkspacePaths, renameWorkspacePath, userWorkspaceFiles, workspaceTree, workspaceUserPath } from '../workspaceFiles';

it('moves and deletes multiple selections once, including shader configs and selected descendants', async () => {
  const ws = await VirtualWorkspace.open(new MemoryWorkspaceStore(), []);
  ws.writeText('/main.glsl', 'source');
  ws.writeText('/main.sha.json', '{}');
  ws.writeText('/assets/photo.png', 'bytes');
  createWorkspaceFolder(ws, '/assets/empty');
  const moves = moveWorkspacePaths(ws, ['/main.glsl', '/main.sha.json', '/assets', '/assets/photo.png'], '/archive');
  expect(moves.map(move => move.to)).toEqual(['/archive/main.glsl', '/archive/main.sha.json', '/archive/assets/photo.png']);
  expect(userWorkspaceFiles(ws).some(file => file.path === '/archive/assets/empty')).toBe(true);
  deleteWorkspacePaths(ws, ['/archive/main.glsl', '/archive/main.sha.json', '/archive/assets', '/archive/assets/photo.png']);
  expect(userWorkspaceFiles(ws)).toEqual([]);
});

it('preflights every destination and source before changing a multi selection', async () => {
  const ws = await VirtualWorkspace.open(new MemoryWorkspaceStore(), []);
  ws.writeText('/one/a.txt', 'one');
  ws.writeText('/two/a.txt', 'two');
  const before = ws.list();
  expect(() => moveWorkspacePaths(ws, ['/one/a.txt', '/two/a.txt'], '/target')).toThrow('same destination');
  expect(ws.list()).toEqual(before);
  expect(() => deleteWorkspacePaths(ws, ['/one/a.txt', '/missing.txt'])).toThrow('no longer exists');
  expect(ws.list()).toEqual(before);
  expect(moveWorkspacePaths(ws, ['/one/a.txt'], '/one')).toEqual([]);
});

it('creates empty folders that survive reopen, nested moves, backups and deletion', async () => {
  const store = new MemoryWorkspaceStore();
  const ws = await VirtualWorkspace.open(store, []);
  createWorkspaceFolder(ws, '/assets/empty');
  await ws.flush();
  const reopened = await VirtualWorkspace.open(store, []);
  expect(userWorkspaceFiles(reopened)).toEqual([{ path: '/assets/empty', asset: false, directory: true }]);
  expect(workspaceTree(userWorkspaceFiles(reopened), new Set()).map(row => [row.path, row.directory])).toEqual([
    ['/assets', true], ['/assets/empty', true],
  ]);
  expect(() => createWorkspaceFile(reopened, '/assets')).toThrow('already exists');
  expect(() => createWorkspaceFolder(reopened, '/assets/empty')).toThrow('already exists');
  renameWorkspacePath(reopened, '/assets', '/moved');
  expect(userWorkspaceFiles(reopened)).toEqual([{ path: '/moved/empty', asset: false, directory: true }]);
  const restored = await VirtualWorkspace.open(new MemoryWorkspaceStore(), []);
  await restored.importBackup(reopened.exportBackup());
  expect(userWorkspaceFiles(restored)).toEqual(userWorkspaceFiles(reopened));
  deleteWorkspacePath(restored, '/moved');
  expect(userWorkspaceFiles(restored)).toEqual([]);
});

it('does not expose malformed folder metadata as user files', async () => {
  const ws = await workspace();
  ws.writeText('/.shader-studio/folders/broken', '../escape');
  expect(userWorkspaceFiles(ws)).toEqual([]);
});

async function workspace(paths: string[] = []) {
  return VirtualWorkspace.open(new MemoryWorkspaceStore(), paths.map(path => ({ path, contents: path.endsWith('.png') ? 'data:image/png;base64,AA==' : 'source', createdAt: 1, modifiedAt: 1 })));
}

it('builds sorted expandable folder rows and retains matching ancestors while searching', () => {
  const files = ['/shaders/b.glsl', '/shaders/assets/z.png', '/shaders/a.glsl', '/notes.txt'].map(path => ({ path, asset: false }));
  expect(workspaceTree(files, new Set()).map(row => [row.name, row.depth, row.directory])).toEqual([
    ['shaders', 0, true], ['assets', 1, true], ['z.png', 2, false], ['a.glsl', 1, false], ['b.glsl', 1, false], ['notes.txt', 0, false],
  ]);
  expect(workspaceTree(files, new Set(['/shaders'])).map(row => row.path)).toEqual(['/shaders', '/notes.txt']);
  expect(workspaceTree(files, new Set(['/shaders']), 'Z.PNG').map(row => row.path)).toEqual(['/shaders', '/shaders/assets', '/shaders/assets/z.png']);
  expect(workspaceTree(files, new Set(), 'missing')).toEqual([]);
});

it('marks assets and hides internal metadata', async () => {
  expect(userWorkspaceFiles(await workspace(['/a.glsl', '/a.png', '/.shader-studio/active-shader']))).toEqual([
    { path: '/a.glsl', asset: false }, { path: '/a.png', asset: true },
  ]);
});

it.each(['', '/', '/a//b', '/a/../b', '/./a', '/.shader-studio/active-shader', '/a\u0000.txt'])('rejects unsafe user path %j', path => {
  expect(() => workspaceUserPath(path)).toThrow('inside the workspace');
});

it('accepts nested names and normalizes backslashes', () => {
  expect(workspaceUserPath('shaders\\folder\\image.png')).toBe('/shaders/folder/image.png');
});

it('creates a file and rejects occupied files, folders and file parents', async () => {
  const ws = await workspace(['/existing.txt', '/directory/child.txt']);
  expect(createWorkspaceFile(ws, 'new/source.glsl')).toBe('/new/source.glsl');
  expect(ws.readText('/new/source.glsl')).toBe('');
  expect(() => createWorkspaceFile(ws, '/existing.txt')).toThrow('already exists');
  expect(() => createWorkspaceFile(ws, '/directory')).toThrow('already exists');
  expect(() => createWorkspaceFile(ws, '/existing.txt/child')).toThrow('parent folder');
});

it('renames a shader with its sidecar and moves folders with descendants', async () => {
  const ws = await workspace(['/shaders/main.glsl', '/shaders/main.sha.json', '/shaders/images/a.png']);
  expect(renameWorkspacePath(ws, '/shaders/main.glsl', '/shaders/renamed.glsl')).toEqual([
    { from: '/shaders/main.glsl', to: '/shaders/renamed.glsl' }, { from: '/shaders/main.sha.json', to: '/shaders/renamed.sha.json' },
  ]);
  expect(renameWorkspacePath(ws, '/shaders', '/projects/demo')).toHaveLength(3);
  expect(ws.readText('/projects/demo/images/a.png')).toContain('data:');
  expect(ws.list('/shaders')).toEqual([]);
  expect(renameWorkspacePath(ws, '/projects/demo', '/projects/demo')).toEqual([]);
});

it('rejects missing paths, recursive moves, invalid suffixes and collisions before mutating', async () => {
  const ws = await workspace(['/a/main.glsl', '/a/main.sha.json', '/b/existing.txt', '/b/renamed.sha.json']);
  const before = ws.list();
  expect(() => renameWorkspacePath(ws, '/missing', '/anything')).toThrow('no longer exists');
  expect(() => renameWorkspacePath(ws, '/a', '/a/nested')).toThrow('inside itself');
  expect(() => renameWorkspacePath(ws, '/a/main.glsl', '/b/main.txt')).toThrow('shader file extension');
  expect(() => renameWorkspacePath(ws, '/a', '/b')).toThrow('already exists');
  expect(() => renameWorkspacePath(ws, '/a/main.glsl', '/b/renamed.glsl')).toThrow('already exists');
  expect(ws.list()).toEqual(before);
});

it('renames regular files and shaders without sidecars', async () => {
  const ws = await workspace(['/a.txt', '/a.glsl']);
  renameWorkspacePath(ws, '/a.txt', '/notes.txt');
  renameWorkspacePath(ws, '/a.glsl', '/new.glsl');
  expect(ws.exists('/notes.txt')).toBe(true);
  expect(ws.exists('/new.glsl')).toBe(true);
});

it('deletes shader sidecars, regular files and folders while retaining siblings', async () => {
  const ws = await workspace(['/a.glsl', '/a.sha.json', '/b.glsl', '/dir/x.png', '/dir/nested/x.txt', '/dir-sibling/x.txt']);
  expect(deleteWorkspacePath(ws, '/a.glsl')).toEqual(['/a.glsl', '/a.sha.json']);
  expect(deleteWorkspacePath(ws, '/b.glsl')).toEqual(['/b.glsl']);
  expect(deleteWorkspacePath(ws, '/dir')).toHaveLength(2);
  expect(ws.exists('/dir-sibling/x.txt')).toBe(true);
  expect(deleteWorkspacePath(ws, '/dir-sibling/x.txt')).toHaveLength(1);
  expect(() => deleteWorkspacePath(ws, '/missing')).toThrow('no longer exists');
});

it('publishes files, creates, renames and deletes through the transport', async () => {
  const transport = new WebTransport();
  const receive = vi.fn();
  const stop = transport.onWorkspaceFiles(receive);
  try {
    await transport.createWorkspaceFile('/projects/new.txt');
    expect(await transport.readEditorFile('/projects/new.txt')).toBe('');
    await vi.waitFor(() => expect(receive).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ path: '/projects/new.txt' })])));
    expect(receive.mock.lastCall![0].every((file: { path: string }) => !file.path.startsWith('/.shader-studio/'))).toBe(true);
    await transport.renameWorkspacePath('/projects/new.txt', '/projects/renamed.txt');
    expect(await transport.readEditorFile('/projects/new.txt')).toBeNull();
    expect(await transport.readEditorFile('/projects/renamed.txt')).toBe('');
    await transport.deleteWorkspacePath('/projects');
    expect(await transport.readEditorFile('/projects/renamed.txt')).toBeNull();
  } finally {
    stop(); transport.dispose();
  }
});

it('uploads assets next to a nested shader and can upload into the root', async () => {
  const transport = new WebTransport();
  try {
    const assets = await transport.uploadAssets([new File(['image'], 'photo.png')], '/projects/main.glsl');
    expect(assets).toEqual([{ name: 'photo.png', workspacePath: '/projects/photo.png', thumbnailUri: 'data:image/png;base64,aW1hZ2U=', isSameDirectory: true }]);
    expect(await transport.uploadFiles([new File(['source'], 'root.txt')], '/')).toEqual(['/root.txt']);
  } finally {
    transport.dispose();
  }
});

it('cancels subscriptions before initialization and during disposal', async () => {
  const transport = new WebTransport();
  const receive = vi.fn();
  transport.onWorkspaceFiles(receive)();
  await transport.readEditorFile('/shaders/aurora.glsl');
  expect(receive).not.toHaveBeenCalled();
  transport.onWorkspaceFiles(receive);
  transport.dispose();
  await Promise.resolve();
  expect(receive).not.toHaveBeenCalled();
});

it('keeps the active shader selection valid after rename, deletion and an empty workspace', async () => {
  const ws = await workspace(['/main.glsl', '/other.glsl']);
  const host = new WebExtensionHost(ws);
  const receive = vi.fn(); host.onViewerMessage(receive);
  host.refreshWorkspaceSelection(renameWorkspacePath(ws, '/main.glsl', '/renamed.glsl'));
  expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/renamed.glsl' }));
  deleteWorkspacePath(ws, '/renamed.glsl'); host.refreshWorkspaceSelection();
  expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/other.glsl' }));
  deleteWorkspacePath(ws, '/other.glsl'); host.refreshWorkspaceSelection();
  expect(ws.exists('/.shader-studio/active-shader')).toBe(false);
  createWorkspaceFile(ws, '/new.glsl'); host.refreshWorkspaceSelection();
  expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/new.glsl' }));
  host.dispose();
});

it('drops stale resolved image data after deleting a referenced asset', async () => {
  const ws = await workspace(['/main.glsl', '/photo.png']);
  ws.writeText('/main.sha.json', JSON.stringify({ passes: { Image: { inputs: { iChannel0: {
    type: 'texture', path: 'photo.png', resolved_path: 'data:image/png;base64,AA==',
  } } } } }));
  const host = new WebExtensionHost(ws);
  const receive = vi.fn(); host.onViewerMessage(receive);
  deleteWorkspacePath(ws, '/photo.png'); host.refreshWorkspaceSelection();
  expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ pathMap: {}, config: {
    passes: { Image: { inputs: { iChannel0: { type: 'texture', path: 'photo.png' } } } },
  } }));
  host.dispose();
});

it('creates folders, moves and bulk deletes through the transport, and uploads root assets', async () => {
  const transport = new WebTransport();
  try {
    await transport.createWorkspaceFile('/loose.txt');
    await transport.createWorkspaceFolder('/archive');
    await transport.moveWorkspacePaths(['/loose.txt'], '/archive');
    expect(await transport.readEditorFile('/loose.txt')).toBeNull();
    expect(await transport.readEditorFile('/archive/loose.txt')).toBe('');
    await transport.deleteWorkspacePaths(['/archive/loose.txt']);
    expect(await transport.readEditorFile('/archive/loose.txt')).toBeNull();
    const [asset] = await transport.uploadAssets([new File(['image'], 'top.png')], '/root.glsl');
    expect(asset).toMatchObject({ name: 'top.png', workspacePath: '/top.png', isSameDirectory: true });
  } finally {
    transport.dispose();
  }
});
