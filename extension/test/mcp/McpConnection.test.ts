import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  secret: undefined as string | undefined,
  stored: [] as string[],
  commands: new Map<string, () => unknown>(),
  clipboard: '',
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  execute: vi.fn(),
  infoChoice: undefined as string | undefined,
  secretChange: undefined as undefined | ((event: { key: string }) => void),
  sdkFailure: undefined as Error | undefined,
  closeFailure: undefined as Error | undefined,
  previews: undefined as unknown,
  previewError: false,
  confirmation: 'Regenerate' as string | undefined,
}));

vi.mock('vscode', () => ({
  commands: {
    registerCommand: (id: string, command: () => unknown) => {
      state.commands.set(id, command);
      return { dispose: () => state.commands.delete(id) };
    },
    executeCommand: state.execute,
  },
  env: { clipboard: { writeText: async (text: string) => {
    state.clipboard = text;
  } } },
  window: {
    showInformationMessage: (...args: unknown[]) => {
      state.info(...args);
      return Promise.resolve(state.infoChoice);
    },
    showWarningMessage: (...args: unknown[]) => {
      state.warning(...args);
      return Promise.resolve(state.confirmation);
    },
    showErrorMessage: (...args: unknown[]) => {
      state.error(...args);
      return Promise.resolve(undefined);
    },
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    async connect() {
      if (state.sdkFailure) {
        throw state.sdkFailure;
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
        throw state.closeFailure;
      }
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {
    constructor(_url: URL, _options: unknown) {}
  },
}));

import { McpConnection, type McpConnectionStatus } from '../../src/app/mcp/McpConnection';

let status: McpConnectionStatus;
let reconfigure: ReturnType<typeof vi.fn>;
let connection: McpConnection;

beforeEach(() => {
  vi.clearAllMocks(); state.secretChange = undefined; state.infoChoice = undefined; state.sdkFailure = undefined; state.closeFailure = undefined; state.previews = undefined; state.previewError = false;
  state.secret = undefined; state.stored = []; state.commands.clear(); state.clipboard = ''; state.confirmation = 'Regenerate';
  status = { enabled: true, trusted: true, ready: true, url: 'http://127.0.0.1:51474/mcp' };
  reconfigure = vi.fn();
  connection = new McpConnection({
    secrets: {
      get: async () => state.secret,
      store: async (_key: string, value: string) => {
        state.secret = value;
        state.stored.push(value);
      },
      onDidChange: (listener: (event: { key: string }) => void) => {
        state.secretChange = listener;
        return { dispose() {} };
      },
    },
  } as never, reconfigure as () => void, () => status);
});

describe('McpConnection', () => {
  it('reuses the stored secret and generates a private token only when absent', async () => {
    state.secret = 'kept-secret';
    await expect(connection.getToken()).resolves.toBe('kept-secret');
    expect(state.stored).toEqual([]);
    state.secret = undefined;
    const token = await connection.getToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(state.stored).toEqual([token]);
    await expect(connection.getToken()).resolves.toBe(token);
    expect(state.stored).toHaveLength(1);
  });

  it('shares concurrent initial token generation', async () => {
    const tokens = await Promise.all([connection.getToken(), connection.getToken(), connection.getToken()]);
    expect(tokens[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(new Set(tokens).size).toBe(1);
    expect(state.stored).toEqual([tokens[0]]);
  });

  it('copies Codex TOML and Claude Code JSON only through explicit commands', async () => {
    await state.commands.get('shader-studio.copyCodexMcpConfig')!();
    expect(state.clipboard).toContain('[mcp_servers.shader-studio]');
    expect(state.clipboard).toContain('Authorization = "Bearer ');
    expect(state.clipboard).toContain('127.0.0.1:51474/mcp');
    await state.commands.get('shader-studio.copyClaudeCodeMcpConfig')!();
    expect(JSON.parse(state.clipboard)).toMatchObject({ mcpServers: { 'shader-studio': { type: 'http', url: status.url } } });
  });

  it('escapes stored credentials safely for TOML', async () => {
    state.secret = 'quote"\nnewline';
    await state.commands.get('shader-studio.copyCodexMcpConfig')!();
    expect(state.clipboard).toContain('Authorization = "Bearer quote\\"\\nnewline"');
  });

  it('does not create or copy a credential when MCP is disabled or unavailable', async () => {
    status = { ...status, enabled: false };
    await state.commands.get('shader-studio.copyCodexMcpConfig')!();
    expect(state.secret).toBeUndefined();
    expect(state.clipboard).toBe('');
    status = { ...status, enabled: true, ready: false, message: 'Port is occupied.' };
    await state.commands.get('shader-studio.copyCodexMcpConfig')!();
    expect(state.warning).toHaveBeenCalledWith('Port is occupied.');
    status = { ...status, ready: true, trusted: false };
    await state.commands.get('shader-studio.copyCodexMcpConfig')!();
    expect(state.secret).toBeUndefined();
    expect(state.warning).toHaveBeenCalledWith('Trust this workspace before copying or regenerating the MCP token.');
  });

  it('regenerates after confirmation and requests endpoint reconfiguration', async () => {
    state.secret = 'previous-token';
    await state.commands.get('shader-studio.regenerateMcpToken')!();
    expect(state.secret).toMatch(/^[a-f0-9]{64}$/);
    expect(state.secret).not.toBe('previous-token');
    expect(reconfigure).not.toHaveBeenCalled();
    state.secretChange!({ key: 'shader-studio.mcpToken' });
    expect(reconfigure).toHaveBeenCalledOnce();
  });

  it('guides disabled, untrusted, and starting connections without copying a token', async () => {
    status = { ...status, enabled: false }; state.infoChoice = 'Open Settings';
    await state.commands.get('shader-studio.connectAiAssistant')!();
    expect(state.execute).toHaveBeenCalledWith('workbench.action.openSettings', 'shader-studio.mcpEnabled');
    status = { ...status, enabled: true, trusted: false };
    await state.commands.get('shader-studio.connectAiAssistant')!();
    expect(state.warning).toHaveBeenCalledWith('Trust this workspace before connecting an AI assistant to Shader Studio MCP.');
    status = { ...status, trusted: true, ready: false, message: 'Starting MCP.' };
    await state.commands.get('shader-studio.connectAiAssistant')!();
    expect(state.warning).toHaveBeenCalledWith('Starting MCP.');
    expect(state.secret).toBeUndefined();
  });

  it('opens copy and cancellation flows from the setup command', async () => {
    state.infoChoice = 'Copy Codex TOML';
    await state.commands.get('shader-studio.connectAiAssistant')!();
    expect(state.clipboard).toContain('[mcp_servers.shader-studio]');
    state.infoChoice = 'Copy Claude Code JSON';
    await state.commands.get('shader-studio.connectAiAssistant')!();
    expect(JSON.parse(state.clipboard).mcpServers['shader-studio'].type).toBe('http');
    state.confirmation = undefined;
    await state.commands.get('shader-studio.regenerateMcpToken')!();
    expect(reconfigure).not.toHaveBeenCalled();
  });

  it('reports a failed local verification without throwing', async () => {
    state.sdkFailure = new Error('not listening');
    await expect(state.commands.get('shader-studio.verifyMcpConnection')!()).resolves.toBeUndefined();
    expect(state.error).toHaveBeenCalledWith('Could not verify the MCP connection. Check that Shader Studio MCP is running, then try again.');
  });

  it('does not claim success when list_previews reports an MCP error', async () => {
    state.previewError = true;
    await expect(state.commands.get('shader-studio.verifyMcpConnection')!()).resolves.toBeUndefined();
    expect(state.error).toHaveBeenCalledWith('Could not verify the MCP connection. Check that Shader Studio MCP is running, then try again.');
  });

  it('does not verify or regenerate when the connection is not usable', async () => {
    status = { ...status, ready: false };
    await state.commands.get('shader-studio.verifyMcpConnection')!();
    expect(state.warning).toHaveBeenCalledWith('Shader Studio MCP is not ready yet.');
    status = { ...status, enabled: false };
    await state.commands.get('shader-studio.regenerateMcpToken')!();
    expect(state.warning).toHaveBeenCalledWith('Enable Shader Studio MCP before copying or regenerating its token.');
  });

  it('reports verified tools and preview state and absorbs close failures', async () => {
    state.previews = { previews: [{}, {}] }; state.closeFailure = new Error('close failed');
    await expect(state.commands.get('shader-studio.verifyMcpConnection')!()).resolves.toBeUndefined();
    expect(state.info).toHaveBeenCalledWith('MCP connection verified: 2 tools available; 2 previews open.');
    state.previews = { unexpected: true };
    await state.commands.get('shader-studio.verifyMcpConnection')!();
    expect(state.info).toHaveBeenCalledWith('MCP connection verified: 2 tools available; preview status available.');
  });

  it('dispatches verification and regeneration from the setup choices', async () => {
    state.infoChoice = 'Verify Connection';
    await state.commands.get('shader-studio.connectAiAssistant')!();
    expect(state.info).toHaveBeenCalledWith('MCP connection verified: 2 tools available; preview status available.');
    state.infoChoice = 'Regenerate Token';
    await state.commands.get('shader-studio.connectAiAssistant')!();
    expect(state.stored).toHaveLength(2);
  });

  it('registers a setup command and disposes all commands', () => {
    expect(state.commands.has('shader-studio.connectAiAssistant')).toBe(true);
    connection.dispose();
    expect(state.commands.size).toBe(0);
  });
});
