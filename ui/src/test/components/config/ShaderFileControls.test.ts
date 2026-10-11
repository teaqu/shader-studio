import { fireEvent, render } from '@testing-library/svelte';
import { expect, it, vi } from 'vitest';
import ShaderFileControls from '../../../lib/components/config/ShaderFileControls.svelte';

it('shows a compact file picker and opens the selected shader without editing its path', async () => {
  const onOpen = vi.fn();
  const view = render(ShaderFileControls, { value: './shaders/a.wgsl', shaderPath: '/image.wgsl', language: 'wgsl',
    fileType: 'wgsl-buffer', suggestedPath: 'b.wgsl', inputId: 'source', summary: true, onOpen,
    onPathChange: vi.fn(), onCreated: vi.fn() });
  expect(view.getByText('Shader file', { exact: true })).toBeVisible();
  expect(view.getByText('a.wgsl')).toBeVisible();
  expect(view.getByText('./shaders/')).toBeVisible();
  expect(view.queryByText('./shaders/a.wgsl')).toBeNull();
  expect(view.queryByRole('textbox')).toBeNull();
  await fireEvent.click(view.getByRole('button', { name: 'Open editor' }));
  expect(onOpen).toHaveBeenCalledOnce();
  await fireEvent.click(view.getByRole('button', { name: 'Choose shader file' }));
  expect(view.getByRole('dialog', { name: 'Choose shader file' })).toBeVisible();
});

it('offers choosing and creating an empty buffer while disabling Open editor', async () => {
  const postMessage = vi.fn();
  const view = render(ShaderFileControls, { value: '', shaderPath: '/image.wgsl', language: 'wgsl',
    fileType: 'wgsl-buffer', suggestedPath: 'a.wgsl', inputId: 'source', summary: true,
    onPathChange: vi.fn(), onCreated: vi.fn(), onOpen: vi.fn(), postMessage });
  expect(view.getByText('Choose file…')).toBeVisible();
  expect(view.getByRole('button', { name: 'Open editor' })).toBeDisabled();
  await fireEvent.click(view.getByRole('button', { name: 'Create file…' }));
  expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'createFile' }));
  await fireEvent.click(view.getByRole('button', { name: 'Choose shader file' }));
  expect(view.getByRole('dialog')).toBeVisible();
});

