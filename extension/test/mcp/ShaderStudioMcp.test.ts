import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as VSCode from 'vscode';
import { ShaderStudio } from '../../src/app/ShaderStudio';
import type { DiagnosticSink } from '../../src/app/DiagnosticArbiter';

const state = vi.hoisted(() => ({
  config: {} as Record<string, unknown>, trusted: true,
  change: undefined as undefined | ((event: { affectsConfiguration(key: string): boolean }) => void),
  trust: undefined as undefined | (() => void),
  endpoints: [] as { start: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; handle: ReturnType<typeof vi.fn>; token: string }[],
  start: vi.fn(async () => 51474),
  setMcpEnabled: vi.fn(),
  mount: vi.fn(), update: vi.fn(), error: vi.fn(),
  secret: undefined as string | undefined,
  secretStore: vi.fn(),
  secretGet: vi.fn(),
  post: vi.fn(),
  message: undefined as undefined | ((value: unknown) => Promise<void>),
  commands: new Map<string, () => unknown>(),
  secretChange: undefined as undefined | ((event: { key: string }) => void),
  textChange: undefined as undefined | ((event: { document: unknown }) => void),
  compileChange: vi.fn(() => false),
}));
vi.mock('vscode', () => ({
  ExtensionMode: { Development: 2 }, ConfigurationTarget: { Global: 1 }, ViewColumn: { Active: -1 },
  Uri: { joinPath: (base: { fsPath: string }, name: string) => ({ fsPath: `${base.fsPath}/${name}` }) },
  window: {
    createWebviewPanel: () => ({ webview: { html: '', postMessage: state.post, onDidReceiveMessage: (callback: typeof state.message) => {
      state.message = callback; return { dispose() {} };
    } }, onDidDispose() {}, dispose() {} }),
    registerWebviewViewProvider: vi.fn(() => ({ dispose() {} })), visibleTextEditors: [],
    onDidChangeActiveTextEditor: () => ({ dispose() {} }), onDidChangeTextEditorSelection: () => ({ dispose() {} }),
    showInformationMessage: vi.fn(async () => undefined), showWarningMessage: vi.fn(async () => undefined), showErrorMessage: vi.fn(),
  },
  commands: { registerCommand: (name: string, callback: () => unknown) => {
    state.commands.set(name, callback); return { dispose() {} };
  }, executeCommand: vi.fn() },
  workspace: {
    get isTrusted() {
      return state.trusted;
    },
    getConfiguration: () => ({ get: (key: string, fallback: unknown) => state.config[key] ?? fallback, update: state.update }),
    onDidGrantWorkspaceTrust: (callback: () => void) => {
      state.trust = callback; return { dispose() {} };
    },
    onDidChangeConfiguration: (callback: typeof state.change) => {
      state.change = callback; return { dispose() {} };
    },
    onDidChangeTextDocument: (callback: typeof state.textChange) => {
      state.textChange = callback; return { dispose() {} };
    },
    onDidSaveTextDocument: () => ({ dispose() {} }),
  },
}));
vi.mock('../../src/app/mcp/LocalMcpEndpoint', () => ({ LocalMcpEndpoint: class {
  start = state.start; dispose = vi.fn(async () => {}); handle = vi.fn();
  constructor(_app: unknown, public token: string) {
    state.endpoints.push(this);
  }
} }));
vi.mock('../../src/app/mcp/VscodeMcpApplication', () => ({ VscodeMcpApplication: class {} }));
vi.mock('../../src/app/PanelManager', () => ({ PanelManager: class {} }));
vi.mock('../../src/app/ShaderProvider', () => ({ ShaderProvider: class {
  dispose = vi.fn();
} }));
vi.mock('../../src/app/WebServer', () => ({ WebServer: class {
  setMessenger() {} setMcpHandler = state.mount; stopWebServer() {}
} }));
vi.mock('../../src/app/transport/WebSocketTransport', () => ({ WebSocketTransport: class {} }));
vi.mock('../../src/app/ShaderExplorerProvider', () => ({ ShaderExplorerProvider: { register: () => ({ dispose() {} }) } }));
vi.mock('../../src/app/ShaderExplorerViewProvider', () => ({ ShaderExplorerViewProvider: class {} }));
vi.mock('../../src/app/GlslFileTracker', () => ({ GlslFileTracker: class {} }));
vi.mock('../../src/app/ShaderCreator', () => ({ ShaderCreator: class {} }));
vi.mock('../../src/app/transport/Messenger', () => ({ Messenger: class {
  setMcpEnabled = state.setMcpEnabled;
  close() {
    state.setMcpEnabled(false);
  }
} }));
vi.mock('../../src/app/ErrorHandler', () => ({ ErrorHandler: class {
  dispose() {}
} }));
vi.mock('../../src/app/ConfigGenerator', () => ({ ConfigGenerator: class {} }));
vi.mock('../../src/app/WorkspaceTypeDefs', () => ({ writeWorkspaceTypeDefs() {} }));
vi.mock('../../src/app/CompileController', () => ({ CompileController: class {
  handleTextDocumentChange = state.compileChange; handleActiveEditorChange() {} handleTextDocumentSave() {}
} }));

