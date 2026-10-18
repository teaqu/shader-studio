import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { expect, it, vi } from 'vitest';
import ShaderExplorer from './ShaderExplorer.svelte';

vi.stubGlobal('ResizeObserver', class {
  observe() {} unobserve() {} disconnect() {}
});

vi.mock('./ShaderPreview.svelte', () => ({ default: () => '' }));

it.each([false, true])('uses the host default (%s) and persists the active-file setting', async (hostDefault) => {
  let receive: ((event: MessageEvent) => void) | undefined;
  let savedState: Record<string, unknown> = {};
  const hostApi = {
    defaultKeepActiveShaderFiles: hostDefault,
    onMessage(handler: (event: MessageEvent) => void) {
      receive = handler;
      return () => {};
    },
    postMessage(message: { type: string; state?: Record<string, unknown> }) {
      if (message.type === 'saveState') {
        savedState = message.state ?? {};
      }
      if (message.type === 'requestShaders') {
        receive?.(new MessageEvent('message', { data: { type: 'shadersUpdate', savedState, shaders: [] } }));
      }
    },
  };
  const first = render(ShaderExplorer, { hostApi });
  await fireEvent.click(first.getByTitle('Options'));
  const option = first.getByLabelText('Only keep active shader files open');
  expect((option as HTMLInputElement).checked).toBe(hostDefault);
  await fireEvent.click(option);
  await waitFor(() => expect(savedState.keepActiveShaderFiles).toBe(!hostDefault));
  first.unmount();
  const next = render(ShaderExplorer, { hostApi });
  await waitFor(() => expect((next.getByLabelText('Only keep active shader files open') as HTMLInputElement).checked).toBe(!hostDefault));
  next.unmount();
});

