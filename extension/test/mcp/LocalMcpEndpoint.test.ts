import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LocalMcpEndpoint } from '../../src/app/mcp/LocalMcpEndpoint';
import manifest from '../../package.json';
import { request } from 'node:http';
import * as McpTools from '../../src/app/mcp/McpTools';

const token = 'test-local-private-token';
const endpoints: LocalMcpEndpoint[] = [];
const agents: { client: Client; transport: StreamableHTTPClientTransport }[] = [];
afterEach(async () => {
  for (const { client, transport } of agents.splice(0)) {
    await transport.terminateSession().catch(() => undefined);
    await client.close();
  }
  await Promise.all(endpoints.splice(0).map(endpoint => endpoint.dispose()));
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function fixture() {
  const call = vi.fn(async (operation: string, _args: Record<string, unknown>, _signal: AbortSignal): Promise<Record<string, unknown>> => operation === 'capture_output'
    ? { previewId: 'a', image: { data: 'cGl4ZWxz', mimeType: 'image/png' } } : { operation });
  const endpoint = new LocalMcpEndpoint({ call }, token);
  endpoints.push(endpoint);
  const port = await endpoint.start(0);
  const url = `http://127.0.0.1:${port}/mcp`;
  const client = new Client({ name: 'generic-test-agent', version: '1' });
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  return { endpoint, call, url, client, transport };
}

async function initialize(url: string, headers: Record<string, string> = {}) {
  return fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'abandoned-client', version: '1' } } }) });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

async function connectAgent(url: string, name: string, streaming = true) {
  const ready = deferred<void>();
  const client = new Client({ name, version: '1' });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: async (input, init) => {
      // HTTP clients are allowed to omit the optional server-notification stream.
      const response = init?.method === 'GET' && !streaming ? new Response(null, { status: 405 }) : await fetch(input, init);
      if (init?.method === 'GET') {
        ready.resolve();
      }
      return response;
    },
  });
  agents.push({ client, transport });
  await client.connect(transport);
  await ready.promise;
  return { client, transport };
}

