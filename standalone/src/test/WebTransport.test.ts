import { getEditorDocument } from '../state/editorDocuments.svelte';
import { getActiveShaderEditors, getSelectedEditor, getRequestedEditor, getNewShaderVisible, getRequestedPanel, resetShellState, setNewShaderVisible } from '../state/shellState.svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultWorkspaceFiles } from '../defaultWorkspace';
import { VirtualWorkspace } from '../VirtualWorkspace';
import { WebExtensionHost } from '../WebExtensionHost';
import { createWorkspace, inspectWorkspaceStorage, WebTransport } from '../WebTransport';

async function eventually(assertion: () => void): Promise<void> {
  await vi.waitFor(assertion);
}

describe('WebTransport', () => {
  it('defaults active files on, tracks two previews, and persists opting out', async () => {
    const transport = new WebTransport();
    const first = transport.createViewerTransport(), second = transport.createViewerTransport();
    first.postMessage({ type: 'previewFilesChanged', payload: { shaderPath: '/aurora.glsl' } });
    second.postMessage({ type: 'previewFilesChanged', payload: { shaderPath: '/glow-trails.glsl' } });
    await transport.flush();
    expect(getActiveShaderEditors()).toHaveLength(2);
    expect(getActiveShaderEditors()?.[1].files.length).toBeGreaterThan(1);
    first.dispose();
    expect(getActiveShaderEditors()).toHaveLength(1);
    transport.getShaderExplorerHostApi().postMessage({ type: 'saveState', state: { keepActiveShaderFiles: false } });
    expect(getActiveShaderEditors()).toBeNull();
    second.dispose();
    transport.dispose();
  });

  it('prompts only for unsaved edits, saving on acceptance and retaining on cancellation', async () => {
    const transport = new WebTransport();
    const path = '/aurora.glsl';
    await transport.readEditorFile(path);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(await transport.confirmEditorClose(path)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    transport.markEditorDirty(path);
    expect(await transport.confirmEditorClose(path)).toBe(false);
    let pending = true;
    const detach = transport.registerPendingSave(() => {
      if (pending) {
        pending = false;
        transport.postMessage({ type: 'updateShaderSource', payload: { path, code: 'saved changes' } });
      }
    });
    confirm.mockReturnValue(true);
    expect(await transport.confirmEditorClose(path)).toBe(true);
    expect(await transport.readEditorFile(path)).toBe('saved changes');
    confirm.mockClear();
    expect(await transport.confirmEditorClose(path)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    detach();
    transport.dispose();
  });

  it('keeps the editor open and reports a failed save', async () => {
    const transport = new WebTransport();
    await transport.readEditorFile('/aurora.glsl');
    transport.markEditorDirty('/aurora.glsl');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(transport, 'flush').mockRejectedValue(new Error('disk full'));
    expect(await transport.confirmEditorClose('/aurora.glsl')).toBe(false);
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('kept open'));
    transport.dispose();
  });
  beforeEach(() => {
    vi.restoreAllMocks();
    resetShellState();
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    });
  });

  it('keeps the workspace connected when a viewer is disposed and restores its replacement', async () => {
    const transport = new WebTransport();
    const oldViewer = transport.createViewerTransport();
    const oldReceive = vi.fn();
    oldViewer.onMessage(oldReceive);
    await eventually(() => expect(oldReceive).toHaveBeenCalled());
    oldViewer.dispose();
    expect(oldViewer.isConnected()).toBe(false);
    expect(transport.isConnected()).toBe(true);
    oldReceive.mockClear();
    const replacement = transport.createViewerTransport();
    const receive = vi.fn();
    replacement.onMessage(receive);
    replacement.postMessage({ type: 'refresh' });
    await eventually(() => expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'shaderSource' }),
    })));
    expect(oldReceive).not.toHaveBeenCalled();
    transport.dispose();
    expect(replacement.isConnected()).toBe(false);
  });

  it('does not attach a disposed viewer while the workspace is opening', async () => {
    const transport = new WebTransport();
    const viewer = transport.createViewerTransport();
    const receive = vi.fn();
    viewer.onMessage(receive);
    viewer.dispose();
    viewer.onMessage(receive);
    viewer.postMessage({ type: 'refresh' });
    await transport.readEditorFile('/aurora.glsl');
    expect(receive).not.toHaveBeenCalled();
    expect(transport.isConnected()).toBe(true);
    transport.dispose();
  });

  it('persists explorer preferences before queued workspace saves can finish', async () => {
    const transport = new WebTransport();
    const explorer = transport.getShaderExplorerHostApi();
    explorer.postMessage({ type: 'saveState', state: { hideBufferShaders: false, showOptions: true } });
    // Reload can interrupt asynchronous workspace IO immediately after a click.
    expect(JSON.parse(localStorage.getItem('shader-studio-explorer-state') ?? 'null'))
      .toEqual({ hideBufferShaders: false, showOptions: true });
    transport.dispose();
    const reloaded = new WebTransport();
    const receive = vi.fn();
    reloaded.getShaderExplorerHostApi().onMessage(receive);
    reloaded.getShaderExplorerHostApi().postMessage({ type: 'requestShaders' });
    await eventually(() => expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ savedState: { hideBufferShaders: false, showOptions: true } }),
    })));
    reloaded.dispose();
  });

  it.each(['{broken', 'null', '42', '[]'])('falls back to workspace preferences for invalid local state %s', async saved => {
    localStorage.setItem('shader-studio-explorer-state', saved);
    const transport = new WebTransport();
    const receive = vi.fn();
    const explorer = transport.getShaderExplorerHostApi();
    explorer.onMessage(receive);
    explorer.postMessage({ type: 'requestShaders' });
    await eventually(() => expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ savedState: null }),
    })));
    transport.dispose();
  });

  it('uses the workspace fallback when browser preference storage is unavailable', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('Storage blocked');
      },
      setItem: () => {
        throw new Error('Quota exceeded');
      },
    });
    const transport = new WebTransport();
    const receive = vi.fn();
    const explorer = transport.getShaderExplorerHostApi();
    explorer.onMessage(receive);
    expect(() => explorer.postMessage({ type: 'saveState', state: { hideBufferShaders: false } })).not.toThrow();
    explorer.postMessage({ type: 'requestShaders' });
    await eventually(() => expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ savedState: { hideBufferShaders: false } }),
    })));
    transport.dispose();
  });

  it('does not persist explorer messages after disposal', () => {
    const transport = new WebTransport();
    const explorer = transport.getShaderExplorerHostApi();
    transport.dispose();
    explorer.postMessage({ type: 'saveState', state: { hideBufferShaders: false } });
    expect(localStorage.getItem('shader-studio-explorer-state')).toBeNull();
  });

  it('identifies itself as the web host transport', () => {
    const transport = new WebTransport();
    expect(transport.getType()).toBe('web');
    expect(transport.getShaderExplorerHostApi()).toBeDefined();
    transport.dispose();
  });

  it('flushes pending editor text through the host before reporting persistence complete', async () => {
    const transport = new WebTransport();
    const path = '/aurora.glsl';
    let pending = true;
    const detach = transport.registerPendingSave(() => {
      if (pending) {
        pending = false;
        transport.postMessage({ type: 'updateShaderSource', payload: { path, code: 'latest text' } });
      }
    });
    await transport.flush();
    expect(await transport.readEditorFile(path)).toBe('latest text');
    detach(); detach();
    await transport.flush();
    transport.dispose();
  });

  it('waits for an editor save that arrives while workspace persistence is in progress', async () => {
    const transport = new WebTransport();
    await transport.readEditorFile('/aurora.glsl');
    const originalFlush = VirtualWorkspace.prototype.flush;
    let releaseFirstFlush!: () => void;
    let firstFlushStarted!: () => void;
    const firstFlush = new Promise<void>(resolve => {
      releaseFirstFlush = resolve;
    });
    const flushStarted = new Promise<void>(resolve => {
      firstFlushStarted = resolve;
    });
    let calls = 0;
    vi.spyOn(VirtualWorkspace.prototype, 'flush').mockImplementation(function(this: VirtualWorkspace) {
      calls += 1;
      if (calls === 1) {
        firstFlushStarted();
        return firstFlush;
      }
      return originalFlush.call(this);
    });
    let saveArrived = false;
    const detach = transport.registerPendingSave(() => {
      if (saveArrived) {
        transport.postMessage({ type: 'updateShaderSource', payload: { path: '/aurora.glsl', code: 'saved during IO' } });
        saveArrived = false;
      }
    });

    const saving = transport.flush();
    await flushStarted;
    saveArrived = true;
    releaseFirstFlush();
    await saving;

    expect(await transport.readEditorFile('/aurora.glsl')).toBe('saved during IO');
    expect(calls).toBeGreaterThanOrEqual(2);
    detach();
    transport.dispose();
  });

  it('surfaces a tracked viewer-message failure when flushing', async () => {
    const handling = vi.spyOn(WebExtensionHost.prototype, 'handleViewerMessage')
      .mockRejectedValueOnce(new Error('write failed'));
    const transport = new WebTransport();
    transport.postMessage({ type: 'updateShaderSource', payload: { path: '/aurora.glsl', code: 'lost' } });

    await eventually(() => expect(handling).toHaveBeenCalledOnce());
    await Promise.resolve();
    await expect(transport.flush()).rejects.toThrow('write failed');
    expect(handling).toHaveBeenCalledOnce();
    transport.dispose();
  });

  it('waits for in-flight workspace edits and clears before flushing', async () => {
    let finishEdit!: () => void;
    let finishClear!: () => void;
    const editing = vi.spyOn(WebExtensionHost.prototype, 'applyWorkspaceEdit').mockImplementation(() => new Promise<void>(resolve => {
      finishEdit = resolve;
    }));
    const clearing = vi.spyOn(WebExtensionHost.prototype, 'clearWorkspace').mockImplementation(() => new Promise<void>(resolve => {
      finishClear = resolve;
    }));
    const transport = new WebTransport();
    const edit = transport.applyWorkspaceEdit([], () => true, vi.fn());
    const clear = transport.clearWorkspace();
    await vi.waitFor(() => {
      expect(editing).toHaveBeenCalledOnce();
      expect(clearing).toHaveBeenCalledOnce();
    });
    let flushed = false;
    const barrier = transport.flush().then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);

    finishEdit();
    finishClear();
    await Promise.all([edit, clear, barrier]);
    expect(flushed).toBe(true);
    transport.dispose();
  });

  it('unregisters pending editor saves when disposed', async () => {
    const transport = new WebTransport();
    const save = vi.fn();
    transport.registerPendingSave(save);

    transport.dispose();
    await transport.flush();

    expect(save).not.toHaveBeenCalled();
  });

  it('waits for an in-flight backup import before allowing reload', async () => {
    let complete!: () => void;
    const importing = vi.spyOn(VirtualWorkspace.prototype, 'importBackup').mockImplementation(() =>
      new Promise<void>(resolve => {
        complete = resolve;
      }));
    const transport = new WebTransport();
    const imported = transport.importWorkspaceBackup({}, { replace: true });
    await vi.waitFor(() => expect(importing).toHaveBeenCalledOnce());
    let saved = false;
    const barrier = transport.flush().then(() => {
      saved = true;
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(saved).toBe(false);
    complete();
    await imported;
    await barrier;
    expect(saved).toBe(true);
    transport.dispose();
  });

  it('exposes durable workspace backup and persistence APIs for the shell', async () => {
    const transport = new WebTransport();
    const states: string[] = [];
    const unsubscribe = transport.onPersistenceStatus(status => states.push(status.state));
    await vi.waitFor(() => expect(states).toContain('saved'));
    const backup = await transport.exportWorkspaceBackup();
    expect(JSON.parse(backup)).toMatchObject({ format: 'shader-studio-workspace', version: 1 });
    expect(await transport.getPersistenceStatus()).toEqual({ state: 'saved' });
    await expect(transport.importWorkspaceBackup('{bad', { replace: true })).rejects.toThrow('valid JSON');
    await transport.flush();
    unsubscribe();
    transport.dispose();
  });

  it('truthfully reports the session-only fallback and does not claim a persist grant', async () => {
    const transport = new WebTransport();
    expect(await transport.getStorageStatus()).toMatchObject({ backend: 'session', persisted: false });
    expect(await transport.requestPersistentStorage()).toMatchObject({ backend: 'session', persisted: false });
    transport.dispose();
  });

  it('falls back to a session-only workspace when IndexedDB cannot open', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: { open: () => {
        throw new Error('IndexedDB blocked');
      } },
    });
    try {
      const transport = new WebTransport();
      expect(await transport.getStorageStatus()).toMatchObject({ backend: 'session', persisted: false });
      transport.dispose();
    } finally {
      if (descriptor) {
        Object.defineProperty(globalThis, 'indexedDB', descriptor);
      } else {
        Reflect.deleteProperty(globalThis, 'indexedDB');
      }
    }
  });

  describe('pull request previews', () => {
    function stubIndexedDb(open: (name: string) => never) {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
      Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open } });
      return () => {
        if (descriptor) {
          Object.defineProperty(globalThis, 'indexedDB', descriptor);
        } else {
          Reflect.deleteProperty(globalThis, 'indexedDB');
        }
      };
    }

    it('keep their workspace and edit journal apart from the live app', async () => {
      const opened: string[] = [];
      const restore = stubIndexedDb((name) => {
        opened.push(name);
        throw new Error('IndexedDB blocked');
      });
      const read = vi.spyOn(localStorage, 'getItem');
      try {
        await createWorkspace('pr-166', true);
        expect(opened).toEqual(['shader-studio-web-pr-166']);
        expect(read).toHaveBeenCalledWith('shader-studio-workspace-journal-pr-166');
        expect(read).not.toHaveBeenCalledWith('shader-studio-workspace-journal');

        opened.length = 0;
        await createWorkspace(null, false);
        expect(opened).toEqual(['shader-studio-web']);
      } finally {
        read.mockRestore();
        restore();
      }
    });

    it('stay in memory when their storage could not be isolated', async () => {
      const open = vi.fn(() => {
        throw new Error('must not open');
      });
      const restore = stubIndexedDb(open);
      try {
        await expect(createWorkspace('pr-166', false)).resolves.toMatchObject({ backend: 'session' });
        expect(open).not.toHaveBeenCalled();
      } finally {
        restore();
      }
    });
  });

  it('queries and requests browser eviction protection best-effort', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    const persisted = vi.fn().mockResolvedValue(true);
    const storage = { persist, persisted };
    await expect(inspectWorkspaceStorage('indexeddb', storage, true))
      .resolves.toEqual({ backend: 'indexeddb', persisted: true, persistSupported: true });
    expect(persist).toHaveBeenCalledOnce();
    expect(persisted).toHaveBeenCalledOnce();
    await expect(inspectWorkspaceStorage('indexeddb', {
      persist: vi.fn().mockRejectedValue(new Error('denied')),
      persisted: vi.fn().mockRejectedValue(new Error('blocked')),
    }, true)).resolves.toEqual({ backend: 'indexeddb', persisted: null, persistSupported: true });
  });

  it('reports unknown eviction protection where the Storage API is missing', async () => {
    await expect(inspectWorkspaceStorage('indexeddb', undefined, true))
      .resolves.toEqual({ backend: 'indexeddb', persisted: null, persistSupported: false });
  });

  it('reports unknown eviction protection when the browser can request it but not report it', async () => {
    const persist = vi.fn().mockResolvedValue(true);

    await expect(inspectWorkspaceStorage('indexeddb', { persist } as unknown as StorageManager, true))
      .resolves.toEqual({ backend: 'indexeddb', persisted: null, persistSupported: true });
    expect(persist).toHaveBeenCalledOnce();
  });

  it('only asks the browser for protection when the user requested it', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    const persisted = vi.fn().mockResolvedValue(false);

    await expect(inspectWorkspaceStorage('indexeddb', { persist, persisted }))
      .resolves.toEqual({ backend: 'indexeddb', persisted: false, persistSupported: true });
    expect(persist).not.toHaveBeenCalled();
  });

  it('never requests protection for a session-only workspace, which has nothing to protect', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    const persisted = vi.fn().mockResolvedValue(true);

    await expect(inspectWorkspaceStorage('session', { persist, persisted }, true))
      .resolves.toEqual({ backend: 'session', persisted: false, persistSupported: true });
    expect(persist).not.toHaveBeenCalled();
    expect(persisted).not.toHaveBeenCalled();
  });

  it('stops persistence updates when the transport is disposed before the workspace opens', async () => {
    const transport = new WebTransport();
    const listener = vi.fn();
    transport.onPersistenceStatus(listener);

    transport.dispose();
    await transport.flush();

    expect(listener).not.toHaveBeenCalled();
  });

  it('stops persistence updates for a listener that detached before the workspace opened', async () => {
    const transport = new WebTransport();
    const listener = vi.fn();
    const detach = transport.onPersistenceStatus(listener);

    detach();
    await transport.flush();

    expect(listener).not.toHaveBeenCalled();
    transport.dispose();
  });

  it('delivers the seeded workspace shader to the viewer', async () => {
    const transport = new WebTransport();
    const handler = vi.fn();
    transport.onMessage(handler);

    await eventually(() => expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'shaderSource', path: '/aurora.glsl' }),
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
    explorer.postMessage({ type: 'activateShader', path: '/aurora-slang.slang' });
    await eventually(() => expect(viewer).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'shaderSource', path: '/aurora-slang.slang' }),
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
      data: expect.objectContaining({ type: 'shaderSource', path: '/new-slang.slang', language: 'slang' }),
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
  explorer.postMessage({ type: 'saveState', state: { keepActiveShaderFiles: false } });
  explorer.postMessage({ type: 'openShader', path: '/aurora.glsl' });
  await vi.waitFor(() => expect(getSelectedEditor()).toBe('/aurora.glsl'));
  expect(getRequestedEditor()).toBeNull();
  expect(await transport.readEditorFile('/aurora.glsl')).toContain('mainImage');
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
  transport.getShaderExplorerHostApi().postMessage({ type: 'activateShader', path: '/aurora.glsl' });
  await vi.waitFor(() => expect(viewer).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ type: 'shaderSource', path: '/aurora.glsl' }),
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
    bufferPath: '/glow-trails/trails.buffer.glsl', shaderPath: '/glow-trails.glsl', mode,
  } });
  await vi.waitFor(() => expect(getRequestedEditor()).toBe('/glow-trails/trails.buffer.glsl'));
  expect(getEditorDocument('/glow-trails/trails.buffer.glsl')).toContain('mainImage');
  transport.dispose();
});