it('hides buffers by default and saves and restores the visibility option', async () => {
  let receive: ((event: MessageEvent) => void) | undefined;
  let savedState: Record<string, unknown> = {};
  const hostApi = {
    onMessage(handler: (event: MessageEvent) => void) {
      receive = handler;
      return () => {
        receive = undefined;
      };
    },
    postMessage(message: { type: string; state?: Record<string, unknown> }) {
      if (message.type === 'saveState') {
        savedState = message.state ?? {};
      }
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
  expect(first.getByLabelText('Hide buffer files')).toBeChecked();
  await fireEvent.click(first.getByLabelText('Hide buffer files'));
  await first.findByTestId('shader-option-trails-buffer-glsl');
  await waitFor(() => expect(savedState.hideBufferShaders).toBe(false));
  first.unmount();

  const restored = render(ShaderExplorer, { props: { hostApi } });
  await restored.findByTestId('shader-option-trails-buffer-glsl');
  expect(restored.getByLabelText('Hide buffer files')).not.toBeChecked();
  await fireEvent.click(restored.getByLabelText('Hide buffer files'));
  await waitFor(() => expect(restored.queryByTestId('shader-option-trails-buffer-glsl')).toBeNull());
  restored.unmount();
});

it('hides vertex filenames by default and saves and restores the visibility option', async () => {
  let receive: ((event: MessageEvent) => void) | undefined;
  let savedState: Record<string, unknown> = {};
  const hostApi = {
    onMessage(handler: (event: MessageEvent) => void) {
      receive = handler;
      return () => {
        receive = undefined;
      };
    },
    postMessage(message: { type: string; state?: Record<string, unknown> }) {
      if (message.type === 'saveState') {
        savedState = message.state ?? {};
      }
      if (message.type === 'requestShaders') {
        receive?.(new MessageEvent('message', { data: {
          type: 'shadersUpdate', savedState,
          shaders: ['image.glsl', 'mesh.vert.glsl'].map(name => ({
            name, path: `/${name}`, relativePath: name, hasConfig: false,
          })),
        } }));
      }
    },
  };
  const first = render(ShaderExplorer, { props: { hostApi } });
  await first.findByTestId('shader-option-image-glsl');
  expect(first.queryByTestId('shader-option-mesh-vert-glsl')).toBeNull();
  await fireEvent.click(first.getByTitle('Options'));
  expect(first.getByLabelText('Hide vertex files')).toBeChecked();
  await fireEvent.click(first.getByLabelText('Hide vertex files'));
  await first.findByTestId('shader-option-mesh-vert-glsl');
  await waitFor(() => expect(savedState.hideVertexShaders).toBe(false));
  first.unmount();

  const restored = render(ShaderExplorer, { props: { hostApi } });
  await restored.findByTestId('shader-option-mesh-vert-glsl');
  expect(restored.getByLabelText('Hide vertex files')).not.toBeChecked();
  await fireEvent.click(restored.getByLabelText('Hide vertex files'));
  await waitFor(() => expect(restored.queryByTestId('shader-option-mesh-vert-glsl')).toBeNull());
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

it('mentions WGSL in the empty-state message when no shaders are found', async () => {
  let receive: ((event: MessageEvent) => void) | undefined;
  const hostApi = {
    onMessage(handler: (event: MessageEvent) => void) {
      receive = handler;
      return () => {
        receive = undefined;
      };
    },
    postMessage: vi.fn((message: { type: string }) => {
      if (message.type === 'requestShaders') {
        receive?.(new MessageEvent('message', { data: {
          type: 'shadersUpdate',
          shaders: [],
        } }));
      }
    }),
  };
  const { findByText, unmount } = render(ShaderExplorer, { props: { hostApi } });
  await findByText('No GLSL, Slang, or WGSL shaders found in the workspace.');
  unmount();
});

function pushingHost(initialShaders: Record<string, unknown>[]) {
  let receive: ((event: MessageEvent) => void) | undefined;
  return {
    hostApi: {
      onMessage(handler: (event: MessageEvent) => void) {
        receive = handler;
        return () => {
          receive = undefined;
        };
      },
      postMessage(message: { type: string }) {
        if (message.type === 'requestShaders') {
          receive?.(new MessageEvent('message', { data: { type: 'shadersUpdate', shaders: initialShaders } }));
        }
      },
    },
    push(shaders: Record<string, unknown>[]) {
      receive?.(new MessageEvent('message', { data: { type: 'shadersUpdate', shaders } }));
    },
  };
}

const shaderEntry = (name: string, thumbnailVersion?: number) => ({
  name, path: `/${name}`, relativePath: name, hasConfig: false, thumbnailVersion,
});

it('shows shaders the host pushes after a file is created', async () => {
  const host = pushingHost([shaderEntry('ocean.glsl', 1)]);
  const { findByTestId, getByText, unmount } = render(ShaderExplorer, { props: { hostApi: host.hostApi } });
  await findByTestId('shader-option-ocean-glsl');

  host.push([shaderEntry('ocean.glsl', 1), shaderEntry('forest.glsl', 5)]);

  await findByTestId('shader-option-forest-glsl');
  expect(getByText('2 shaders')).toBeTruthy();
  unmount();
});


it('groups settings, hides redundant file controls and dismisses with Escape or outside pointer', async () => {
  const host = pushingHost([]);
  const view = render(ShaderExplorer, { hostApi: host.hostApi });
  const gear = view.getByRole('button', { name: 'Explorer settings' });
  await fireEvent.click(gear);
  expect(gear).toHaveAttribute('aria-expanded', 'true');
  expect(view.getByRole('group', { name: 'Filters' })).toBeTruthy();
  expect(view.getByLabelText('Open file when selecting a shader')).toBeTruthy();
  await fireEvent.click(view.getByLabelText('Only keep active shader files open'));
  expect(view.queryByLabelText('Open file when selecting a shader')).toBeNull();
  await fireEvent.click(view.getByRole('button', { name: 'List', exact: true }));
  expect(view.queryByLabelText('Card size')).toBeNull();
  await fireEvent.click(view.getByRole('button', { name: 'Grid', exact: true }));
  expect(view.getByLabelText('Card size')).toBeTruthy();
  await fireEvent.keyDown(window, { key: 'Escape' });
  expect(gear).toHaveFocus();
  expect(gear).toHaveAttribute('aria-expanded', 'false');
  await fireEvent.click(gear);
  await fireEvent.pointerDown(view.getByLabelText('Only keep active shader files open'));
  expect(gear).toHaveAttribute('aria-expanded', 'true');
  await fireEvent.pointerDown(document.body);
  expect(gear).toHaveAttribute('aria-expanded', 'false');
  await fireEvent.click(gear);
  await fireEvent.click(view.getByRole('button', { name: 'Close Explorer settings' }));
  expect(gear).toHaveFocus();
  view.unmount();
});

it.each([false, true])('resets all settings to host defaults (%s) and persists them', async (hostDefault) => {
  const host = pushingHost([]);
  const post = vi.spyOn(host.hostApi, 'postMessage');
  const view = render(ShaderExplorer, { hostApi: { ...host.hostApi, defaultKeepActiveShaderFiles: hostDefault }, compact: true });
  await fireEvent.click(view.getByTitle('Options'));
  await fireEvent.click(view.getByLabelText('Hide buffer files'));
  await fireEvent.click(view.getByLabelText('Hide vertex files'));
  await fireEvent.click(view.getByLabelText('Hide failed previews'));
  await fireEvent.click(view.getByLabelText('Only keep active shader files open'));
  await fireEvent.click(view.getByRole('button', { name: 'Grid', exact: true }));
  await fireEvent.input(view.getByLabelText('Card size'), { target: { value: '400' } });
  await fireEvent.change(view.getByLabelText('Per page'), { target: { value: '50' } });
  await fireEvent.click(view.getByRole('button', { name: 'Reset to defaults' }));
  await waitFor(() => expect(post).toHaveBeenLastCalledWith({ type: 'saveState', state: {
    sortBy: 'updated', sortOrder: 'desc', pageSize: 20, cardSize: 200,
    hideFailedShaders: false, hideBufferShaders: true, hideVertexShaders: true,
    openFilesOnSelect: true, keepActiveShaderFiles: hostDefault, layoutMode: 'row', showOptions: true,
  } }));
  view.unmount();
});
