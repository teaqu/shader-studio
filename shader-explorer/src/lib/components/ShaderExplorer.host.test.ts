import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { expect, it, vi } from 'vitest';
import ShaderExplorer from './ShaderExplorer.svelte';

vi.mock('./ShaderPreview.svelte', () => ({ default: () => '' }));

it('hides buffers by default and saves and restores the visibility option', async () => {
  let receive: ((event: MessageEvent) => void) | undefined;
  let savedState: Record<string, unknown> = {};
  const hostApi = {
    onMessage(handler: (event: MessageEvent) => void) {
      receive = handler;
      return () => { receive = undefined; };
    },
    postMessage(message: { type: string; state?: Record<string, unknown> }) {
      if (message.type === 'saveState') savedState = message.state ?? {};
      if (message.type === 'requestShaders') {
        receive?.(new MessageEvent('message', { data: {
          type: 'shadersUpdate', savedState,
          shaders: ['image.glsl', 'trails.buffer.glsl'].map(name => ({
            name, path: `/${name}`, relativePath: name, hasConfig: false,
          })),
        } }));
      }
    },
  };
  const first = render(ShaderExplorer, { props: { hostApi } });
  await first.findByTestId('shader-option-image-glsl');
  expect(first.queryByTestId('shader-option-trails-buffer-glsl')).toBeNull();
  await fireEvent.click(first.getByTitle('Options'));
  expect(first.getByLabelText('Hide Buffers')).toBeChecked();
  await fireEvent.click(first.getByLabelText('Hide Buffers'));
  await first.findByTestId('shader-option-trails-buffer-glsl');
  await waitFor(() => expect(savedState.hideBufferShaders).toBe(false));
  first.unmount();

  const restored = render(ShaderExplorer, { props: { hostApi } });
  await restored.findByTestId('shader-option-trails-buffer-glsl');
  expect(restored.getByLabelText('Hide Buffers')).not.toBeChecked();
  await fireEvent.click(restored.getByLabelText('Hide Buffers'));
  await waitFor(() => expect(restored.queryByTestId('shader-option-trails-buffer-glsl')).toBeNull());
  restored.unmount();
});

it('subscribes before requesting the initial shader list and unsubscribes on unmount', async () => {
  let receive: ((event: MessageEvent) => void) | undefined;
  const unsubscribe = vi.fn();
  const hostApi = {
    onMessage: vi.fn((handler: (event: MessageEvent) => void) => {
      receive = handler;
      return unsubscribe;
    }),
    postMessage: vi.fn((message: { type: string }) => {
      if (message.type === 'requestShaders') {
        receive?.(new MessageEvent('message', { data: {
          type: 'shadersUpdate',
          shaders: [{ name: 'ocean.glsl', path: '/ocean.glsl', relativePath: 'ocean.glsl', hasConfig: false }],
        } }));
      }
    }),
  };
  const { findByTestId, unmount } = render(ShaderExplorer, { props: { hostApi } });
  await findByTestId('shader-option-ocean-glsl');
  unmount();
  expect(unsubscribe).toHaveBeenCalledOnce();
});
