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
  await fireEvent.change(view.getByLabelText('Shader file'), { target: { value: 'a.wgsl' } });
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
it.each(['glsl', 'wgsl', 'slang'] as const)('hides same-file vertex paths and file actions for %s while keeping code actions', language => {
  const path = `/shaders/image.${language}`;
  const view = render(BufferConfig, { bufferName: 'Image', isImagePass: true, language, shaderPath: path,
    config: { vertex: path, geometry: { type: 'cube' } }, onUpdate: vi.fn(), getWebviewUri: () => undefined, postMessage: vi.fn() });
  const vertex = view.container.querySelector('.vertex-shader-title')!.parentElement!;
  expect(view.getByLabelText('Vertex source')).toHaveValue('same');
  expect(vertex.querySelector('.config-input')).toBeNull();
  expect(vertex.querySelector('.select-file-btn')?.textContent).toBe('Clear');
  expect(vertex.querySelector('.create-file-btn')).toBeNull();
  expect(vertex.querySelector('.insert-file-btn')).not.toBeNull();
});
it('uses one Shader file chooser and reveals custom paths on demand', async () => {
  const view = render(BufferConfig, { bufferName: 'BufferA', language: 'wgsl', shaderPath: '/shaders/image.wgsl',
    config: { path: 'a.wgsl' }, projectConfig: { version: '1.0', passes: { Image: {}, BufferA: { path: 'a.wgsl' } } },
    onUpdate: vi.fn(), getWebviewUri: () => undefined, postMessage: vi.fn() });
  const source = view.getByLabelText('Shader file');
  expect(source).toHaveValue('a.wgsl');
  const main = view.container.querySelector('.buffer-details > .config-item:first-child')!;
  expect(main.querySelector('.config-input')).toBeNull();
  expect(view.queryByLabelText('Use file from config')).toBeNull();
  await fireEvent.change(source, { target: { value: 'custom' } });
  expect(main.querySelector('.config-input')).not.toBeNull();
  expect(main.querySelector('.select-file-btn')?.textContent).toBe('Browse');
});
