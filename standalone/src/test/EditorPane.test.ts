import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import ShaderEditorStub from './ShaderEditorStub.svelte';

vi.mock('@shader-studio/ui', async () => {
  const { getViewerSession } = await import('@shader-studio/ui/lib/state/viewerSession.svelte');
  return { getViewerSession, ShaderEditor: ShaderEditorStub };
});

import { clearEditorDocuments } from '../state/editorDocuments.svelte';
import type { WebTransport } from '../WebTransport';
import { getRequestedEditor, resetShellState } from '../state/shellState.svelte';
import EditorPane from '../EditorPane.svelte';
import { setViewerSession } from '@shader-studio/ui/lib/state/viewerSession.svelte';
import type { ViewerSession } from '@shader-studio/ui';

function createSession(overrides: Partial<ViewerSession> = {}): ViewerSession {
  return {
    ready: true,
    shaderCode: 'initial source',
    shaderPath: '/shaders/image.glsl',
    selectedShaderPath: '/shaders/image.glsl',
    transport: {
      postMessage: vi.fn(),
      onMessage: vi.fn(),
      dispose: vi.fn(),
      getType: () => 'web',
      isConnected: () => true,
    },
    config: null,
    customUniformInfo: [],
    slangModules: [],
    compileMode: 'hot',
    bufferNames: ['Image', 'Buffer B'],
    activeBufferName: 'Image',
    errors: ['first error'],
    onCodeChange: vi.fn(),
    onBufferSwitch: vi.fn(),
    onCursorChange: vi.fn(),
    ...overrides,
  };
}

describe('EditorPane', () => {
  beforeEach(() => {
    setViewerSession(null);
  });

  it('does not mount an editor until the viewer session is ready', () => {
    const { queryByTestId, getByRole } = render(EditorPane);

    expect(queryByTestId('shader-editor')).toBeNull();
    expect(getByRole('toolbar', { name: 'Editor options' })).toBeTruthy();
    expect(getByRole('button', { name: 'Enable Vim mode' }).hasAttribute('disabled')).toBe(true);
  });

  it('passes the current editing state to the shared editor and delegates its commands', async () => {
    const session = createSession();
    setViewerSession(session);
    const { getByTestId, getByRole } = render(EditorPane);

    const editor = getByTestId('shader-editor');
    expect(editor.getAttribute('data-code')).toBe('initial source');
    expect(editor.getAttribute('data-path')).toBe('/shaders/image.glsl');
    expect(editor.getAttribute('data-errors')).toBe('first error');
    expect(editor.getAttribute('data-buffer')).toBe('Image');

    await getByRole('button', { name: 'Edit' }).click();
    await getByRole('button', { name: 'Switch buffer' }).click();

    expect(session.onCodeChange).toHaveBeenCalledWith('edited source');
    expect(session.onBufferSwitch).toHaveBeenCalledWith('Buffer B');
  });

  it('reacts to a replacement session and hides when the viewer disposes', async () => {
    const { getByTestId, queryByTestId } = render(EditorPane);
    setViewerSession(createSession({ shaderCode: 'first', errors: ['one'] }));
    await tick();

    setViewerSession(createSession({
      shaderCode: 'second',
      activeBufferName: 'Buffer B',
      errors: ['two', 'three'],
    }));
    await tick();

    expect(getByTestId('shader-editor').getAttribute('data-code')).toBe('second');
    expect(getByTestId('shader-editor').getAttribute('data-errors')).toBe('two|three');
    expect(getByTestId('shader-editor').getAttribute('data-buffer')).toBe('Buffer B');

    setViewerSession(null);
    await tick();
    expect(queryByTestId('shader-editor')).toBeNull();
  });

  it('keeps Vim mode local to the standalone pane', async () => {
    setViewerSession(createSession());
    const { getByRole, getByTestId } = render(EditorPane);

    const toggle = getByRole('button', { name: 'Enable Vim mode' });
    expect(getByRole('toolbar', { name: 'Editor options' }).contains(toggle)).toBe(true);
    expect(getByTestId('shader-editor').getAttribute('data-vim')).toBe('false');

    await toggle.click();

    expect(getByRole('button', { name: 'Disable Vim mode' }).getAttribute('aria-pressed')).toBe('true');
    expect(getByTestId('shader-editor').getAttribute('data-vim')).toBe('true');

    await toggle.click();

    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(getByTestId('shader-editor').getAttribute('data-vim')).toBe('false');
  });
});


describe('file-specific editors', () => {
  beforeEach(clearEditorDocuments);
  it('loads its own file and stays on it when the preview changes', async () => {
    const transport = { readEditorFile: vi.fn().mockResolvedValue('buffer source') } as unknown as WebTransport;
    const { getByTestId } = render(EditorPane, { path: '/buffer.glsl', transport });
    await vi.waitFor(() => expect(getByTestId('shader-editor').getAttribute('data-code')).toBe('buffer source'));
    setViewerSession(createSession({ shaderCode: 'other source' }));
    await tick();
    expect(getByTestId('shader-editor').getAttribute('data-path')).toBe('/buffer.glsl');
    expect(getByTestId('shader-editor').getAttribute('data-code')).toBe('buffer source');
  });

  it.each([null, new Error('unavailable')])('reports missing or unreadable files', async (result) => {
    const readEditorFile = result instanceof Error ? vi.fn().mockRejectedValue(result) : vi.fn().mockResolvedValue(result);
    const { getByRole, queryByTestId } = render(EditorPane, {
      path: '/missing.glsl', transport: { readEditorFile } as unknown as WebTransport,
    });
    await vi.waitFor(() => expect(getByRole('alert')).toBeTruthy());
    expect(queryByTestId('shader-editor')).toBeNull();
  });

  it('opens the current buffer in a separate editor', async () => {
    resetShellState();
    setViewerSession(createSession({ shaderPath: '/buffer.glsl', activeBufferName: 'Buffer A' }));
    const { getByRole } = render(EditorPane);
    await getByRole('button', { name: 'Open in separate editor' }).click();
    expect(getRequestedEditor()).toBe('/buffer.glsl');
    resetShellState();
  });
});

it('synchronizes source changes between file panes', async () => {
  const { setEditorDocument } = await import('../state/editorDocuments.svelte');
  clearEditorDocuments();
  const transport = { readEditorFile: vi.fn().mockResolvedValue('first') } as unknown as WebTransport;
  const { getByTestId } = render(EditorPane, { path: '/shared.glsl', transport });
  await vi.waitFor(() => expect(getByTestId('shader-editor').getAttribute('data-code')).toBe('first'));
  setEditorDocument('/shared.glsl', 'updated');
  await tick();
  expect(getByTestId('shader-editor').getAttribute('data-code')).toBe('updated');
  clearEditorDocuments();
});
