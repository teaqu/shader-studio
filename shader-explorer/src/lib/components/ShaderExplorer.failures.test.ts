import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { expect, it, vi } from 'vitest';
import ShaderExplorer from './ShaderExplorer.svelte';

vi.mock('./ShaderPreview.svelte', async () => import('../../test/FailingShaderPreviewStub.svelte'));

const shaderEntry = (name: string, thumbnailVersion: number) => ({
  name, path: `/${name}`, relativePath: name, hasConfig: false, thumbnailVersion,
});

it('gives a hidden failed shader another chance when its files change', async () => {
  let receive: ((event: MessageEvent) => void) | undefined;
  const push = (shaders: ReturnType<typeof shaderEntry>[]) => {
    receive?.(new MessageEvent('message', { data: { type: 'shadersUpdate', shaders } }));
  };
  const hostApi = {
    onMessage(handler: (event: MessageEvent) => void) {
      receive = handler;
      return () => {
        receive = undefined;
      };
    },
    postMessage(message: { type: string }) {
      if (message.type === 'requestShaders') {
        push([shaderEntry('broken.glsl', 1), shaderEntry('ok.glsl', 3)]);
      }
    },
  };

  const view = render(ShaderExplorer, { props: { hostApi } });
  await view.findByTestId('shader-option-ok-glsl');
  await fireEvent.click(view.getByTitle('Options'));
  await fireEvent.click(view.getByLabelText('Hide Failed'));
  await waitFor(() => expect(view.queryByTestId('shader-option-broken-glsl')).toBeNull());

  // Same version resent: still failed, still hidden.
  push([shaderEntry('broken.glsl', 1), shaderEntry('ok.glsl', 3)]);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(view.queryByTestId('shader-option-broken-glsl')).toBeNull();

  push([shaderEntry('broken.glsl', 2), shaderEntry('ok.glsl', 3)]);
  await view.findByTestId('shader-option-broken-glsl');
  view.unmount();
});
