import { fireEvent, render } from '@testing-library/svelte';
import { expect, it, vi } from 'vitest';
import ShaderFileControls from '../../../lib/components/config/ShaderFileControls.svelte';

it('shows a file summary and opens the selected shader without editing its path', async () => {
  const onOpen = vi.fn();
  const view = render(ShaderFileControls, { value: './shaders/a.wgsl', shaderPath: '/image.wgsl', language: 'wgsl',
    fileType: 'wgsl-buffer', suggestedPath: 'b.wgsl', inputId: 'source', summary: true, onOpen,
    onPathChange: vi.fn(), onCreated: vi.fn() });
  expect(view.getByText('a.wgsl')).toBeVisible();
  expect(view.getByText('./shaders/a.wgsl')).toBeVisible();
  expect(view.queryByRole('textbox')).toBeNull();
  await fireEvent.click(view.getByRole('button', { name: 'Open in editor' }));
  expect(onOpen).toHaveBeenCalledOnce();
  await fireEvent.click(view.getByRole('button', { name: 'Choose another file…' }));
  expect(view.getByRole('dialog', { name: 'Choose shader file' })).toBeVisible();
});

it('offers choosing and creating an empty buffer while disabling Open in editor', async () => {
  const postMessage = vi.fn();
  const view = render(ShaderFileControls, { value: '', shaderPath: '/image.wgsl', language: 'wgsl',
    fileType: 'wgsl-buffer', suggestedPath: 'a.wgsl', inputId: 'source', summary: true,
    onPathChange: vi.fn(), onCreated: vi.fn(), onOpen: vi.fn(), postMessage });
  expect(view.getByText('No shader file selected')).toBeVisible();
  expect(view.getByRole('button', { name: 'Open in editor' })).toBeDisabled();
  await fireEvent.click(view.getByRole('button', { name: 'Create shader…' }));
  expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'createFile' }));
  await fireEvent.click(view.getByRole('button', { name: 'Choose file…' }));
  expect(view.getByRole('dialog')).toBeVisible();
});

it('keeps the editor accessible when the config has validation errors', async () => {
  const onOpen = vi.fn();
  const view = render(ShaderFileControls, { value: 'missing.wgsl', hasError: true, summary: true,
    shaderPath: '/image.wgsl', language: 'wgsl', fileType: 'wgsl-buffer', suggestedPath: 'a.wgsl',
    inputId: 'source', onPathChange: vi.fn(), onCreated: vi.fn(), onOpen, postMessage: vi.fn() });
  await fireEvent.click(view.getByRole('button', { name: 'Open in editor' }));
  expect(onOpen).toHaveBeenCalledOnce();
  await fireEvent.click(view.getByRole('button', { name: 'Choose another file…' }));
  expect(view.getByRole('dialog')).toBeVisible();
});

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
