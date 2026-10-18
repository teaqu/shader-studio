import { afterEach, expect, it, vi } from 'vitest';
import { WebTransport } from '../WebTransport';
import { WebExtensionHost } from '../WebExtensionHost';
import { MemoryWorkspaceStore, VirtualWorkspace } from '../VirtualWorkspace';
import { uploadWorkspaceFiles } from '../workspaceUploads';
afterEach(() => vi.restoreAllMocks());

it('rejects uploads that would occupy folder or internal metadata paths', async () => {
  const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), []);
  workspace.writeText('/folder/child.glsl', 'source');
  await expect(uploadWorkspaceFiles(workspace, [new File(['x'], 'folder')])).rejects.toThrow('already exists');
  await expect(uploadWorkspaceFiles(workspace, [new File(['x'], '.shader-studio')], '/')).rejects.toThrow('inside the workspace');
  workspace.writeText('/not-a-folder', 'source');
  await expect(uploadWorkspaceFiles(workspace, [new File(['x'], 'file.png')], '/not-a-folder/child')).rejects.toThrow('parent folder');
});

it('persists source text and exact binary bytes across workspace reopen and backup restore', async () => {
  const store = new MemoryWorkspaceStore();
  const workspace = await VirtualWorkspace.open(store, []);
  await uploadWorkspaceFiles(workspace, [new File(['// λ shader'], 'unicode.wgsl'), new File([new Uint8Array([0, 128, 255])], 'data.ktx2')]);
  const reopened = await VirtualWorkspace.open(store, []);
  expect(reopened.readText('/unicode.wgsl')).toBe('// λ shader');
  expect(reopened.readText('/data.ktx2')).toBe('data:application/octet-stream;base64,AID/');
  const restored = await VirtualWorkspace.open(new MemoryWorkspaceStore(), []);
  await restored.importBackup(workspace.exportBackup());
  expect(restored.list()).toEqual(workspace.list());
});

it('accepts an empty selection without writing', async () => {
  const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), []);
  const write = vi.spyOn(workspace, 'writeText');
  await uploadWorkspaceFiles(workspace, []);
  expect(write).not.toHaveBeenCalled();
});

it('preserves browser media types for extensions outside the MIME fallback table', async () => {
  const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), []);
  await uploadWorkspaceFiles(workspace, [new File(['audio'], 'sample.opus', { type: 'audio/ogg' })]);
  expect(workspace.readText('/sample.opus')).toBe('data:audio/ogg;base64,YXVkaW8=');
});

it.each(['', '.', '..', '../escape.glsl', 'folder/file.glsl', 'folder\\file.glsl', 'bad\u0000.glsl'])('rejects invalid name %j before adding any files', async name => {
  const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), []);
  const file = new File(['x'], 'original');
  Object.defineProperty(file, 'name', { value: name });
  await expect(uploadWorkspaceFiles(workspace, [file])).rejects.toThrow('valid names');
  expect(workspace.list()).toEqual([]);
});

it.each([true, false])('rejects collisions without overwriting existing files (existing: %s)', async existing => {
  const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), []);
  if (existing) {
    workspace.writeText('/a.glsl', 'original');
  }
  const before = workspace.list();
  await expect(uploadWorkspaceFiles(workspace, [new File(['one'], 'b.glsl'), new File(['two'], 'a.glsl'),
    ...existing ? [] : [new File(['three'], 'a.glsl')]])).rejects.toThrow('already exists');
  expect(workspace.list()).toEqual(before);
});

it.each(['error', 'abort'] as const)('adds nothing when a file read ends in %s', async event => {
  const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), []);
  vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (this: FileReader) {
    this.dispatchEvent(new ProgressEvent(event));
  });
  await expect(uploadWorkspaceFiles(workspace, [new File(['source'], 'a.glsl')])).rejects.toThrow(event === 'error' ? 'Could not read' : 'cancelled');
  expect(workspace.list()).toEqual([]);
});

