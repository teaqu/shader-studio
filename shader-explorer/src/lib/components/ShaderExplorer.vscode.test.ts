import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import ShaderExplorer from './ShaderExplorer.svelte';

vi.stubGlobal('ResizeObserver', class {
  observe() {} unobserve() {} disconnect() {}
});

vi.mock('./ShaderPreview.svelte', () => ({ default: () => '' }));

const shaders = ['alpha.glsl', 'beta.glsl'].map(name => ({ name, path: `/${name}`, relativePath: name, hasConfig: false }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('ResizeObserver', class {
    observe() {} unobserve() {} disconnect() {}
  });
});

function vscodeHost() {
  const postMessage = vi.fn();
  vi.stubGlobal('acquireVsCodeApi', () => ({ postMessage }));
  const send = (data: unknown) => window.dispatchEvent(new MessageEvent('message', { data }));
  return { postMessage, send };
}

it('refreshes, resets to VS Code defaults, and closes settings only on Escape', async () => {
  const { postMessage, send } = vscodeHost();
  const view = render(ShaderExplorer, { props: { compact: true } });
  expect(view.container.querySelector('[data-testid="web-shader-explorer"]')).toBeNull();
  send({ type: 'shadersUpdate', shaders, savedState: { keepActiveShaderFiles: true, layoutMode: 'row' } });
  await view.findByTestId('shader-option-alpha-glsl');

  await fireEvent.click(view.getByTitle('Refresh'));
  expect(postMessage).toHaveBeenCalledWith({ type: 'requestShaders', skipCache: true });

  await fireEvent.click(view.getByTitle('Options'));
  expect(view.getByText('One file group per preview.')).toBeTruthy();
  await fireEvent.keyDown(window, { key: 'a' });
  expect(view.getByText('Explorer settings')).toBeTruthy();
  await fireEvent.click(view.getByTitle('Descending'));
  expect(view.getByTitle('Ascending').textContent).toBe('↑');

  await fireEvent.click(view.getByText('Reset to defaults'));
  expect((view.getByLabelText('Only keep active shader files open') as HTMLInputElement).checked).toBe(false);
  expect(view.getByRole('button', { name: 'List' }).getAttribute('aria-pressed')).toBe('true');
  await fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(view.queryByText('Explorer settings')).toBeNull());
  await fireEvent.keyDown(window, { key: 'Escape' });
  view.unmount();
});

it('resets a full-size explorer to the grid layout with a card size control', async () => {
  const { send } = vscodeHost();
  const view = render(ShaderExplorer);
  send({ type: 'shadersUpdate', shaders, savedState: { layoutMode: 'row' } });
  await view.findByTestId('shader-option-alpha-glsl');
  await fireEvent.click(view.getByTitle('Options'));
  expect(view.queryByLabelText('Card size')).toBeNull();
  await fireEvent.click(view.getByText('Reset to defaults'));
  expect(view.getByRole('button', { name: 'Grid' }).getAttribute('aria-pressed')).toBe('true');
  expect(view.getByLabelText('Card size')).toBeTruthy();
  view.unmount();
});

it('applies only the current text search results from the host', async () => {
  const { postMessage, send } = vscodeHost();
  const view = render(ShaderExplorer, { props: { compact: true } });
  send({ type: 'shadersUpdate', shaders, savedState: null });
  await view.findByTestId('shader-option-alpha-glsl');
  await fireEvent.input(view.getByPlaceholderText('Search shaders...'), { target: { value: 'uniform' } });
  await waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'searchShaders', query: 'uniform' })));
  const searches = postMessage.mock.calls.map(([message]) => message as { type: string; requestId: number }).filter(message => message.type === 'searchShaders');
  const { requestId } = searches[searches.length - 1];
  send({ type: 'shaderSearchResults', query: 'uniform', requestId: requestId + 1, paths: [] });
  send({ type: 'shaderSearchResults', query: 'uniform', requestId, paths: ['/beta.glsl'] });
  await waitFor(() => expect(view.queryByTestId('shader-option-alpha-glsl')).toBeNull());
  expect(view.getByTestId('shader-option-beta-glsl')).toBeTruthy();
  send({ type: 'shaderSearchResults', query: 'uniform', requestId, paths: 'invalid' });
  await waitFor(() => expect(view.queryByTestId('shader-option-beta-glsl')).toBeNull());
  view.unmount();
});
