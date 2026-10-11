import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js' with { 'resolution-mode': 'import' };
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js' with { 'resolution-mode': 'import' };
import { createMcpServer, type McpApplication } from './McpTools';

interface Session { server: McpServer; transport: StreamableHTTPServerTransport }

/** Standard local MCP endpoint. Can also be mounted on an existing HTTP server. */
export class LocalMcpEndpoint {
  private listener?: Server;
  private sessions = new Map<string, Session>();
  private disposed = false;
  private generation = 0;

  constructor(private readonly application: McpApplication, private readonly token: string) {
    if (token.length < 16) {
      throw new Error('Set shader-studio.mcpToken to a private token of at least 16 characters before enabling MCP.');
    }
  }

  async start(port: number): Promise<number> {
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error('Invalid MCP port.');
    }
    if (this.listener) {
      throw new Error('MCP endpoint already started.');
    }
    this.disposed = false;
    const listener = createServer((request, response) => {
      void this.handle(request, response);
    });
    this.listener = listener;
    try {
      await new Promise<void>((resolve, reject) => {
        const failed = (error: Error) => {
          listener.removeListener('listening', ready); reject(error);
        };
        const ready = () => {
          listener.removeListener('error', failed); resolve();
        };
        listener.once('error', failed);
        listener.once('listening', ready);
        listener.listen(port, '127.0.0.1');
      });
      return (listener.address() as { port: number }).port;
    } catch (error) {
      this.listener = undefined; listener.close(); throw error;
    }
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const generation = this.generation;
    const fail = (status: number, message: string) => {
      if (!response.headersSent) {
        response.writeHead(status, { 'Content-Type': 'application/json' });
      }
      response.end(JSON.stringify({ error: message }));
    };
    if (this.disposed) {
      fail(503, 'MCP is disabled.'); return;
    }
    if (request.url?.split('?')[0] !== '/mcp') {
      fail(404, 'Not found.'); return;
    }
    const port = request.socket.localPort;
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!allowedHosts.includes(request.headers.host ?? '') || (request.headers.origin && !allowedHosts.some(host => request.headers.origin === `http://${host}`))) {
      fail(403, 'Only local MCP clients are allowed.'); return;
    }
    const expected = Buffer.from(`Bearer ${this.token}`);
    const supplied = Buffer.from(request.headers.authorization ?? '');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      fail(401, 'Configure the local MCP bearer token.'); return;
    }
    const sessionId = request.headers['mcp-session-id'];
    const session = typeof sessionId === 'string' ? this.sessions.get(sessionId) : undefined;
    if (sessionId && !session) {
      fail(404, 'MCP session expired; reconnect.'); return;
    }
    try {
      const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
      const { isInitializeRequest } = await import('@modelcontextprotocol/sdk/types.js');
      const parsed = await this.readBody(request, fail);
      if (!parsed.ok) {
        return;
      }
      const body = parsed.value;
      if (session) {
        await session.transport.handleRequest(request, response, body); return;
      }
      if (request.method !== 'POST' || !isInitializeRequest(body)) {
        fail(400, 'Initialize an MCP session first.'); return;
      }
      if (this.sessions.size >= 32) {
        fail(429, 'Too many local MCP sessions. Close unused clients.'); return;
      }
      const server = await createMcpServer(this.application);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID, enableJsonResponse: true,
        onsessioninitialized: id => {
          this.sessions.set(id, { server, transport });
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) {
          this.sessions.delete(transport.sessionId);
        }
      };
      await server.connect(transport);
      if (this.disposed || generation !== this.generation) {
        await server.close();
        fail(503, 'MCP is disabled.');
        return;
      }
      try {
        await transport.handleRequest(request, response, body);
      } catch (error) {
        await server.close(); throw error;
      }
    } catch {
      fail(500, 'MCP request failed. Reconnect and retry.');
    }
  }

  private async readBody(request: IncomingMessage, fail: (status: number, message: string) => void): Promise<{ ok: boolean; value?: unknown }> {
    if (request.method !== 'POST') {
      return { ok: true };
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 2_000_000) {
        fail(413, 'MCP request is too large.');
        return { ok: false };
      }
      chunks.push(Buffer.from(chunk));
    }
    try {
      return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
    } catch {
      fail(400, 'Invalid JSON.');
      return { ok: false };
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.generation++;
    await Promise.all([...this.sessions.values()].map(session => session.server.close()));
    this.sessions.clear();
    const listener = this.listener;
    this.listener = undefined;
    if (listener) {
      listener.closeAllConnections();
      await new Promise<void>(resolve => listener.close(() => resolve()));
    }
  }
}