// Private lifecycle hooks are exposed only to await the extension's serialized configuration.
type Lifecycle = { mcpConfiguration: Promise<void>; registerCommands(): void; registerEventHandlers(): void; startWebSocketTransport(): void };
function create() {
  const prototype = ShaderStudio.prototype as unknown as Lifecycle;
  vi.spyOn(prototype, 'registerCommands').mockImplementation(() => {});
  vi.spyOn(prototype, 'registerEventHandlers').mockImplementation(() => {});
  vi.spyOn(prototype, 'startWebSocketTransport').mockImplementation(() => {});
  const output = { info: vi.fn(), error: state.error, debug: vi.fn(), trace: vi.fn() } as unknown as VSCode.LogOutputChannel;
  const studio = new ShaderStudio({ subscriptions: [], extensionPath: '/extension', extensionMode: 2, globalStorageUri: { fsPath: '/storage' },
    secrets: { get: state.secretGet, store: state.secretStore, onDidChange: (callback: typeof state.secretChange) => {
      state.secretChange = callback; return { dispose() {} };
    } },
  } as unknown as VSCode.ExtensionContext, output, {} as DiagnosticSink);
  return { studio, settled: () => (studio as unknown as Lifecycle).mcpConfiguration };
}
function change(key = 'mcpEnabled') {
 state.change!({ affectsConfiguration: value => value === `shader-studio.${key}` });
}

beforeEach(() => {
  vi.restoreAllMocks(); vi.clearAllMocks(); state.config = {}; state.trusted = true; state.endpoints = [];
  state.start.mockResolvedValue(51474);
  state.secret = undefined;
  state.secretGet.mockImplementation(async () => state.secret);
  state.commands.clear(); state.secretChange = undefined; state.textChange = undefined; state.compileChange.mockReset(); state.compileChange.mockReturnValue(false);
  state.secretStore.mockImplementation(async (_key: string, value: string) => {
    state.secret = value;
  });
  state.update.mockImplementation(async (key: string, value: unknown) => {
    state.config[key] = value;
  });
});

