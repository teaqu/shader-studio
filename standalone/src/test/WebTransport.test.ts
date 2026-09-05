import { getEditorDocument } from '../state/editorDocuments.svelte';
import { getSelectedEditor, getRequestedEditor, getNewShaderVisible, getRequestedPanel, resetShellState, setNewShaderVisible } from '../state/shellState.svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultWorkspaceFiles } from '../defaultWorkspace';
import { WebTransport } from '../WebTransport';

async function eventually(assertion: () => void): Promise<void> {
  await vi.waitFor(assertion);
}

describe('WebTransport', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetShellState();
  });

  it('identifies itself as the web host transport', () => {
    const transport = new WebTransport();
    expect(transport.getType()).toBe('web');
    expect(transport.getShaderExplorerHostApi()).toBeDefined();
    transport.dispose();
  });

  it('delivers the seeded workspace shader to the viewer', async () => {
    const transport = new WebTransport();
    const handler = vi.fn();
    transport.onMessage(handler);

    await eventually(() => expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'shaderSource', path: '/shaders/aurora.glsl' }),
    })));
    transport.dispose();
  });

  it('routes explorer activation through the same host to the viewer', async () => {
    const transport = new WebTransport();
    const viewer = vi.fn();
    transport.onMessage(viewer);
    const explorer = transport.getShaderExplorerHostApi();
    const explorerReceive = vi.fn();
    explorer.onMessage(explorerReceive);
    explorer.postMessage({ type: 'requestShaders' });

    await eventually(() => expect(explorerReceive).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'shadersUpdate' }),
    })));
    explorer.postMessage({ type: 'activateShader', path: '/shaders/aurora-slang.slang' });
    await eventually(() => expect(viewer).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'shaderSource', path: '/shaders/aurora-slang.slang' }),
    })));
    transport.dispose();
  });

  it('routes new shader requests to the standalone shell', async () => {
    const transport = new WebTransport();
    const viewer = vi.fn();
    transport.onMessage(viewer);
    const explorer = transport.getShaderExplorerHostApi();

    transport.postMessage({ type: 'extensionCommand', payload: { command: 'newShader' } });
    await eventually(() => expect(getNewShaderVisible()).toBe(true));
    setNewShaderVisible(false);
    explorer.postMessage({ type: 'newShader' });
    await eventually(() => expect(getNewShaderVisible()).toBe(true));

    transport.postMessage({ type: 'createShader', payload: { name: 'new-slang', language: 'slang' } });
    await eventually(() => expect(viewer).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'shaderSource', path: '/shaders/new-slang.slang', language: 'slang' }),
    })));
    expect(viewer.mock.calls.filter(([event]) => event.data.type === 'showNewShaderModal')).toHaveLength(0);
    transport.dispose();
  });

  it('routes viewer explorer commands to the outer layout only while connected', () => {
    const transport = new WebTransport();
    transport.postMessage({ type: 'extensionCommand', payload: { command: 'openShaderExplorer' } });
    expect(getRequestedPanel()).toBe('explorer');
    resetShellState();
    transport.dispose();
    transport.postMessage({ type: 'extensionCommand', payload: { command: 'openShaderExplorer' } });
    expect(getRequestedPanel()).toBeNull();
    expect(getSelectedEditor()).toBeNull();
  });

  it('stops delivering messages after disposal', async () => {
    const transport = new WebTransport();
    const handler = vi.fn();
    transport.onMessage(handler);
    transport.dispose();
    await Promise.resolve();
    await Promise.resolve();
    expect(handler).not.toHaveBeenCalled();
    expect(transport.isConnected()).toBe(false);
  });
});


