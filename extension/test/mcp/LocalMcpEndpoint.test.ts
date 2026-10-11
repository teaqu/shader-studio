import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LocalMcpEndpoint } from '../../src/app/mcp/LocalMcpEndpoint';
import manifest from '../../package.json';
import { request } from 'node:http';

const token = 'test-local-private-token';
const endpoints: LocalMcpEndpoint[] = [];
afterEach(async () => {
  await Promise.all(endpoints.splice(0).map(endpoint => endpoint.dispose()));
});

async function fixture() {
  const call = vi.fn(async (operation: string, _args: Record<string, unknown>, _signal: AbortSignal) => operation === 'capture_output'
    ? { previewId: 'a', image: { data: 'cGl4ZWxz', mimeType: 'image/png' } } : { operation });
  const endpoint = new LocalMcpEndpoint({ call }, token);
  endpoints.push(endpoint);
  const port = await endpoint.start(0);
  const url = `http://127.0.0.1:${port}/mcp`;
  const client = new Client({ name: 'generic-test-agent', version: '1' });
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  return { endpoint, call, url, client, transport };
}

describe('Local MCP', () => {
  it('is off by default, persists user settings, and activates at startup', () => {
    const properties = manifest.contributes.configuration.properties;
    expect(properties['shader-studio.mcpEnabled']).toMatchObject({ default: false, scope: 'application' });
    expect(manifest.activationEvents).toContain('onStartupFinished');
    expect(properties['shader-studio.mcpToken'].scope).toBe('application');
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