describe('Local MCP', () => {
  it('recovers from clients closing without DELETE while preserving a live assistant stream', async () => {
    const { endpoint, url } = await fixture();
    const live = await connectAgent(url, 'live-assistant');
    for (let index = 0; index < 40; index++) {
      const agent = await connectAgent(url, 'client-that-disappears');
      await agent.client.close(); // deliberately no terminateSession
    }
    await expect(live.client.listTools()).resolves.toHaveProperty('tools');
    const newClient = await connectAgent(url, 'new-assistant');
    await expect(newClient.client.listTools()).resolves.toHaveProperty('tools');
    expect(endpoint.connectedAssistants).toBeLessThanOrEqual(32);
  });

  it('expires incomplete handshakes and idle POST-only sessions without expiring live streams', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const { endpoint, url } = await fixture();
    const partial = await initialize(url);
    await partial.json();
    const headers = { Authorization: `Bearer ${token}`, 'mcp-session-id': partial.headers.get('mcp-session-id')! };
    const live = await connectAgent(url, 'live-stream');
    const idle = await connectAgent(url, 'post-only', false);
    expect(endpoint.connectedAssistants).toBe(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await fetch(url, { headers })).status).toBe(404);
    await vi.advanceTimersByTimeAsync(29 * 60_000);
    expect(endpoint.connectedAssistants).toBe(1);
    await expect(live.client.listTools()).resolves.toHaveProperty('tools');
    await expect(idle.client.listTools()).rejects.toMatchObject({ code: 404 });
    await endpoint.dispose();
    expect(vi.getTimerCount()).toBe(0);
    const port = await endpoint.start(0);
    expect(port).toBeGreaterThan(0);
    await endpoint.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps active tool calls alive under expiry and session pressure, even when their HTTP request is aborted', async () => {
    const { call, url } = await fixture();
    const busy = await connectAgent(url, 'busy-assistant', false);
    const pending = deferred<Record<string, unknown>>();
    call.mockImplementationOnce(() => pending.promise);
    const controller = new AbortController();
    const operation = fetch(url, { method: 'POST', signal: controller.signal, headers: {
      Authorization: `Bearer ${token}`, 'mcp-session-id': busy.transport.sessionId!, 'mcp-protocol-version': busy.transport.protocolVersion!,
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_previews', arguments: {} } }) }).catch(() => undefined);
    try {
      await vi.waitFor(() => expect(call).toHaveBeenCalledOnce());
      controller.abort(); await operation;
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now + 31 * 60_000);
      for (let index = 0; index < 40; index++) {
        const response = await initialize(url);
        expect(response.status).toBe(200);
        await response.json();
      }
      await expect(busy.client.listTools()).resolves.toHaveProperty('tools');
    } finally {
      pending.resolve({ done: true });
      await vi.waitFor(() => expect(call.mock.results[0].value).resolves.toEqual({ done: true }));
    }
  });

  it('retains the hard limit when every slot has a live stream and admits a client after explicit termination', async () => {
    const { endpoint, url } = await fixture();
    const live = await Promise.all(Array.from({ length: 32 }, (_, index) => connectAgent(url, `live-${index}`)));
    expect(endpoint.connectedAssistants).toBe(32);
    const response = await initialize(url);
    expect(response.status).toBe(429);
    await response.json();
    await live[0].transport.terminateSession();
    await live[0].client.close();
    const replacement = await connectAgent(url, 'replacement');
    await expect(replacement.client.listTools()).resolves.toHaveProperty('tools');
    await expect(live[1].client.listTools()).resolves.toHaveProperty('tools');
  });

  it('reserves initialization slots before awaiting server creation', async () => {
    const { url } = await fixture();
    const original = McpTools.createMcpServer;
    const gate = deferred<void>();
    vi.spyOn(McpTools, 'createMcpServer').mockImplementation(async application => {
      await gate.promise;
      return original(application);
    });
    const rejected: number[] = [];
    const requests = Array.from({ length: 40 }, () => initialize(url).then(async response => {
      if (response.status === 429) {
        rejected.push(response.status);
      }
      await response.json();
      return response.status;
    }));
    try {
      await vi.waitFor(() => expect(rejected).toHaveLength(8));
      expect(McpTools.createMcpServer).toHaveBeenCalledTimes(32);
    } finally {
      gate.resolve();
      await Promise.all(requests);
    }
    expect((await Promise.all(requests)).filter(status => status === 200)).toHaveLength(32);
  });

  it('closes rejected initialization servers and releases slots after setup failures', async () => {
    const { url } = await fixture();
    const original = McpTools.createMcpServer;
    const closes: ReturnType<typeof vi.spyOn>[] = [];
    const create = vi.spyOn(McpTools, 'createMcpServer').mockImplementation(async application => {
      const server = await original(application);
      closes.push(vi.spyOn(server, 'close'));
      return server;
    });
    const invalid = await initialize(url, { Accept: 'application/json' });
    expect(invalid.status).toBe(406);
    await invalid.json();
    await vi.waitFor(() => expect(closes[0]).toHaveBeenCalledOnce());
    create.mockRejectedValue(new Error('Server setup failed'));
    for (let index = 0; index < 40; index++) {
      const failed = await initialize(url);
      expect(failed.status).toBe(500);
      await failed.json();
    }
    create.mockRestore();
    const client = await connectAgent(url, 'after-errors');
    await expect(client.client.listTools()).resolves.toHaveProperty('tools');
  });

  it('reclaims orphaned sessions at capacity instead of permanently blocking new clients', async () => {
    const { endpoint, url } = await fixture();
    const ids: string[] = [];
    for (let index = 0; index < 40; index++) {
      const response = await initialize(url);
      expect(response.status).toBe(200);
      ids.push(response.headers.get('mcp-session-id')!);
      await response.json();
      // No DELETE: models clients that disappear or never finish initialization.
    }
    const stale = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'mcp-session-id': ids[0] } });
    expect(stale.status).toBe(404);
    const agent = new Client({ name: 'recovered-client', version: '1' });
    const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
    try {
      await agent.connect(transport);
      await expect(agent.listTools()).resolves.toHaveProperty('tools');
      expect(endpoint.connectedAssistants).toBe(1);
    } finally {
      await transport.terminateSession();
      await agent.close();
    }
  });

  it('counts completed assistant handshakes, removes ended sessions, and excludes local verification', async () => {
    const { endpoint, client, transport, url } = await fixture();
    expect(endpoint.connectedAssistants).toBe(0);
    expect((await fetch(url)).status).toBe(401);
    expect((await fetch(url, { headers: { Authorization: 'Bearer incorrect-token' } })).status).toBe(401);
    expect(endpoint.connectedAssistants).toBe(0);
    await client.connect(transport);
    await client.listTools();
    expect(endpoint.connectedAssistants).toBe(1);
    const verifier = new Client({ name: 'shader-studio-connection-check', version: '1' });
    const verification = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
    await verifier.connect(verification);
    await verifier.listTools();
    expect(endpoint.connectedAssistants).toBe(1);
    await verification.terminateSession(); await verifier.close();
    await transport.terminateSession(); await client.close();
    expect(endpoint.connectedAssistants).toBe(0);
    await endpoint.dispose();
    expect(endpoint.connectedAssistants).toBe(0);
  });

  it('does not count incomplete initialization as an assistant connection', async () => {
    const { endpoint, url } = await fixture();
    const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'pending-agent', version: '1' } } }) });
    expect(response.status).toBe(200);
    expect(endpoint.connectedAssistants).toBe(0);
  });
  it('is off by default, persists user settings, and activates at startup', () => {
    const properties = manifest.contributes.configuration.properties;
    expect(properties['shader-studio.mcpEnabled']).toMatchObject({ default: false, scope: 'application' });
    expect(manifest.activationEvents).toContain('onStartupFinished');
    expect(properties).not.toHaveProperty('shader-studio.mcpToken');
    expect(() => new LocalMcpEndpoint({ call: vi.fn() }, 'short')).toThrow('16 characters');
  });

  it('supports standard initialization, tool discovery, validation, file edits and image content', async () => {
    const { client, transport, call } = await fixture();
    await client.connect(transport);
    const names = (await client.listTools()).tools.map(tool => tool.name);
    expect(names).toContain('update_file');
    expect(names).not.toContain('update_shader');
    expect(names).toContain('capture_output');
    const image = await client.callTool({ name: 'capture_output', arguments: {} });
    expect(image.content).toContainEqual({ type: 'image', mimeType: 'image/png', data: 'cGl4ZWxz' });
    expect(image.structuredContent).toEqual({ previewId: 'a' });
    const edit = await client.callTool({ name: 'update_file', arguments: { path: '/shader', text: 'new', expectedRevision: 'revision' } });
    expect(edit.isError).not.toBe(true);
    const invalid = await client.callTool({ name: 'update_file', arguments: { path: '/shader', text: 'new' } });
    expect(invalid.isError).toBe(true);
    call.mockRejectedValueOnce(new Error('Revision changed'));
    const failed = await client.callTool({ name: 'read_file', arguments: { path: '/shader' } });
    expect(failed).toMatchObject({ isError: true, content: [{ type: 'text', text: 'Revision changed' }] });
    expect(call.mock.calls[0][2]).toBeInstanceOf(AbortSignal);
    await transport.terminateSession();
    await client.close();
  });

  it('rejects missing tokens, non-local origins/hosts, stale sessions and invalid requests', async () => {
    const { url } = await fixture();
    const auth = { Authorization: `Bearer ${token}` };
    expect((await fetch(url)).status).toBe(401);
    expect((await fetch(url, { headers: { ...auth, Origin: 'https://evil.example' } })).status).toBe(403);
    const foreignHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(url, { headers: { ...auth, Host: 'evil.example' } }, res => {
        res.resume(); resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end();
    });
    expect(foreignHostStatus).toBe(403);
    expect((await fetch(`${url}/other`, { headers: auth })).status).toBe(404);
    expect((await fetch(url, { headers: { ...auth, 'mcp-session-id': 'missing' } })).status).toBe(404);
    expect((await fetch(url, { headers: auth })).status).toBe(400);
    expect((await fetch(url, { method: 'POST', headers: auth, body: 'bad' })).status).toBe(400);
    expect((await fetch(url, { method: 'POST', headers: auth, body: '{}' })).status).toBe(400);
    expect((await fetch(url, { method: 'POST', headers: auth, body: ' '.repeat(2_000_001) })).status).toBe(413);
  });

  it('releases its listener and sessions on disable, allowing startup again', async () => {
    const { endpoint, client, transport, url } = await fixture();
    await client.connect(transport);
    await endpoint.dispose();
    await expect(fetch(url)).rejects.toThrow();
    await client.close();
    const port = Number(new URL(url).port);
    expect(await endpoint.start(port)).toBe(port);
    await endpoint.dispose();
  });

  it('reports invalid ports, duplicate starts and port conflicts', async () => {
    const { endpoint, url } = await fixture();
    await expect(endpoint.start(-1)).rejects.toThrow('Invalid');
    await expect(endpoint.start(0)).rejects.toThrow('already');
    const other = new LocalMcpEndpoint({ call: vi.fn() }, token);
    endpoints.push(other);
    await expect(other.start(Number(new URL(url).port))).rejects.toThrow();
  });
});