it('rechecks filenames after asynchronous reads', async () => {
  const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), []);
  const read = FileReader.prototype.readAsText;
  vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (this: FileReader, file) {
    workspace.writeText('/a.glsl', 'concurrent edit');
    read.call(this, file);
  });
  await expect(uploadWorkspaceFiles(workspace, [new File(['upload'], 'a.glsl')])).rejects.toThrow('now in use');
  expect(workspace.readText('/a.glsl')).toBe('concurrent edit');
});

it('reports storage failures while retaining the uploaded file for recovery', async () => {
  const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), []);
  vi.spyOn(workspace, 'flush').mockRejectedValue(new Error('Storage is full'));
  await expect(uploadWorkspaceFiles(workspace, [new File(['source'], 'a.glsl')])).rejects.toThrow('Storage is full');
  expect(workspace.readText('/a.glsl')).toBe('source');
});

it('lists uploaded assets with usable previews and directory-aware paths', async () => {
  const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), []);
  await uploadWorkspaceFiles(workspace, [new File(['bytes'], 'PHOTO.PNG'), new File(['x'], 'song.mp3')]);
  const host = new WebExtensionHost(workspace);
  const receive = vi.fn();
  host.onViewerMessage(receive);
  await host.handleViewerMessage({ type: 'requestWorkspaceFiles', payload: { extensions: ['png'], shaderPath: '/main.glsl' } });
  expect(receive).toHaveBeenLastCalledWith({ type: 'workspaceFiles', payload: { files: [{
    name: 'PHOTO.PNG', workspacePath: '/PHOTO.PNG', thumbnailUri: 'data:image/png;base64,Ynl0ZXM=', isSameDirectory: true,
  }] } });
  await host.handleViewerMessage({ type: 'requestWorkspaceFiles', payload: { extensions: ['mp3'], shaderPath: '/other/main.glsl' } });
  expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ payload: { files: [expect.objectContaining({ isSameDirectory: false })] } }));
  host.dispose();
});

it('uploads sources, configs and binary assets without replacing the workspace', async () => {
  const transport = new WebTransport();
  try {
    await transport.uploadFiles([
      new File(['void mainImage(out vec4 c, vec2 p) { c = vec4(1.0); }'], 'uploaded.glsl'),
      new File(['{"passes":{}}'], 'uploaded.sha.json'),
      new File([new Uint8Array([0, 128, 255])], 'photo.png'),
    ]);
    expect(await transport.readEditorFile('/uploaded.glsl')).toContain('mainImage');
    expect(await transport.readEditorFile('/aurora.glsl')).toContain('mainImage');
    const backup = await transport.exportWorkspaceBackup();
    expect(backup).toContain('data:image/png;base64,AID/');
    expect(backup).toContain('uploaded.sha.json');
  } finally {
    transport.dispose();
  }
});

it('resolves uploaded assets relative to the shader and through workspace-root paths', async () => {
  const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), [
    { path: '/custom.glsl', contents: 'void mainImage() {}', createdAt: 1, modifiedAt: 1 },
    { path: '/custom.sha.json', contents: JSON.stringify({ passes: { Image: { inputs: {
      relative: { type: 'texture', path: 'photo.png' }, root: { type: 'texture', path: '@/photo.png' },
    } } } }), createdAt: 1, modifiedAt: 1 },
    { path: '/photo.png', contents: 'data:image/png;base64,AID/', createdAt: 1, modifiedAt: 1 },
  ]);
  const host = new WebExtensionHost(workspace);
  const receive = vi.fn();
  host.onViewerMessage(receive);
  await host.start();
  expect(receive).toHaveBeenCalledWith(expect.objectContaining({ type: 'shaderSource', pathMap: {
    'photo.png': 'data:image/png;base64,AID/', '@/photo.png': 'data:image/png;base64,AID/',
  } }));
  host.dispose();
});
