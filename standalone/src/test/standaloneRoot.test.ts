import { expect, it } from 'vitest';
import { MemoryWorkspaceStore, VirtualWorkspace } from '../VirtualWorkspace';
import { migrateStandaloneRoot } from '../standaloneRoot';
import { createDefaultWorkspaceFiles } from '../defaultWorkspace';

it('starts standalone examples at the workspace root', () => {
  const files = createDefaultWorkspaceFiles();
  expect(files.some(file => file.path === '/aurora.glsl')).toBe(true);
  expect(files.some(file => file.path.startsWith('/shaders/'))).toBe(false);
});

it('moves an existing wrapper to root, updates references and persists once', async () => {
  const store = new MemoryWorkspaceStore();
  const workspace = await VirtualWorkspace.open(store, []);
  workspace.writeText('/shaders/main.glsl', '#include "@/shaders/shared.glsl"');
  workspace.writeText('/shaders/main.sha.json', '{"path":"@/shaders/photo.png"}');
  workspace.writeText('/shaders/photo.png', 'data:image/png;base64,AA==');
  workspace.writeText('/notes.txt', 'keep');
  workspace.writeText('/.shader-studio/folders/wrapper', '/shaders');
  workspace.writeText('/.shader-studio/folders/empty', '/shaders/empty');
  workspace.writeText('/.shader-studio/folders/other', '/other');
  await migrateStandaloneRoot(workspace);
  expect(workspace.readText('/main.glsl')).toContain('@/shared.glsl');
  expect(workspace.readText('/main.sha.json')).toContain('@/photo.png');
  expect(workspace.readText('/photo.png')).toBe('data:image/png;base64,AA==');
  expect(workspace.readText('/notes.txt')).toBe('keep');
  expect(workspace.list('/shaders')).toEqual([]);
  expect(workspace.readText('/.shader-studio/folders/%2Fempty')).toBe('/empty');
  const reopened = await VirtualWorkspace.open(store, []);
  await migrateStandaloneRoot(reopened);
  expect(reopened.list()).toEqual(workspace.list());
});

it('does not move files through a root file occupying their parent directory', async () => {
  const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), []);
  workspace.writeText('/assets', 'root file');
  workspace.writeText('/shaders/assets/photo.png', 'old');
  await migrateStandaloneRoot(workspace);
  expect(workspace.readText('/assets')).toBe('root file');
  expect(workspace.readText('/shaders/assets/photo.png')).toBe('old');
});

it('leaves a conflicting wrapper intact and keeps later user-created shaders folders', async () => {
  const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), []);
  workspace.writeText('/shaders/main.glsl', 'old');
  workspace.writeText('/main.glsl', 'new');
  await migrateStandaloneRoot(workspace);
  expect(workspace.readText('/shaders/main.glsl')).toBe('old');
  expect(workspace.readText('/main.glsl')).toBe('new');
  workspace.delete('/main.glsl');
  await migrateStandaloneRoot(workspace);
  expect(workspace.readText('/shaders/main.glsl')).toBe('old');
});