it('does not open buffers when navigation on buffer switch is disabled', async () => {
  resetShellState();
  const transport = new WebTransport();
  expect(transport.settings.update('navigateOnBufferSwitch', false)).toBe(true);
  transport.postMessage({ type: 'navigateToBuffer', payload: {
    bufferPath: '/glow-trails/trails.buffer.glsl', shaderPath: '/glow-trails.glsl', mode: 'active',
  } });
  await transport.readEditorFile('/aurora.glsl');
  expect(getRequestedEditor()).toBeNull();
  // Standalone preferences are browser-global. Restore the default so later
  // transport tests do not inherit this deliberate opt-out.
  transport.settings.update('navigateOnBufferSwitch', true);
  transport.dispose();
});

it('ignores missing navigation targets and navigation after disposal', async () => {
  resetShellState();
  const transport = new WebTransport();
  transport.postMessage({ type: 'navigateToBuffer', payload: { bufferPath: '/missing.glsl' } });
  await transport.readEditorFile('/missing.glsl');
  expect(getRequestedEditor()).toBeNull();
  transport.dispose();
  transport.postMessage({ type: 'navigateToBuffer', payload: { bufferPath: '/aurora.glsl' } });
  await Promise.resolve();
  expect(getRequestedEditor()).toBeNull();
});


