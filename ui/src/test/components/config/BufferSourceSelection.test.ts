import { fireEvent, render } from '@testing-library/svelte';
import { expect, it, vi } from 'vitest';
import BufferConfig from '../../../lib/components/config/BufferConfig.svelte';
it('keeps output format with resolution', () => {
  const view = render(BufferConfig, { bufferName: 'BufferA', config: { path: 'a.wgsl', geometry: { type: 'cube' } }, language: 'wgsl', onUpdate: vi.fn(), getWebviewUri: () => undefined });
  expect(view.container.querySelector('.resolution-section')!.contains(view.getByLabelText('Output format'))).toBe(true);
});
it('offers existing config files instead of buffer insertion', async () => {
  const onUpdate = vi.fn(); const postMessage = vi.fn();
  const view = render(BufferConfig, { bufferName: 'BufferB', config: { path: '' }, language: 'wgsl', shaderPath: '/shaders/image.wgsl', projectConfig: { version: '1.0', passes: { Image: {}, BufferA: { path: 'a.wgsl' } } }, onUpdate, postMessage, getWebviewUri: () => undefined });
  expect(view.container.querySelector('.buffer-details > .config-item:first-child .insert-file-btn')).toBeNull();
  await fireEvent.change(view.getByLabelText('Use file from config'), { target: { value: 'a.wgsl' } });
  expect(onUpdate).toHaveBeenCalledWith('BufferB', expect.objectContaining({ path: 'a.wgsl' }));
  expect(postMessage).not.toHaveBeenCalled();
});
it('defaults vertex source to Built-in and reveals paths only for Custom file', async () => {
  const view = render(BufferConfig, { bufferName:'Image', isImagePass:true, config:{geometry:{type:'cube'}}, language:'wgsl', shaderPath:'/shaders/image.wgsl', onUpdate:vi.fn(), getWebviewUri:()=>undefined, postMessage:vi.fn() });
  const select=view.getByLabelText('Vertex source');
  expect(select).toHaveValue('builtin');
  const vertex=view.container.querySelector('.vertex-shader-title')!.parentElement!;
  expect(vertex.querySelector('.config-input')).toBeNull();
  await fireEvent.change(select,{target:{value:'custom'}});
  expect(vertex.querySelector('.config-input')).not.toBeNull();
});
it('selects the same vertex source or a reused file and returns to Built-in without touching fragment settings', async () => {
  const onUpdate=vi.fn();
  const view=render(BufferConfig,{bufferName:'Image',isImagePass:true,language:'wgsl',shaderPath:'/shaders/image.wgsl',config:{entryPoints:{fragment:'shade'},geometry:{type:'cube'}},projectConfig:{version:'1.0',passes:{Image:{},BufferA:{path:'mesh.wgsl'}}},onUpdate,getWebviewUri:()=>undefined});
  const source=view.getByLabelText('Vertex source');
  await fireEvent.change(source,{target:{value:'same'}});
  expect(onUpdate).toHaveBeenLastCalledWith('Image',expect.objectContaining({vertex:'/shaders/image.wgsl',entryPoints:{fragment:'shade'}}));
  await fireEvent.change(source,{target:{value:'mesh.wgsl'}});
  expect(onUpdate).toHaveBeenLastCalledWith('Image',expect.objectContaining({vertex:'mesh.wgsl'}));
  await fireEvent.change(source,{target:{value:'builtin'}});
  expect(onUpdate).toHaveBeenLastCalledWith('Image',expect.objectContaining({entryPoints:{fragment:'shade'}}));
  expect(onUpdate.mock.calls.at(-1)![1]).not.toHaveProperty('vertex');
});