describe('extension MCP lifecycle', () => {
  it('publishes disabled, ready and connected endpoint status through setup', async () => {
    const app = create(); await app.settled();
    state.commands.get('shader-studio.connectAiAssistant')!();
    await state.message!({ action: 'ready' });
    await vi.waitFor(() => expect(state.post).toHaveBeenLastCalledWith(expect.objectContaining({ ready: false, enabled: false })));
    state.config.mcpEnabled = true; change(); await app.settled();
    await state.message!({ action: 'ready' });
    await vi.waitFor(() => expect(state.post).toHaveBeenLastCalledWith(expect.objectContaining({ ready: true, status: 'Waiting for an assistant' })));
    Object.assign(state.endpoints[0], { connectedAssistants: 2 });
    await state.message!({ action: 'ready' });
    await vi.waitFor(() => expect(state.post).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'Assistant connected', detail: '2 active assistant sessions.' })));
    app.studio.dispose();
  });

  it.each(['disable', 'dispose'])('does not start an endpoint after %s while loading credentials', async (action) => {
    state.config.mcpEnabled = true;
    let resolveToken!: (value: string) => void;
    state.secretGet.mockReturnValueOnce(new Promise<string>(resolve => {
      resolveToken = resolve;
    }));
    const app = create();
    await vi.waitFor(() => expect(state.secretGet).toHaveBeenCalled());
    if (action === 'dispose') {
      app.studio.dispose();
    } else {
      state.config.mcpEnabled = false; change();
    }
    resolveToken('existing-token'); await app.settled();
    expect(state.endpoints).toHaveLength(0);
    expect(state.setMcpEnabled).not.toHaveBeenCalledWith(true);
    if (action !== 'dispose') {
      app.studio.dispose();
    }
  });

  it('reports non-Error startup failures and permits a later restart', async () => {
    state.config.mcpEnabled = true; state.secret = 'existing-token';
    state.start.mockRejectedValueOnce('port failure');
    const app = create(); await app.settled();
    expect(state.error).toHaveBeenCalledWith(expect.stringContaining('port failure'));
    change(); await app.settled();
    expect(state.mount).toHaveBeenLastCalledWith(expect.any(Function));
    app.studio.dispose();
  });

  it('uses MCP command and document callbacks without broadcasting guarded edits', async () => {
    const app = create(); await app.settled();
    await state.commands.get('shader-studio.connectAiAssistant')!();
    state.secretChange!({ key: 'shader-studio.mcpToken' }); await app.settled();
    (ShaderStudio.prototype as unknown as { registerEventHandlers: { mockRestore(): void } }).registerEventHandlers.mockRestore();
    (app.studio as unknown as { registerEventHandlers(): void }).registerEventHandlers();
    const configChange = vi.spyOn(app.studio as unknown as { handleConfigDocumentChange(document: unknown): void }, 'handleConfigDocumentChange');
    state.compileChange.mockReturnValueOnce(true);
    state.textChange!({ document: { uri: { fsPath: '/workspace/main.sha.json' } } });
    expect(configChange).not.toHaveBeenCalled();
    state.compileChange.mockReturnValueOnce(false);
    state.textChange!({ document: { uri: { fsPath: '/workspace/main.sha.json' } } });
    expect(configChange).toHaveBeenCalledOnce();
    app.studio.dispose();
  });
  it('defaults off, generates a persistent token, mounts, reconfigures and shuts down', async () => {
    const app = create(); await app.settled();
    expect(state.endpoints).toHaveLength(0);
    expect(state.setMcpEnabled).not.toHaveBeenCalledWith(true);
    state.config.mcpEnabled = true; change(); await app.settled();
    expect(state.secretStore).toHaveBeenCalledWith('shader-studio.mcpToken', expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(state.update).not.toHaveBeenCalled();
    expect(state.endpoints).toHaveLength(1);
    expect(state.setMcpEnabled).toHaveBeenLastCalledWith(true);
    expect(state.endpoints[0].token).toBe(state.secret);
    const handler = state.mount.mock.calls.at(-1)![0];
    handler('request', 'response');
    expect(state.endpoints[0].handle).toHaveBeenCalledWith('request', 'response');
    change('unrelated'); await app.settled(); expect(state.endpoints).toHaveLength(1);
    state.config.mcpPort = 55555; change('mcpPort'); await app.settled();
    expect(state.start).toHaveBeenLastCalledWith(55555);
    expect(state.endpoints[0].dispose).toHaveBeenCalledOnce();
    state.config.mcpEnabled = false; change(); await app.settled();
    expect(state.endpoints[1].dispose).toHaveBeenCalledOnce();
    expect(state.setMcpEnabled).toHaveBeenLastCalledWith(false);
    expect(state.mount).toHaveBeenLastCalledWith(undefined);
    app.studio.dispose(); change(); await app.settled();
    expect(state.endpoints).toHaveLength(2);
  });
  it('starts on startup and after trust is granted, and recovers from listen failures', async () => {
    state.config = { mcpEnabled: true }; state.secret = 'existing-token'; state.trusted = false;
    const app = create(); await app.settled(); expect(state.error).toHaveBeenCalledWith(expect.stringContaining('Trust'));
    expect(state.setMcpEnabled).not.toHaveBeenCalledWith(true);
    state.trusted = true; state.start.mockRejectedValueOnce(new Error('Port occupied'));
    state.trust!(); await app.settled(); expect(state.error).toHaveBeenCalledWith(expect.stringContaining('Port occupied'));
    expect(state.setMcpEnabled).toHaveBeenLastCalledWith(false);
    expect(state.endpoints[0].dispose).toHaveBeenCalledOnce();
    change(); await app.settled(); expect(state.endpoints).toHaveLength(2);
    app.studio.dispose(); expect(state.endpoints[1].dispose).toHaveBeenCalledOnce();
  });
  it('keeps tracking off when disabled while a listener is starting', async () => {
    state.config = { mcpEnabled: true }; state.secret = 'existing-token';
    let resolveStart!: (port: number) => void;
    state.start.mockReturnValueOnce(new Promise<number>(resolve => {
      resolveStart = resolve;
    }));
    const app = create(); await vi.waitFor(() => expect(state.start).toHaveBeenCalled());
    state.config.mcpEnabled = false; change();
    expect(state.setMcpEnabled).toHaveBeenLastCalledWith(false);
    resolveStart(51474); await app.settled();
    expect(state.setMcpEnabled).toHaveBeenLastCalledWith(false);
    expect(state.mount).toHaveBeenLastCalledWith(undefined);
    expect(state.endpoints[0].dispose).toHaveBeenCalledOnce();
    app.studio.dispose();
  });
  it('closes a listener that finishes starting after the extension is disposed', async () => {
    state.config = { mcpEnabled: true }; state.secret = 'existing-token';
    let resolveStart!: (port: number) => void;
    state.start.mockReturnValueOnce(new Promise<number>(resolve => {
      resolveStart = resolve;
    }));
    const app = create(); await vi.waitFor(() => expect(state.start).toHaveBeenCalled());
    app.studio.dispose(); resolveStart(51474); await app.settled();
    expect(state.endpoints[0].dispose).toHaveBeenCalledTimes(2);
    expect(state.mount).toHaveBeenLastCalledWith(undefined);
  });
});
