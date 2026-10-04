import { fireEvent, render } from '@testing-library/svelte';
import { expect, it, vi } from 'vitest';
import RenderSourceControls from '../../../lib/components/config/RenderSourceControls.svelte';

it('puts a stage-specific Add after each function selector and targets the owning source', async () => {
  const postMessage = vi.fn();
  const view = render(RenderSourceControls, { pass: { path: 'a.wgsl' }, entryPoints: [], language: 'wgsl',
    fileType: 'wgsl-buffer', sourcePath: '/shaders/a.wgsl', shaderPath: '/shaders/image.wgsl', passName: 'BufferA',
    authoringMode: 'native', isImagePass: false, outputCount: 1, onCommit: vi.fn(), postMessage });
  for (const stage of ['vertex', 'fragment']) {
    const row = view.getByRole('group', { name: `${stage === 'vertex' ? 'Vertex' : 'Fragment'} function controls` });
    const add = row.querySelector('button')!;
    expect(add.textContent).toBe('Add');
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
  const selector = view.getByLabelText('Vertex function', { exact: true });
  expect(selector.textContent).toContain('separateVertex');
  expect(selector.textContent).not.toContain('wrongVertex');
  expect(view.getByLabelText('Fragment function', { exact: true }).textContent).toContain('shade');
  await fireEvent.click(view.getByRole('group', { name: 'Vertex function controls' }).querySelector('button')!);
  expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ payload: expect.objectContaining({ sourcePath: `mesh.${language}` }) }));
});