it('keeps the editor accessible when the config has validation errors', async () => {
  const onOpen = vi.fn();
  const view = render(ShaderFileControls, { value: 'missing.wgsl', hasError: true, summary: true,
    shaderPath: '/image.wgsl', language: 'wgsl', fileType: 'wgsl-buffer', suggestedPath: 'a.wgsl',
    inputId: 'source', onPathChange: vi.fn(), onCreated: vi.fn(), onOpen, postMessage: vi.fn() });
  await fireEvent.click(view.getByRole('button', { name: 'Open editor' }));
  expect(onOpen).toHaveBeenCalledOnce();
  await fireEvent.click(view.getByRole('button', { name: 'Choose shader file' }));
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

it.each([
  ['shader.wgsl', null],
  ['@/effects/shader.wgsl', '@/effects/'],
  ['C:\\shaders\\shader.wgsl', 'C:\\shaders\\'],
])('shows the filename once and separates its folder for %s', (value, folder) => {
  const view = render(ShaderFileControls, { value, summary: true, shaderPath: '/image.wgsl', language: 'wgsl',
    fileType: 'wgsl-buffer', suggestedPath: 'b.wgsl', inputId: 'source', onPathChange: vi.fn(), onCreated: vi.fn() });
  expect(view.getAllByText('shader.wgsl')).toHaveLength(1);
  expect(view.getByRole('button', { name: 'Choose shader file' })).toHaveAttribute('title', value);
  expect(view.getByRole('button', { name: 'Open editor' })).toBeDisabled();
  if (folder) {
    expect(view.getByText(folder)).toBeVisible();
  } else {
    expect(view.container.querySelector('.file-location')).toBeNull();
  }
});

it('toggles the inline picker and dismisses with Escape or an outside click without changing the path', async () => {
  const onPathChange = vi.fn();
  const view = render(ShaderFileControls, { value: 'a.wgsl', summary: true, shaderPath: '/image.wgsl', language: 'wgsl',
    fileType: 'wgsl-buffer', suggestedPath: 'b.wgsl', inputId: 'source', onPathChange, onCreated: vi.fn() });
  const picker = view.getByRole('button', { name: 'Choose shader file' });
  expect(picker).toHaveAttribute('aria-expanded', 'false');
  await fireEvent.click(picker);
  expect(picker).toHaveAttribute('aria-expanded', 'true');
  expect(view.getByRole('button', { name: '/image.wgsl' })).toHaveFocus();
  await fireEvent.pointerDown(view.getByRole('dialog'));
  expect(view.getByRole('dialog')).toBeVisible();
  await fireEvent.keyDown(window, { key: 'Escape' });
  expect(view.queryByRole('dialog')).toBeNull();
  expect(picker).toHaveFocus();
  await fireEvent.click(picker);
  await fireEvent.click(picker);
  expect(view.queryByRole('dialog')).toBeNull();
  await fireEvent.click(picker);
  await fireEvent.pointerDown(document.body);
  expect(view.queryByRole('dialog')).toBeNull();
  expect(onPathChange).not.toHaveBeenCalled();
});

it('selects the full path when two config files share a filename', async () => {
  const onPathChange = vi.fn();
  const view = render(ShaderFileControls, { value: 'one/buffer.wgsl', summary: true, shaderPath: '/image.wgsl', language: 'wgsl',
    fileType: 'wgsl-buffer', suggestedPath: 'b.wgsl', inputId: 'source', onPathChange, onCreated: vi.fn(),
    projectConfig: { version: '1.0', passes: { Image: {}, BufferA: { path: 'one/buffer.wgsl' }, BufferB: { path: 'two/buffer.wgsl' } } } });
  const picker = view.getByRole('button', { name: 'Choose shader file' });
  await fireEvent.click(picker);
  await fireEvent.click(view.getByRole('button', { name: 'two/buffer.wgsl' }));
  expect(onPathChange).toHaveBeenCalledWith('two/buffer.wgsl');
  expect(view.queryByRole('dialog')).toBeNull();
  expect(picker).toHaveFocus();
});

it('keeps manual path entry available behind its disclosure', async () => {
  const onPathChange = vi.fn();
  const view = render(ShaderFileControls, { value: 'missing.wgsl', hasError: true, summary: true,
    shaderPath: '/image.wgsl', language: 'wgsl', fileType: 'wgsl-buffer', suggestedPath: 'a.wgsl',
    inputId: 'source', onPathChange, onCreated: vi.fn() });
  await fireEvent.click(view.getByRole('button', { name: 'Choose shader file' }));
  expect(view.getByLabelText('Shader file path')).not.toBeVisible();
  await fireEvent.click(view.getByText('Enter a path…'));
  const input = view.getByRole('textbox', { name: 'Shader file path' });
  expect(input).toBeVisible();
  expect(input).toHaveClass('error');
  await fireEvent.input(input, { target: { value: '@/shaders/fixed.wgsl' } });
  expect(onPathChange).toHaveBeenLastCalledWith('@/shaders/fixed.wgsl');
});

it.each(['Browse workspace…', 'Create file…'])('handles cancellation, errors, and a successful %s response in the picker', async action => {
  const postMessage = vi.fn();
  const onCreated = vi.fn();
  let handler: (event: MessageEvent) => void;
  const view = render(ShaderFileControls, { value: 'old.wgsl', summary: true,
    shaderPath: '/image.wgsl', language: 'wgsl', fileType: 'wgsl-buffer', suggestedPath: 'a.wgsl',
    inputId: 'source', onPathChange: vi.fn(), onCreated, postMessage, onMessage: callback => {
      handler = callback;
    } });
  await fireEvent.click(view.getByRole('button', { name: 'Choose shader file' }));
  for (const result of [{ path: '' }, { path: '', error: 'Unable to access file' }]) {
    await fireEvent.click(view.getByRole('button', { name: action }));
    const requestId = postMessage.mock.calls.at(-1)![0].payload.requestId;
    handler!(new MessageEvent('message', { data: { type: 'fileSelected', payload: { requestId, ...result } } }));
    await fireEvent.keyDown(window, { key: 'Enter' });
    expect(view.getByRole('dialog')).toBeVisible();
    expect(onCreated).not.toHaveBeenCalled();
  }
  expect(view.getByRole('alert')).toHaveTextContent('Unable to access file');
  await fireEvent.click(view.getByRole('button', { name: action }));
  expect(view.queryByRole('alert')).toBeNull();
  const request = postMessage.mock.calls.at(-1)![0];
  expect(request.type).toBe(action === 'Browse workspace…' ? 'selectFile' : 'createFile');
  handler!(new MessageEvent('message', { data: { type: 'fileSelected', payload: { requestId: request.payload.requestId, path: 'new.wgsl' } } }));
  await fireEvent.keyDown(window, { key: 'Enter' });
  expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ path: 'new.wgsl' }));
  expect(view.queryByRole('dialog')).toBeNull();
});