it.each([undefined, null, {}, { bufferPath: 42 }, { bufferPath: '' }])('ignores invalid navigation payload %j', async (payload) => {
  resetShellState();
  const transport = new WebTransport();
  transport.postMessage({ type: 'navigateToBuffer', payload });
  await transport.readEditorFile('/aurora.glsl');
  expect(getRequestedEditor()).toBeNull();
  transport.dispose();
});

it('does not open files when disposed before queued navigation runs', async () => {
  resetShellState();
  const transport = new WebTransport();
  transport.postMessage({ type: 'navigateToBuffer', payload: { bufferPath: '/aurora.glsl' } });
  transport.dispose();
  await transport.readEditorFile('/aurora.glsl');
  expect(getRequestedEditor()).toBeNull();
});


it('opens an empty file', async () => {
  resetShellState();
  const transport = new WebTransport();
  transport.postMessage({ type: 'updateShaderSource', payload: { path: '/aurora.glsl', code: '' } });
  transport.postMessage({ type: 'navigateToBuffer', payload: { bufferPath: '/aurora.glsl' } });
  await vi.waitFor(() => expect(getRequestedEditor()).toBe('/aurora.glsl'));
  expect(getEditorDocument('/aurora.glsl')).toBe('');
  transport.dispose();
});

it('opens the config file in the editor instead of forwarding it to the viewer', async () => {
  resetShellState();
  const transport = new WebTransport();
  const viewer = vi.fn();
  transport.onMessage(viewer);
  await vi.waitFor(() => expect(viewer).toHaveBeenCalled());

  transport.postMessage({ type: 'showConfig', payload: { shaderPath: '/aurora.sha.json', sourcePath: '/aurora.glsl' } });

  await vi.waitFor(() => expect(getRequestedEditor()).toBe('/aurora.sha.json'));
  expect(getEditorDocument('/aurora.sha.json')).toContain('passes');
  expect(viewer.mock.calls.filter(([event]) => event.data.type === 'openEditorFile')).toHaveLength(0);
  transport.dispose();
});

