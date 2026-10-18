import { expect, it, vi } from 'vitest';
import { WebExtensionHost } from '../WebExtensionHost';
import { MemoryWorkspaceStore, VirtualWorkspace } from '../VirtualWorkspace';
it('Select offers existing matching workspace files and returns the chosen path', async () => {
  const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), [{path:'/a.wgsl',contents:'',createdAt:1,modifiedAt:1},{path:'/b.slang',contents:'',createdAt:1,modifiedAt:1}]);
  const selectFile=vi.fn().mockResolvedValue('/a.wgsl');
  const host=new WebExtensionHost(workspace,{selectFile}); const receive=vi.fn(); host.onViewerMessage(receive);
  await host.handleViewerMessage({type:'selectFile',payload:{fileType:'wgsl-buffer',requestId:'select'}});
  expect(selectFile).toHaveBeenCalledWith(['/a.wgsl']);
  expect(receive).toHaveBeenCalledWith({type:'fileSelected',payload:{path:'/a.wgsl',requestId:'select'}});
});
import { selectWorkspaceFile } from '../selectWorkspaceFile';
it.each([null, '/missing.wgsl', '/b.slang'])('returns cancellation without attaching invalid selection %s', async chosen => {
  const workspace=await VirtualWorkspace.open(new MemoryWorkspaceStore(),[{path:'/a.wgsl',contents:'',createdAt:1,modifiedAt:1}]);
  const emit=vi.fn();
  await selectWorkspaceFile(workspace,{fileType:'wgsl-vertex',requestId:'cancel'},async()=>chosen,emit);
  expect(emit).toHaveBeenCalledWith({type:'fileSelected',payload:{path:'',requestId:'cancel'}});
});
it('supports GLSL aliases and empty workspace',async()=>{
  const workspace=await VirtualWorkspace.open(new MemoryWorkspaceStore(),[{path:'/a.vert',contents:'',createdAt:1,modifiedAt:1}]);
  const choose=vi.fn().mockResolvedValue(null);
  await selectWorkspaceFile(workspace,{fileType:'glsl-vertex'},choose,vi.fn());
  expect(choose).toHaveBeenCalledWith(['/a.vert']);
  await selectWorkspaceFile(workspace,{fileType:'slang-buffer'},choose,vi.fn());
  expect(choose).toHaveBeenLastCalledWith([]);
});
import { selectableWorkspaceFile } from '../selectWorkspaceFile';
it.each([['model','/models/a.glb'],['script','/scripts/a.ts'],['texture','/images/a.png'],['audio','/audio/a.mp3'],['video','/video/a.mp4'],['cubemap','/images/a.png']])('supports %s file selection', (type,path) => {
  expect(selectableWorkspaceFile(path,type)).toBe(true);
  expect(selectableWorkspaceFile('/a.wgsl',type)).toBe(false);
});

it('volume selection accepts KTX2 case-insensitively and excludes internal BIN files', () => {
  expect(selectableWorkspaceFile('/assets/noise.KTX2', 'volume')).toBe(true);
  expect(selectableWorkspaceFile('/assets/noise.bin', 'volume')).toBe(false);
  expect(selectableWorkspaceFile('/assets/noise.png', 'volume')).toBe(false);
});
