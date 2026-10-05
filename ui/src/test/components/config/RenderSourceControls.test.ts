import { fireEvent, render } from '@testing-library/svelte';
import { expect, it, vi } from 'vitest';
import RenderSourceControls from '../../../lib/components/config/RenderSourceControls.svelte';

it('offers GLSL vertex Add only for a missing hook, with no function selector', async () => {
  const props = { pass: { vertex: 'mesh.glsl' }, entryPoints: [], stage: 'vertex' as const, language: 'glsl' as const,
    fileType: 'glsl-vertex' as const, sourcePath: 'image.glsl', shaderPath: 'image.glsl', passName: 'Image', isImagePass: true,
    outputCount: 1, onCommit: vi.fn(), postMessage: vi.fn(), passSource: 'void mainVertex() {}', vertexSource: '' };
  const view = render(RenderSourceControls, props);
  expect(view.queryByRole('radio')).toBeNull();
  expect(view.queryByRole('combobox')).toBeNull();
  expect(view.getByRole('button', { name: 'Add function…' })).toBeVisible();
  await view.rerender({ ...props, vertexSource: 'void mainVertex(inout vec3 position) {}' });
  expect(view.queryByRole('button', { name: 'Add function…' })).toBeNull();
  expect(view.container.querySelector('.config-item')).toBeNull();
});

it('shows only the declared native fragment functions when there is no mainImage hook', () => {
  const view = render(RenderSourceControls, { pass: { entryPoints: { fragment: 'shade' } }, entryPoints: [{ name: 'shade', stage: 'fragment' }],
    passSource: '@fragment fn shade() -> @location(0) vec4f { return vec4f(1); }', stage: 'fragment', language: 'wgsl',
    fileType: 'wgsl-buffer', sourcePath: 'a.wgsl', shaderPath: 'image.wgsl', passName: 'BufferA', isImagePass: false,
    outputCount: 1, onCommit: vi.fn() });
  expect(view.queryByRole('radio', { name: 'mainImage' })).toBeNull();
  expect(view.getByRole('radio', { name: '@fragment shade' })).toBeChecked();
});

it('puts a stage-specific Add after each function selector and targets the owning source', async () => {
  const postMessage = vi.fn();
  const view = render(RenderSourceControls, { pass: { path: 'a.wgsl' }, entryPoints: [], language: 'wgsl',
    fileType: 'wgsl-buffer', sourcePath: '/shaders/a.wgsl', shaderPath: '/shaders/image.wgsl', passName: 'BufferA',
    authoringMode: 'native', isImagePass: false, outputCount: 1, onCommit: vi.fn(), postMessage });
  for (const stage of ['vertex', 'fragment']) {
    const row = view.getByRole('group', { name: `${stage === 'vertex' ? 'Vertex' : 'Fragment'} function controls` });
    const add = row.querySelector('button')!;
    expect(add.textContent).toBe('Add function…');
    await fireEvent.click(add);
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ payload: expect.objectContaining({
      fileType: stage === 'vertex' ? 'wgsl-vertex' : 'wgsl-buffer', sourcePath: '/shaders/a.wgsl', authoringMode: 'native',
    }) }));
  }
});
it.each(['wgsl', 'slang'] as const)('reads vertex functions from the selected %s file and adds code there', async language => {
  const postMessage = vi.fn();
  const source = language === 'wgsl' ? '@vertex fn separateVertex() -> @builtin(position) vec4f { return vec4f(0); }'
    : '[shader("vertex")] float4 separateVertex() : SV_Position { return float4(0); }';
  const view = render(RenderSourceControls, { pass: { path: `a.${language}`, vertex: `mesh.${language}` },
    entryPoints: [{ name: 'wrongVertex', stage: 'vertex' }, { name: 'shade', stage: 'fragment' }], vertexSource: source,
    language, fileType: `${language}-buffer`, sourcePath: `a.${language}`, shaderPath: `image.${language}`, passName: 'BufferA',
    authoringMode: 'native', isImagePass: false, outputCount: 1, onCommit: vi.fn(), postMessage });
  const selector = view.getByRole('group', { name: 'Vertex function controls' });
  expect(selector.textContent).toContain('separateVertex');
  expect(selector.textContent).not.toContain('wrongVertex');
  expect(view.getByRole('group', { name: 'Fragment function controls' }).textContent).toContain('shade');
  await fireEvent.click(view.getByRole('group', { name: 'Vertex function controls' }).querySelector('button')!);
  expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ payload: expect.objectContaining({ sourcePath: `mesh.${language}` }) }));
});