it('keeps manual edits out of the preview until a compile is requested', async () => {
  resetShellState();
  const transport = new WebTransport();
  const viewer = vi.fn();
  transport.onMessage(viewer);
  await vi.waitFor(() => expect(viewer).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ type: 'shaderSource' }),
  })));

  transport.postMessage({ type: 'setCompileMode', payload: { mode: 'manual' } });
  viewer.mockClear();
  transport.postMessage({ type: 'updateShaderSource', payload: { path: '/aurora.glsl', code: 'manual edit' } });
  await vi.waitFor(() => expect(getEditorDocument('/aurora.glsl')).toBe('manual edit'));
  expect(viewer).not.toHaveBeenCalled();

  transport.postMessage({ type: 'extensionCommand', payload: { command: 'manualCompile' } });
  await vi.waitFor(() => expect(viewer).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ type: 'shaderSource', code: 'manual edit' }),
  })));
  transport.dispose();
});

it('delegates viewer document indexing and atomic edits while guarding disposed viewers', async () => {
  const transport = new WebTransport();
  const viewer = transport.createViewerTransport();
  expect(viewer.getType()).toBe('web');
  const documents = await viewer.getWorkspaceDocuments!('glsl');
  const document = documents.find(file => file.uri.endsWith('/aurora.glsl'))!;
  expect(document).toBeDefined();
  const change = { uri: document.uri, before: document.text, after: `${document.text}\n// renamed` };
  const commit = vi.fn();
  await viewer.applyWorkspaceEdit!([change], () => true, commit, new Map([[document.uri, document.text]]));
  expect(commit).toHaveBeenCalledOnce();
  expect(await transport.readEditorFile('/aurora.glsl')).toBe(change.after);
  expect(getEditorDocument('/aurora.glsl')).toBe(change.after);
  viewer.dispose();
  await expect(viewer.applyWorkspaceEdit!([{ ...change, before: change.after, after: document.text }], () => true, commit)).rejects.toThrow();
  expect(commit).toHaveBeenCalledOnce();
  const receive = vi.fn();
  transport.dispose();
  transport.onMessage(receive);
  expect(receive).not.toHaveBeenCalled();
});

