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
