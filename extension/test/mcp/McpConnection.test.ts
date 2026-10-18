import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { mcpConnectionHtml } from '../../src/app/mcp/McpConnectionView';

const state = vi.hoisted(() => ({
  secret: undefined as string | undefined, stored: [] as string[],
  commands: new Map<string, () => unknown>(), clipboard: '', info: vi.fn(), warning: vi.fn(), error: vi.fn(), execute: vi.fn(), update: vi.fn(),
  secretChange: undefined as undefined | ((event: { key: string }) => void),
  sdkFailure: false, previewError: false, closeFailure: false, previews: undefined as unknown,
  confirmation: 'Regenerate' as string | undefined,
  message: undefined as undefined | ((message: unknown) => void), closed: undefined as undefined | (() => void),
  posts: vi.fn(), reveal: vi.fn(), create: vi.fn(), disposeMessages: vi.fn(), terminate: vi.fn(async () => {}),
}));
vi.mock('vscode', () => ({
  ViewColumn: { Active: -1 }, ConfigurationTarget: { Global: 1 },
  commands: {
    registerCommand: (id: string, command: () => unknown) => {
      state.commands.set(id, command); return { dispose: () => state.commands.delete(id) };
    },
    executeCommand: state.execute,
  },
  workspace: { getConfiguration: () => ({ update: state.update }) },
  env: { clipboard: { writeText: async (text: string) => {
    state.clipboard = text;
  } } },
  window: {
    createWebviewPanel: state.create,
    showInformationMessage: state.info,
    showWarningMessage: (...args: unknown[]) => {
      state.warning(...args); return Promise.resolve(state.confirmation);
    },
    showErrorMessage: state.error,
  },
}));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: class {
  async connect() {
    if (state.sdkFailure) {
      throw new Error('not listening');
    }
  }
  async listTools() {
    return { tools: [{}, {}] };
  }
  async callTool() {
    return { structuredContent: state.previews, isError: state.previewError };
  }
  async close() {
    if (state.closeFailure) {
      throw new Error('closed');
    }
  }
} }));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: class {
  terminateSession = state.terminate;
} }));
import { McpConnection, type McpConnectionStatus } from '../../src/app/mcp/McpConnection';

let status: McpConnectionStatus;
let connection: McpConnection;
let reconfigure: ReturnType<typeof vi.fn>;
const send = (message: unknown) => (connection as unknown as { handleMessage(message: unknown): Promise<void> }).handleMessage(message);
const latestState = () => state.posts.mock.calls.map(([value]) => value).filter(value => value.type === 'state').at(-1);
beforeEach(() => {
  vi.clearAllMocks(); state.secret = undefined; state.stored = []; state.commands.clear(); state.clipboard = '';
  state.sdkFailure = false; state.previewError = false; state.closeFailure = false; state.previews = undefined; state.confirmation = 'Regenerate';
  status = { enabled: true, trusted: true, ready: true, url: 'http://127.0.0.1:51474/mcp' };
  reconfigure = vi.fn();
  state.create.mockImplementation(() => ({
    reveal: state.reveal, dispose: () => state.closed?.(),
    onDidDispose: (callback: () => void) => {
      state.closed = callback;
    },
    webview: { html: '', postMessage: state.posts, onDidReceiveMessage: (callback: (value: unknown) => void) => {
      state.message = callback; return { dispose: state.disposeMessages };
    } },
  }));
  connection = new McpConnection({ secrets: {
    get: async () => state.secret,
    store: async (_key: string, value: string) => {
      state.secret = value; state.stored.push(value);
    },
    onDidChange: (callback: typeof state.secretChange) => {
      state.secretChange = callback; return { dispose() {} };
    },
  } } as never, reconfigure as () => void, () => status);
});
afterEach(() => {
  connection.dispose(); vi.useRealTimers();
});
async function open() {
 state.commands.get('shader-studio.connectAiAssistant')!(); await send({ action: 'ready' });
}