describe('WebTransport preview file and save edge cases', () => {
  beforeEach(() => resetShellState());
  const tracking = (transport: WebTransport) => {
    transport.getShaderExplorerHostApi().postMessage({ type: 'saveState', state: { keepActiveShaderFiles: true } });
    return transport;
  };

  it('tracks the shell viewer, ignores reports without a shader, and drops reports after disposal', async () => {
    const transport = tracking(new WebTransport());
    transport.postMessage({ type: 'previewFilesChanged', payload: { shaderPath: '' } });
    transport.postMessage({ type: 'previewFilesChanged', payload: {} } as never);
    transport.postMessage({ type: 'previewFilesChanged' } as never);
    await transport.flush();
    expect(getActiveShaderEditors() ?? []).toHaveLength(0);
    transport.postMessage({ type: 'previewFilesChanged', payload: { shaderPath: '/aurora.glsl' } });
    await transport.flush();
    expect(getActiveShaderEditors()).toEqual([expect.objectContaining({ id: 'default', shaderPath: '/aurora.glsl' })]);
    resetShellState();
    transport.postMessage({ type: 'previewFilesChanged', payload: { shaderPath: '/glow-trails.glsl' } });
    transport.dispose();
    await Promise.resolve(); await Promise.resolve();
    expect(getActiveShaderEditors() ?? []).toHaveLength(0);
  });

  it('focuses an explorer-selected pass that the tracked preview already has open', async () => {
    const transport = tracking(new WebTransport());
    transport.postMessage({ type: 'previewFilesChanged', payload: { shaderPath: '/glow-trails.glsl' } });
    await transport.flush();
    expect(getActiveShaderEditors()?.[0].files).toContain('/glow-trails/trails.buffer.glsl');
    const explorer = transport.getShaderExplorerHostApi();
    // The preview stays on its owner, so the selected pass is shown in its tab.
    explorer.postMessage({ type: 'openShader', path: '/glow-trails/trails.buffer.glsl' });
    await transport.flush();
    expect(getSelectedEditor()).toBe('/glow-trails/trails.buffer.glsl');
    resetShellState();
    // Another shader is opened by the preview change, not by a direct selection.
    explorer.postMessage({ type: 'openShader', path: '/aurora.glsl' });
    await transport.flush();
    expect(getSelectedEditor()).toBeNull();
    transport.dispose();
  });

  it('forgets a viewer that closes while its file report is pending and delegates editor state', async () => {
    const transport = tracking(new WebTransport());
    const viewer = transport.createViewerTransport();
    viewer.postMessage({ type: 'previewFilesChanged', payload: { shaderPath: '/aurora.glsl' } });
    viewer.dispose();
    await transport.flush();
    expect(getActiveShaderEditors()).toEqual([]);
    const live = transport.createViewerTransport();
    const dirty = vi.spyOn(transport, 'markEditorDirty');
    const pending = vi.spyOn(transport, 'registerPendingSave');
    const save = vi.fn();
    live.markEditorDirty?.('/aurora.glsl');
    live.registerPendingSave?.(save)();
    expect(dirty).toHaveBeenCalledWith('/aurora.glsl');
    expect(pending).toHaveBeenCalledWith(save);
    live.dispose(); transport.dispose();
  });

  it('keeps an editor dirty when it changes again while its save is written', async () => {
    const transport = new WebTransport();
    const path = '/aurora.glsl';
    await transport.readEditorFile(path);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      transport.markEditorDirty(path);
      transport.postMessage({ type: 'updateShaderSource', payload: { path, code: 'first save' } });
      transport.markEditorDirty(path);
      transport.postMessage({ type: 'updateShaderSource', payload: { code: 'no target' } } as never);
      await transport.flush();
      expect(await transport.confirmEditorClose(path)).toBe(false);
      expect(confirm).toHaveBeenCalledOnce();
    } finally {
      confirm.mockRestore(); transport.dispose();
    }
  });
});
