import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js' with { 'resolution-mode': 'import' };
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js' with { 'resolution-mode': 'import' };
import { createMcpServer, type McpApplication } from './McpTools';

interface Activity { initialized: boolean; lastActive: number; requests: number; calls: number }
interface Session { server: McpServer; transport: StreamableHTTPServerTransport; activity: Activity }

const MAX_SESSIONS = 32;
const IDLE_TIMEOUT_MS = 30 * 60_000;
const INITIALIZATION_TIMEOUT_MS = 60_000;

/** Standard local MCP endpoint. Can also be mounted on an existing HTTP server. */
export class LocalMcpEndpoint {
  private listener?: Server;
  private sessions = new Map<string, Session>();
  private disposed = false;
  private generation = 0;
  private pendingSessions = 0;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(private readonly application: McpApplication, private readonly token: string) {
    if (token.length < 16) {
      throw new Error('MCP requires a private token of at least 16 characters. Run Shader Studio: Regenerate MCP Token.');
    }
  }

  /** Initialized protocol sessions, excluding our own endpoint verification. */
  get connectedAssistants(): number {
    return [...this.sessions.values()].filter(session => session.activity.initialized
      && session.server.server.getClientVersion()?.name !== 'shader-studio-connection-check').length;
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
      this.cleanupTimer = setInterval(() => this.expireSessions(), 60_000);
      this.cleanupTimer.unref();
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
    if (!this.authorize(request, fail)) {
      return;
    }
    this.expireSessions();
    const sessionId = request.headers['mcp-session-id'];
    const session = typeof sessionId === 'string' ? this.sessions.get(sessionId) : undefined;
    if (sessionId && !session) {
      fail(404, 'MCP session expired; reconnect.'); return;
    }
    if (session) {
      this.trackResponse(session, response);
    }
    try {
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
      if (!this.reserveCapacity()) {
        fail(429, 'All local MCP session slots are busy. Retry after active requests finish or close an unused client.'); return;
      }
      await this.initializeSession(request, response, body, generation);
    } catch {
      fail(500, 'MCP request failed. Reconnect and retry.');
    }
  }

  private async initializeSession(request: IncomingMessage, response: ServerResponse, body: unknown, generation: number): Promise<void> {
    let reserved = true;
    const releaseReservation = () => {
      if (reserved) {
        reserved = false;
        this.pendingSessions--;
      }
    };
    let session: Session | undefined;
    const activity: Activity = { initialized: false, lastActive: Date.now(), requests: 0, calls: 0 };
    try {
      const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
      const server = await createMcpServer({ call: async (...args) => {
        activity.calls++;
        try {
          return await this.application.call(...args);
        } finally {
          activity.calls--;
          activity.lastActive = Date.now();
        }
      } });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID, enableJsonResponse: true,
        onsessioninitialized: id => {
          if (!this.disposed && generation === this.generation) {
            releaseReservation();
            this.sessions.set(id, session!);
          }
        },
      });
      session = { server, transport, activity };
      server.server.oninitialized = () => {
        activity.initialized = true;
      };
      transport.onclose = () => {
        if (transport.sessionId) {
          this.sessions.delete(transport.sessionId);
        }
      };
      try {
        await server.connect(transport);
        if (this.disposed || generation !== this.generation) {
          response.writeHead(503, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: 'MCP is disabled.' }));
          await server.close();
          return;
        }
        this.trackResponse(session, response);
        await transport.handleRequest(request, response, body);
        // Invalid initialization can return an HTTP error without throwing.
        if (!transport.sessionId || !this.sessions.has(transport.sessionId)) {
          await server.close();
        }
      } catch (error) {
        await server.close(); throw error;
      }
    } finally {
      releaseReservation();
    }
  }

  /** Count the whole HTTP response lifetime, including open SSE streams. */
  private trackResponse(session: Session, response: ServerResponse): void {
    if (response.destroyed || response.writableFinished) {
      return;
    }
    session.activity.requests++;
    session.activity.lastActive = Date.now();
    const finished = () => {
      response.removeListener('finish', finished);
      response.removeListener('close', finished);
      session.activity.requests--;
      session.activity.lastActive = Date.now();
    };
    response.once('finish', finished);
    response.once('close', finished);
  }

  private isIdle(session: Session): boolean {
    return session.activity.requests === 0 && session.activity.calls === 0;
  }

  private removeSession(id: string, session: Session): void {
    this.sessions.delete(id);
    void session.server.close().catch(() => undefined);
  }

  private expireSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      const timeout = session.activity.initialized ? IDLE_TIMEOUT_MS : INITIALIZATION_TIMEOUT_MS;
      if (this.isIdle(session) && now - session.activity.lastActive >= timeout) {
        this.removeSession(id, session);
      }
    }
  }

  private reserveCapacity(): boolean {
    if (this.sessions.size + this.pendingSessions < MAX_SESSIONS) {
      this.pendingSessions++;
      return true;
    }
    // HTTP clients may disappear without DELETE. Reclaim the least recently
    // used idle session, never a stream or tool call that is still in flight.
    const idle = [...this.sessions].filter(([, session]) => this.isIdle(session))
      .sort(([, left], [, right]) => left.activity.lastActive - right.activity.lastActive)[0];
    if (!idle) {
      return false;
    }
    this.removeSession(...idle);
    this.pendingSessions++;
    return true;
  }

  private authorize(request: IncomingMessage, fail: (status: number, message: string) => void): boolean {
    const port = request.socket.localPort;
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!allowedHosts.includes(request.headers.host ?? '') || (request.headers.origin && !allowedHosts.some(host => request.headers.origin === `http://${host}`))) {
      fail(403, 'Only local MCP clients are allowed.');
      return false;
    }
    const expected = Buffer.from(`Bearer ${this.token}`);
    const supplied = Buffer.from(request.headers.authorization ?? '');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      fail(401, 'Configure the local MCP bearer token.');
      return false;
    }
    return true;
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
    clearInterval(this.cleanupTimer);
    this.cleanupTimer = undefined;
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(sessions.map(session => session.server.close()));
    const listener = this.listener;
    this.listener = undefined;
    if (listener) {
      listener.closeAllConnections();
      await new Promise<void>(resolve => listener.close(() => resolve()));
    }
  }
}