describe('generic AI connection', () => {
  it('terminates its verification session even if tool discovery fails', async () => {
    await send({ action: 'verify' });
    expect(state.terminate).toHaveBeenCalledOnce();
    state.previewError = true;
    await send({ action: 'verify' });
    expect(state.terminate).toHaveBeenCalledTimes(2);
    state.terminate.mockRejectedValueOnce(new Error('already closed'));
    await expect(send({ action: 'verify' })).resolves.toBeUndefined();
  });

  it('reuses and generates secrets without duplicating concurrent generation', async () => {
    state.secret = 'stored'; expect(await connection.getToken()).toBe('stored'); expect(state.stored).toEqual([]);
    state.secret = undefined;
    const tokens = await Promise.all([connection.getToken(), connection.getToken()]);
    expect(tokens[0]).toMatch(/^[a-f0-9]{64}$/); expect(tokens[0]).toBe(tokens[1]); expect(state.stored).toEqual([tokens[0]]);
  });
  it('opens a single panel and publishes ready state after the webview is listening', async () => {
    await open(); expect(latestState()).toMatchObject({ status: 'Waiting for an assistant', url: status.url, token: state.secret });
    expect(state.create).toHaveBeenCalledWith('shader-studio.aiConnection', 'AI connection', -1, { enableScripts: true, localResourceRoots: [] });
    state.commands.get('shader-studio.connectAiAssistant')!(); expect(state.create).toHaveBeenCalledOnce(); expect(state.reveal).toHaveBeenCalledOnce();
    expect(state.commands.has('shader-studio.copyCodexMcpConfig')).toBe(false);
  });
  it('copies the generic URL, raw token and a complete client independent setup prompt', async () => {
    await open();
    await send({ action: 'copyUrl' }); expect(state.clipboard).toBe(status.url);
    await send({ action: 'copyToken' }); expect(state.clipboard).toBe(state.secret);
    await send({ action: 'copyPrompt' });
    expect(state.clipboard).toContain(`Server URL: ${status.url}`); expect(state.clipboard).toContain(`Authorization header: Bearer ${state.secret}`);
    for (const text of ['no launch command', 'list_previews', 'read_documentation', 'restart', 'Do not claim', 'private local configuration']) {
      expect(state.clipboard).toContain(text);
    }
    expect(state.clipboard).not.toContain('config.toml');
  });
  it('never generates or shows secrets while disabled, untrusted, starting or unavailable', async () => {
    await open(); state.secret = undefined;
    for (const change of [{ enabled: false }, { enabled: true, trusted: false }, { trusted: true, ready: false }, { message: 'Port occupied.' }]) {
      status = { ...status, ...change }; await send({ action: 'ready' });
      expect(latestState()).toMatchObject({ ready: false, token: '', url: '' });
      await send({ action: 'copyToken' }); expect(state.clipboard).toBe('');
    }
    expect(state.secret).toBeUndefined(); expect(latestState().detail).toBe('Port occupied.');
  });
  it('persists explicit enable/disable changes and rejects untrusted enables and malformed messages', async () => {
    await open(); await send({ action: 'setEnabled', enabled: false });
    expect(state.update).toHaveBeenCalledWith('mcpEnabled', false, 1);
    status.trusted = false; await send({ action: 'setEnabled', enabled: true }); expect(state.update).toHaveBeenCalledOnce();
    for (const message of [null, 'copyToken', {}, { action: 'unknown' }, { action: 'setEnabled', enabled: 'true' }]) {
      await send(message);
    }
    expect(state.update).toHaveBeenCalledOnce();
    await send({ action: 'port' }); expect(state.execute).toHaveBeenCalledWith('workbench.action.openSettings', 'shader-studio.mcpPort');
  });
  it('refreshes session counts live and stops polling on close', async () => {
    vi.useFakeTimers(); await open(); status.connectedAssistants = 1;
    await vi.advanceTimersByTimeAsync(1000); expect(latestState()).toMatchObject({ status: 'Assistant connected', detail: '1 active assistant session.' });
    status.connectedAssistants = 2; await vi.advanceTimersByTimeAsync(1000); expect(latestState().detail).toBe('2 active assistant sessions.');
    status.connectedAssistants = 0; await vi.advanceTimersByTimeAsync(1000); expect(latestState().status).toBe('Waiting for an assistant');
    state.closed!(); const calls = state.posts.mock.calls.length; await vi.advanceTimersByTimeAsync(1000); expect(state.posts).toHaveBeenCalledTimes(calls);
    expect(state.disposeMessages).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('handles action and refresh failures without unhandled promises', async () => {
    vi.useFakeTimers(); await open(); state.execute.mockRejectedValueOnce(new Error('settings failed'));
    state.message!({ action: 'port' }); await vi.advanceTimersByTimeAsync(0);
    expect(state.posts).toHaveBeenCalledWith({ type: 'notice', text: 'Could not complete that action. Try again.' });
    state.posts.mockRejectedValueOnce(new Error('closed')); await vi.advanceTimersByTimeAsync(1000);
    expect(state.posts).toHaveBeenCalledWith({ type: 'notice', text: 'Could not refresh the connection.' });
  });
  it('ignores unrelated secret changes and regenerates only with confirmation', async () => {
    await open(); state.secretChange!({ key: 'other' }); expect(reconfigure).not.toHaveBeenCalled();
    state.confirmation = undefined; await send({ action: 'regenerate' }); expect(state.stored).toHaveLength(1);
    state.confirmation = 'Regenerate'; const old = state.secret; await send({ action: 'regenerate' }); expect(state.secret).not.toBe(old);
    state.secretChange!({ key: 'shader-studio.mcpToken' }); expect(reconfigure).toHaveBeenCalledOnce();
    status.enabled = false; await send({ action: 'regenerate' }); expect(state.stored).toHaveLength(2);
  });
  it('checks the server separately, with successful preview counts, SDK and tool error paths', async () => {
    state.previews = { previews: [{}, {}] }; state.closeFailure = true;
    await send({ action: 'verify' }); expect(state.info).toHaveBeenCalledWith('MCP connection verified: 2 tools available; 2 previews open.');
    state.previews = {}; await state.commands.get('shader-studio.verifyMcpConnection')!(); expect(state.info).toHaveBeenCalledWith(expect.stringContaining('preview status available'));
    state.previewError = true; await send({ action: 'verify' }); expect(state.error).toHaveBeenCalledOnce();
    state.sdkFailure = true; await send({ action: 'verify' }); expect(state.error).toHaveBeenCalledTimes(2);
    status.ready = false; await send({ action: 'verify' }); expect(state.warning).toHaveBeenCalledWith('Shader Studio MCP is not ready yet.');
  });
  it('discards secret reads if the panel closes or connection is disabled before completion', async () => {
    let resolve!: (value: string) => void;
    const pending = new Promise<string>(done => {
      resolve = done;
    });
    vi.spyOn(connection, 'getToken').mockReturnValue(pending);
    state.commands.get('shader-studio.connectAiAssistant')!();
    const refresh = send({ action: 'ready' }); status.enabled = false; resolve('private-token'); await refresh;
    expect(latestState()).toMatchObject({ token: '', ready: false });
    status.enabled = true; const late = send({ action: 'ready' }); state.closed!(); const calls = state.posts.mock.calls.length; await late;
    expect(state.posts).toHaveBeenCalledTimes(calls);
    await send({ action: 'ready' }); expect(state.posts).toHaveBeenCalledTimes(calls);
  });
  it('does not copy a token after access changes during a secret read', async () => {
    vi.spyOn(connection, 'getToken').mockImplementation(async () => {
      status.trusted = false; return 'private-token';
    });
    await send({ action: 'copyToken' }); expect(state.clipboard).toBe('');
  });
  it('disposes commands and the panel', async () => {
    await open(); connection.dispose(); expect(state.commands.size).toBe(0); expect(state.disposeMessages).toHaveBeenCalledOnce();
  });
});

describe('AI connection view', () => {
  it('renders a collapsed advanced section, masks credentials and sends only recognized UI actions', () => {
    const messages: unknown[] = [];
    const dom = new JSDOM(mcpConnectionHtml('test-nonce'), { runScripts: 'dangerously', beforeParse(window) {
      Object.assign(window, { acquireVsCodeApi: () => ({ postMessage: (message: unknown) => messages.push(message) }) });
    } });
    const document = dom.window.document;
    const input = (id: string) => document.getElementById(id) as HTMLInputElement;
    const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
    const publish = (data: unknown) => dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data }));
    expect(messages).toEqual([{ action: 'ready' }]); expect(document.querySelector('details')!.open).toBe(false);
    expect(button('copyToken').disabled).toBe(true); expect(document.querySelector('meta[http-equiv]')!.getAttribute('content')).toContain("default-src 'none'");
    publish({ type: 'unknown' });
    publish({ type: 'state', enabled: true, trusted: true, ready: true, status: 'Waiting for an assistant', detail: '<b>literal</b>', url: 'http://localhost/mcp', token: '<secret>' });
    expect(input('token').type).toBe('password'); expect(input('token').value).toBe('<secret>'); expect(document.getElementById('detail')!.innerHTML).toBe('&lt;b&gt;literal&lt;/b&gt;');
    button('reveal').click(); expect(input('token').type).toBe('text'); expect(button('reveal').textContent).toBe('Hide token');
    button('reveal').click(); expect(input('token').type).toBe('password');
    button('reveal').click();
    publish({ type: 'state', enabled: true, trusted: true, ready: true, status: 'Assistant connected', detail: '', url: 'x', token: 'changed' });
    expect(input('token').type).toBe('password');
    for (const action of ['copyUrl', 'copyToken', 'copyPrompt', 'port', 'verify', 'regenerate']) {
      button(action).click(); expect(messages.at(-1)).toEqual({ action });
    }
    input('enabled').checked = false; input('enabled').dispatchEvent(new dom.window.Event('change')); expect(messages.at(-1)).toEqual({ action: 'setEnabled', enabled: false });
    publish({ type: 'notice', text: 'Copied.' }); expect(document.getElementById('notice')!.textContent).toBe('Copied.');
    publish({ type: 'state', enabled: false, trusted: false, ready: false, status: 'Disabled', detail: '', url: '', token: '' });
    expect(input('enabled').disabled).toBe(true); expect(button('copyPrompt').disabled).toBe(true); expect(input('token').value).toBe('');
    dom.window.close();
  });
});
