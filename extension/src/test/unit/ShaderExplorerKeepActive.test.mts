import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';

const setting = vi.hoisted(() => ({ value: false as boolean, update: vi.fn() }));
const vscodeApi = vi.hoisted(() => ({
  commands: { executeCommand: vi.fn(async () => {}) },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  workspace: {
    workspaceFolders: undefined as unknown[] | undefined,
    getConfiguration: vi.fn(() => ({ get: () => setting.value, update: setting.update })),
    createFileSystemWatcher: () => ({ onDidCreate: vi.fn(), onDidChange: vi.fn(), onDidDelete: vi.fn(), dispose: vi.fn() }),
  },
}));
vi.mock('vscode', () => vscodeApi);
vi.mock('../../app/services/Logger.js', () => ({
  Logger: { getInstance: () => ({ debug: vi.fn(), info: vi.fn(), error: vi.fn() }) },
}));
vi.mock('../../app/ThumbnailCache.js', () => ({
  ThumbnailCache: class {
    getThumbnail = () => null; pruneCache = async () => {}; 
  },
}));
vi.mock('../../app/TabGroupResolver.js', () => ({ TabGroupResolver: class {
  dispose = vi.fn(); 
} }));
vi.mock('../../app/ShaderConfigProcessor.js', () => ({ ShaderConfigProcessor: class {} }));
vi.mock('../../app/ShaderGitMetadataProvider.js', () => ({ ShaderGitMetadataProvider: class {} }));
import { ShaderExplorerBackend } from '../../app/ShaderExplorerBackend.js';

function setup(savedState: unknown) {
  const workspaceState = { get: vi.fn(() => savedState), update: vi.fn(async () => {}) };
  const webview = { postMessage: vi.fn() };
  const backend = new ShaderExplorerBackend(
    { workspaceState } as unknown as vscode.ExtensionContext,
    webview as unknown as vscode.Webview,
    { getMetadataForWorkspace: vi.fn(), clearCache: vi.fn() },
  );
  (backend as unknown as { findAllShaders: () => Promise<unknown[]> }).findAllShaders = async () => [];
  return { backend, webview, workspaceState };
}

describe('ShaderExplorerBackend keep-active-shader-files setting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setting.value = false;
    vscodeApi.workspace.workspaceFolders = undefined;
  });

  it.each([
    [undefined, 1],
    [[{}], 2],
  ])('writes a changed toggle to the setting scope for the open folders (%j)', async (folders, target) => {
    vscodeApi.workspace.workspaceFolders = folders;
    const { backend, workspaceState } = setup(null);
    const state = { sort: 'name', keepActiveShaderFiles: true };
    await backend.handleMessage({ type: 'saveState', state });
    expect(workspaceState.update).toHaveBeenCalledWith('shaderBrowser.state', state);
    expect(setting.update).toHaveBeenCalledExactlyOnceWith('explorer.keepActiveShaderFiles', true, target);
    backend.dispose();
  });

  it('leaves the setting alone when the toggle is absent or already matches', async () => {
    const { backend } = setup(null);
    await backend.handleMessage({ type: 'saveState', state: { sort: 'name' } });
    await backend.handleMessage({ type: 'saveState', state: undefined });
    await backend.handleMessage({ type: 'saveState', state: { keepActiveShaderFiles: false } });
    expect(setting.update).not.toHaveBeenCalled();
    backend.dispose();
  });

  it.each([null, { sort: 'name' }])('reports the live setting with the saved explorer state (%j)', async savedState => {
    setting.value = true;
    const { backend, webview } = setup(savedState);
    await backend.handleMessage({ type: 'requestShaders' });
    expect(webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'shadersUpdate', savedState: { ...(savedState ?? {}), keepActiveShaderFiles: true },
    }));
    backend.dispose();
  });

  it('routes every explorer request to its handler', async () => {
    vi.useFakeTimers();
    try {
      const { backend } = setup(null);
      const handlers = Object.fromEntries(['sendShaderCode', 'sendShaderSearchResults', 'saveThumbnail', 'openShader', 'activateShader',
        'openConfig', 'createConfig', 'deleteShader', 'renameShader', 'sendShaderList'].map(name => {
        const handler = vi.fn(async () => {});
        (backend as unknown as Record<string, unknown>)[name] = handler;
        return [name, handler];
      }));
      const messages: [Record<string, unknown>, string, unknown[]][] = [
        [{ type: 'requestShaderCode', path: '/a', requestId: 1 }, 'sendShaderCode', ['/a', 1]],
        [{ type: 'searchShaders', query: 'q', requestId: 2 }, 'sendShaderSearchResults', ['q', 2]],
        [{ type: 'saveThumbnail', path: '/a', thumbnail: 't', thumbnailVersion: 3 }, 'saveThumbnail', ['/a', 't', 3]],
        [{ type: 'openShader', path: '/a' }, 'openShader', ['/a']],
        [{ type: 'activateShader', path: '/a' }, 'activateShader', ['/a']],
        [{ type: 'openConfig', path: '/a' }, 'openConfig', ['/a']],
        [{ type: 'createConfig', shaderPath: '/a' }, 'createConfig', ['/a']],
        [{ type: 'deleteShader', path: '/a' }, 'deleteShader', ['/a']],
        [{ type: 'renameShader', path: '/a' }, 'renameShader', ['/a']],
      ];
      for (const [message, name, args] of messages) {
        await backend.handleMessage(message);
        expect(handlers[name]).toHaveBeenCalledWith(...args);
      }
      const created = backend.handleMessage({ type: 'newShader' });
      await vi.advanceTimersByTimeAsync(300);
      await created;
      expect(vscodeApi.commands.executeCommand).toHaveBeenCalledWith('shader-studio.newShader');
      expect(handlers.sendShaderList).toHaveBeenCalled();
      await backend.handleMessage({ type: 'togglePanel' });
      expect(vscodeApi.commands.executeCommand).toHaveBeenCalledWith('shader-studio.view');
      await backend.handleMessage({ type: 'unknown' });
      backend.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
