import { fireEvent, render } from '@testing-library/svelte';
import { expect, it, vi } from 'vitest';
import ShaderFileControls from '../../../lib/components/config/ShaderFileControls.svelte';

it('closes the chooser with Close or Escape without changing the file', async () => {
  const onPathChange = vi.fn();
  const view = render(ShaderFileControls, { value: 'a.wgsl', shaderPath: '/image.wgsl', language: 'wgsl',
    fileType: 'wgsl-buffer', suggestedPath: 'b.wgsl', inputId: 'source', onPathChange, onCreated: vi.fn() });
  await fireEvent.click(view.getByRole('button', { name: 'Change…' }));
  await fireEvent.click(view.getByRole('button', { name: 'Close file chooser' }));
  expect(view.queryByRole('dialog')).toBeNull();
  await fireEvent.click(view.getByRole('button', { name: 'Change…' }));
  await fireEvent.keyDown(window, { key: 'Enter' });
  expect(view.getByRole('dialog')).toBeVisible();
  await fireEvent.keyDown(window, { key: 'Escape' });
  expect(view.queryByRole('dialog')).toBeNull();
  expect(onPathChange).not.toHaveBeenCalled();
});

it.each(['wgsl-buffer', 'wgsl-compute'] as const)('creates the chosen %s source and closes only on success', async fileType => {
  const postMessage = vi.fn();
  const onCreated = vi.fn();
  let handler: ((event: MessageEvent) => void) | undefined;
  const view = render(ShaderFileControls, { value: '', shaderPath: '/image.wgsl', language: 'wgsl',
    fileType, suggestedPath: 'a.wgsl', inputId: 'source', onPathChange: vi.fn(), onCreated,
    postMessage, onMessage: callback => {
      handler = callback;
    } });
  await fireEvent.click(view.getByRole('button', { name: 'Change…' }));
  await fireEvent.click(view.getByRole('button', { name: 'Create' }));
  const requestId = postMessage.mock.calls.at(-1)![0].payload.requestId;
  expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({
    suggestedPath: 'a.wgsl', authoringMode: fileType === 'wgsl-compute' ? 'native' : 'hooks',
  }) }));
  handler!(new MessageEvent('message', { data: { type: 'fileSelected', payload: { requestId, path: 'a.wgsl' } } }));
  await fireEvent.keyDown(window, { key: 'Enter' });
  expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ path: 'a.wgsl' }));
  expect(view.queryByRole('dialog')).toBeNull();
});
