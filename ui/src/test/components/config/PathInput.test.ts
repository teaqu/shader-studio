import { fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import PathInput from '../../../lib/components/config/PathInput.svelte';

describe('PathInput', () => {
  it('sends the selected mode and the corresponding source destination', async () => {
    const postMessage = vi.fn();
    const view = render(PathInput, { value: '', shaderPath: '/image.wgsl', sourcePath: '/image.wgsl',
      builtInSourcePath: '/buffer.wgsl', fileType: 'wgsl-buffer', allowInsert: true, postMessage });
    await fireEvent.click(view.getByText('Insert'));
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ payload: expect.objectContaining({ authoringMode: 'hooks', sourcePath: '/buffer.wgsl' }) }));
    await fireEvent.change(view.getByRole('combobox', { name: 'Insert mode' }), { target: { value: 'native' } });
    await fireEvent.click(view.getByText('Insert'));
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ payload: expect.objectContaining({ authoringMode: 'native', sourcePath: '/image.wgsl' }) }));
  });
  it('requests insertion into the selected source file', async () => {
    const postMessage = vi.fn();
    const { getByText } = render(PathInput, {
      value: '', shaderPath: '/shader/image.wgsl', sourcePath: '/shader/image.wgsl',
      fileType: 'wgsl-buffer', passName: 'BufferA', authoringMode: 'native',
      allowInsert: true, postMessage,
    });

    await fireEvent.click(getByText('Insert'));

    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'insertShaderSource',
      payload: expect.objectContaining({
        shaderPath: '/shader/image.wgsl', sourcePath: '/shader/image.wgsl',
        fileType: 'wgsl-buffer', passName: 'BufferA', authoringMode: 'native',
      }),
    }));
  });

  it('only applies a successful creation response', async () => {
    let onMessage: ((event: MessageEvent) => void) | undefined;
    const onPathChange = vi.fn();
    const onCreated = vi.fn();
    const postMessage = vi.fn();
    const { getByText, getByRole } = render(PathInput, {
      value: '', shaderPath: '/shader/image.wgsl', suggestedPath: 'buffer.wgsl',
      fileType: 'wgsl-buffer', postMessage, onMessage: (handler) => {
        onMessage = handler;
      },
      onPathChange, onCreated,
    });

    await tick();
    await fireEvent.click(getByText('Create'));
    const requestId = postMessage.mock.calls[0][0].payload.requestId;
    onMessage?.({ data: { type: 'fileSelected', payload: { requestId, path: '', error: 'Failed' } } } as MessageEvent);
    await tick();

    expect(onPathChange).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
    expect(getByRole('alert')).toHaveTextContent('Failed');

    await fireEvent.click(getByText('Create'));
    expect(() => getByRole('alert')).toThrow();
  });
});
