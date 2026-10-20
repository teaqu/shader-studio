import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import type { Messenger } from '../../app/transport/Messenger.js';
import type { ShaderProvider } from '../../app/ShaderProvider.js';
import type { GlslFileTracker } from '../../app/GlslFileTracker.js';

const editors = vi.hoisted(() => ({
  setEnabled: vi.fn(async () => {}), update: vi.fn(async () => {}), remove: vi.fn(async () => {}), dispose: vi.fn(),
}));
const client = vi.hoisted(() => ({handle: vi.fn(), release: vi.fn()}));
const settings = vi.hoisted(() => ({ values: new Map<string, unknown>() }));
const vscodeApi = vi.hoisted(() => {
  const workspace = {
    workspaceFolders: undefined,
    getConfiguration: vi.fn(() => ({ get: (key: string, fallback: unknown) => settings.values.has(key) ? settings.values.get(key) : fallback })),
    onDidChangeConfiguration: vi.fn(),
  };
  const window = { tabGroups: { all: [] as unknown[] }, createWebviewPanel: vi.fn() };
  return {
    workspace, window,
    ViewColumn: { Beside: -2 },
    Uri: { file: (fsPath: string) => ({ fsPath, toString: () => `file://${fsPath}` }) },
    commands: { executeCommand: vi.fn() },
  };
});
vi.mock('vscode', () => vscodeApi);
vi.mock('fs', () => ({ readFileSync: () => '<html><head></head><body></body></html>', existsSync: () => false }));
vi.mock('../../app/ActiveShaderEditors.js', () => ({ ActiveShaderEditors: class {
  constructor() {
    return editors; 
  } 
} }));
vi.mock('../../app/ClientMessageHandler.js', () => ({ ClientMessageHandler: class {
  handle = client.handle;
  releaseScriptStreams = client.release;
} }));
vi.mock('../../app/transport/WebviewTransport.js', () => ({
  WebviewTransport: class {
    addPanel = vi.fn(); removePanel = vi.fn(); send = vi.fn(); 
  },
}));
vi.mock('../../app/services/Logger.js', () => ({
  Logger: { getInstance: () => ({ debug: vi.fn(), info: vi.fn(), error: vi.fn() }) },
}));
import { PanelManager } from '../../app/PanelManager.js';

function fakePanel() {
  const handlers: { message?: (message: unknown) => Promise<void>; dispose?: () => void } = {};
  const panel = {
    active: false, visible: true, viewColumn: 2,
    webview: {
      cspSource: 'vscode-resource:', postMessage: vi.fn(), asWebviewUri: (uri: unknown) => uri,
      onDidReceiveMessage: (callback: (message: unknown) => Promise<void>) => {
        handlers.message = callback;
      },
    },
    onDidDispose: (callback: () => void) => {
      handlers.dispose = callback;
    },
  };
  return { panel, handlers };
}

describe('PanelManager active shader editor tracking', () => {
  let receive: (event: vscode.ConfigurationChangeEvent) => void;
  let manager: PanelManager;
  let messenger: { addTransport: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn>; hasActiveClients: () => boolean; getErrorHandler: () => { clearPersistentErrors: () => void } };

  beforeEach(() => {
    vi.clearAllMocks();
    settings.values = new Map<string, unknown>([['lockEditorGroup', false], ['explorer.keepActiveShaderFiles', true]]);
    vscodeApi.workspace.onDidChangeConfiguration.mockImplementation((callback: typeof receive) => {
      receive = callback;
      return { dispose: vi.fn() };
    });
    messenger = { addTransport: vi.fn(), send: vi.fn(), hasActiveClients: () => true, getErrorHandler: () => ({ clearPersistentErrors: vi.fn() }) };
    const context = { subscriptions: [] as unknown[], extensionPath: '/extension' } as unknown as vscode.ExtensionContext;
    manager = new PanelManager(context, messenger as unknown as Messenger, {} as ShaderProvider,
      { getActiveOrLastViewedGLSLEditor: () => null } as unknown as GlslFileTracker);
    expect(context.subscriptions).toContain(editors);
  });

  it('enables tracking from the setting at startup and follows later setting changes only', () => {
    expect(editors.setEnabled).toHaveBeenCalledExactlyOnceWith(true);
    const event = (name: string) => ({ affectsConfiguration: (section: string) => section === name }) as vscode.ConfigurationChangeEvent;
    receive(event('shader-studio.preview.preventMouseDefaults'));
    expect(editors.setEnabled).toHaveBeenCalledTimes(1);
    settings.values.set('explorer.keepActiveShaderFiles', false);
    receive(event('shader-studio.explorer.keepActiveShaderFiles'));
    expect(editors.setEnabled).toHaveBeenLastCalledWith(false);
  });

  it('routes preview file reports to the tracker and forgets a panel when it closes', async () => {
    const { panel, handlers } = fakePanel();
    vscodeApi.window.createWebviewPanel.mockReturnValue(panel);
    manager.createPanel();
    const payload = { files: ['/work/a.glsl'] };
    await handlers.message!({ type: 'previewFilesChanged', payload });
    expect(editors.update).toHaveBeenCalledExactlyOnceWith(panel, payload);
    await handlers.message!({ type: 'languageServiceReady' });
    expect(editors.update).toHaveBeenCalledTimes(1);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'languageServiceSettings' }));
    handlers.dispose!();
    expect(editors.remove).toHaveBeenCalledExactlyOnceWith(panel);
  });
  it('supplies the owning panel and URI/response adapters to shared stream routing', async () => {
    const { panel, handlers } = fakePanel();
    vscodeApi.window.createWebviewPanel.mockReturnValue(panel);
    manager.createPanel();
    client.handle.mockImplementation(async (_message: unknown, respond: (message: unknown) => unknown, convert: (path: string) => string, owner: unknown) => {
      expect(owner).toBe(panel);
      expect(convert('/work/image.png')).toBe('file:///work/image.png');
      respond({type: 'scriptStreamFrame'});
    });
    await handlers.message!({type: 'requestScriptStreamFrame', payload: {session: 1}});
    expect(client.handle).toHaveBeenCalledOnce();
    expect(panel.webview.postMessage).toHaveBeenCalledWith({type: 'scriptStreamFrame'});
    handlers.dispose!();
    expect(client.release).toHaveBeenCalledWith(panel);
  });

});
