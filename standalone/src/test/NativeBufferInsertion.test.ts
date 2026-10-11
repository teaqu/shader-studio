import { expect, it, vi } from 'vitest';
import { insertShaderSource } from '../insertShaderSource';
import { MemoryWorkspaceStore, VirtualWorkspace } from '../VirtualWorkspace';

it.each(['wgsl', 'slang'])('inserts native code into a configured new %s buffer file', async language => {
  const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), []);
  const path = `/shaders/new-buffer.${language}`;
  const emit = vi.fn();
  insertShaderSource(workspace, `/shaders/image.${language}`, {
    sourcePath: path, fileType: `${language}-buffer`, authoringMode: 'native', passName: 'BufferA', requestId: 'insert',
  }, emit, vi.fn());
  expect(workspace.readText(path)).toContain('BufferAFragment');
  expect(emit).toHaveBeenCalledWith({ type: 'fileSelected', payload: {
    path, requestId: 'insert', authoringMode: 'native', entryPoints: { fragment: 'BufferAFragment' },
  } });
});
