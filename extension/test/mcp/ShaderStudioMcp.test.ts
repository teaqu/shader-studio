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
  mount: vi.fn(), update: vi.fn(), error: vi.fn(),
}));
vi.mock('vscode', () => ({
  ExtensionMode: { Development: 2 }, ConfigurationTarget: { Global: 1 },
  window: { registerWebviewViewProvider: vi.fn(() => ({ dispose() {} })) },
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
vi.mock('../../src/app/ShaderProvider', () => ({ ShaderProvider: class {} }));
vi.mock('../../src/app/WebServer', () => ({ WebServer: class {
  setMessenger() {} setMcpHandler = state.mount; stopWebServer() {}
} }));
vi.mock('../../src/app/transport/WebSocketTransport', () => ({ WebSocketTransport: class {} }));
vi.mock('../../src/app/ShaderExplorerProvider', () => ({ ShaderExplorerProvider: { register: () => ({ dispose() {} }) } }));
vi.mock('../../src/app/ShaderExplorerViewProvider', () => ({ ShaderExplorerViewProvider: class {} }));
vi.mock('../../src/app/GlslFileTracker', () => ({ GlslFileTracker: class {} }));
vi.mock('../../src/app/ShaderCreator', () => ({ ShaderCreator: class {} }));
vi.mock('../../src/app/transport/Messenger', () => ({ Messenger: class {
  close() {}
} }));
vi.mock('../../src/app/ErrorHandler', () => ({ ErrorHandler: class {
  dispose() {}
} }));
vi.mock('../../src/app/ConfigGenerator', () => ({ ConfigGenerator: class {} }));
vi.mock('../../src/app/WorkspaceTypeDefs', () => ({ writeWorkspaceTypeDefs() {} }));
vi.mock('../../src/app/CompileController', () => ({ CompileController: class {} }));

// Private lifecycle hooks are exposed only to await the extension's serialized configuration.
type Lifecycle = { mcpConfiguration: Promise<void>; registerCommands(): void; registerEventHandlers(): void; startWebSocketTransport(): void };
function create() {
  const prototype = ShaderStudio.prototype as unknown as Lifecycle;
  vi.spyOn(prototype, 'registerCommands').mockImplementation(() => {});
  vi.spyOn(prototype, 'registerEventHandlers').mockImplementation(() => {});
  vi.spyOn(prototype, 'startWebSocketTransport').mockImplementation(() => {});
  const output = { info: vi.fn(), error: state.error, debug: vi.fn(), trace: vi.fn() } as unknown as VSCode.LogOutputChannel;
  const studio = new ShaderStudio({ subscriptions: [], extensionPath: '/extension', extensionMode: 2 } as unknown as VSCode.ExtensionContext, output, {} as DiagnosticSink);
  return { studio, settled: () => (studio as unknown as Lifecycle).mcpConfiguration };
}
function change(key = 'mcpEnabled') {
 state.change!({ affectsConfiguration: value => value === `shader-studio.${key}` });
}

beforeEach(() => {
  vi.restoreAllMocks(); vi.clearAllMocks(); state.config = {}; state.trusted = true; state.endpoints = [];
  state.start.mockResolvedValue(51474);
  state.update.mockImplementation(async (key: string, value: unknown) => {
    state.config[key] = value;
  });
});

describe('extension MCP lifecycle', () => {
  it('defaults off, generates a persistent token, mounts, reconfigures and shuts down', async () => {
    const app = create(); await app.settled();
    expect(state.endpoints).toHaveLength(0);
    state.config.mcpEnabled = true; change(); await app.settled();
    expect(state.update).toHaveBeenCalledWith('mcpToken', expect.stringMatching(/^[a-f0-9]{64}$/), 1);
    change('mcpToken'); await app.settled();
    expect(state.endpoints).toHaveLength(1);
    expect(state.endpoints[0].token).toBe(state.config.mcpToken);
    const handler = state.mount.mock.calls.at(-1)![0];
    handler('request', 'response');
    expect(state.endpoints[0].handle).toHaveBeenCalledWith('request', 'response');
    change('unrelated'); await app.settled(); expect(state.endpoints).toHaveLength(1);
    state.config.mcpPort = 55555; change('mcpPort'); await app.settled();
    expect(state.start).toHaveBeenLastCalledWith(55555);
    expect(state.endpoints[0].dispose).toHaveBeenCalledOnce();
    state.config.mcpEnabled = false; change(); await app.settled();
    expect(state.endpoints[1].dispose).toHaveBeenCalledOnce();
    expect(state.mount).toHaveBeenLastCalledWith(undefined);
    app.studio.dispose(); change(); await app.settled();
    expect(state.endpoints).toHaveLength(2);
  });
  it('starts on startup and after trust is granted, and recovers from listen failures', async () => {
    state.config = { mcpEnabled: true, mcpToken: 'existing-token' }; state.trusted = false;
    const app = create(); await app.settled(); expect(state.error).toHaveBeenCalledWith(expect.stringContaining('Trust'));
    state.trusted = true; state.start.mockRejectedValueOnce(new Error('Port occupied'));
    state.trust!(); await app.settled(); expect(state.error).toHaveBeenCalledWith(expect.stringContaining('Port occupied'));
    change(); await app.settled(); expect(state.endpoints).toHaveLength(2);
    app.studio.dispose(); expect(state.endpoints[1].dispose).toHaveBeenCalledOnce();
  });
  it('closes a listener that finishes starting after the extension is disposed', async () => {
    state.config = { mcpEnabled: true, mcpToken: 'existing-token' };
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