it('requests active editor reuse for explorer opens and ignores missing paths', async () => {
  resetShellState();
  const transport = new WebTransport();
  const explorer = transport.getShaderExplorerHostApi();
  explorer.postMessage({ type: 'openShader', path: '/shaders/aurora.glsl' });
  await vi.waitFor(() => expect(getSelectedEditor()).toBe('/shaders/aurora.glsl'));
  expect(getRequestedEditor()).toBeNull();
  expect(await transport.readEditorFile('/shaders/aurora.glsl')).toContain('mainImage');
  resetShellState();
  explorer.postMessage({ type: 'openShader', path: '/missing.glsl' });
  expect(await transport.readEditorFile('/missing.glsl')).toBeNull();
  expect(getRequestedPanel()).toBeNull();
  expect(getSelectedEditor()).toBeNull();
  expect(getRequestedEditor()).toBeNull();
  transport.dispose();
});


it('activates the preview without requesting any editor when Open Files is unchecked', async () => {
  resetShellState();
  const transport = new WebTransport();
  const viewer = vi.fn();
  transport.onMessage(viewer);
  transport.getShaderExplorerHostApi().postMessage({ type: 'activateShader', path: '/shaders/aurora.glsl' });
  await vi.waitFor(() => expect(viewer).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ type: 'shaderSource', path: '/shaders/aurora.glsl' }),
  })));
  expect(getRequestedPanel()).toBeNull();
  expect(getSelectedEditor()).toBeNull();
  expect(getRequestedEditor()).toBeNull();
  transport.dispose();
});


it.each(['active', 'beside'] as const)('opens requested buffer in standalone with %s navigation', async (mode) => {
  resetShellState();
  const transport = new WebTransport();
  transport.postMessage({ type: 'navigateToBuffer', payload: {
    bufferPath: '/shaders/glow-trails/trails.buffer.glsl', shaderPath: '/shaders/glow-trails.glsl', mode,
  } });
  await vi.waitFor(() => expect(getRequestedEditor()).toBe('/shaders/glow-trails/trails.buffer.glsl'));
  expect(getEditorDocument('/shaders/glow-trails/trails.buffer.glsl')).toContain('mainImage');
  transport.dispose();
});

it('ignores missing navigation targets and navigation after disposal', async () => {
  resetShellState();
  const transport = new WebTransport();
  transport.postMessage({ type: 'navigateToBuffer', payload: { bufferPath: '/missing.glsl' } });
  await transport.readEditorFile('/missing.glsl');
  expect(getRequestedEditor()).toBeNull();
  transport.dispose();
  transport.postMessage({ type: 'navigateToBuffer', payload: { bufferPath: '/shaders/aurora.glsl' } });
  await Promise.resolve();
  expect(getRequestedEditor()).toBeNull();
});


it.each([undefined, null, {}, { bufferPath: 42 }, { bufferPath: '' }])('ignores invalid navigation payload %j', async (payload) => {
  resetShellState();
  const transport = new WebTransport();
  transport.postMessage({ type: 'navigateToBuffer', payload });
  await transport.readEditorFile('/shaders/aurora.glsl');
  expect(getRequestedEditor()).toBeNull();
  transport.dispose();
});

it('does not open files when disposed before queued navigation runs', async () => {
  resetShellState();
  const transport = new WebTransport();
  transport.postMessage({ type: 'navigateToBuffer', payload: { bufferPath: '/shaders/aurora.glsl' } });
  transport.dispose();
  await transport.readEditorFile('/shaders/aurora.glsl');
  expect(getRequestedEditor()).toBeNull();
});


it('opens an empty file', async () => {
  resetShellState();
  const transport = new WebTransport();
  transport.postMessage({ type: 'updateShaderSource', payload: { path: '/shaders/aurora.glsl', code: '' } });
  transport.postMessage({ type: 'navigateToBuffer', payload: { bufferPath: '/shaders/aurora.glsl' } });
  await vi.waitFor(() => expect(getRequestedEditor()).toBe('/shaders/aurora.glsl'));
  expect(getEditorDocument('/shaders/aurora.glsl')).toBe('');
  transport.dispose();
});
