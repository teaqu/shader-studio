import { describe, it, expect, vi } from 'vitest';
import type * as vscode from 'vscode';
import type { Server } from 'node:http';
import { WebServer } from '../../src/app/WebServer';
import { Logger } from '../../src/app/services/Logger';
vi.mock('../../src/app/ShaderStudioStatusBar', () => ({ ShaderStudioStatusBar: class {
  updateServerStatus() {} 
} }));
vi.mock('vscode', () => ({ Uri: { joinPath: () => ({ fsPath: '/missing-ui' }) } }));

describe('web server MCP mount', () => {
  it('delegates MCP methods to the shared endpoint and removes it when disabled', async () => {
    Logger.initialize({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as vscode.LogOutputChannel);
    const server = new WebServer({ extensionUri: {} } as vscode.ExtensionContext);
    // Use an ephemeral real listener to test HTTP dispatch without a built UI bundle.
    const internals = server as unknown as { startHttpServer(port: number): void; httpServer: Server };
    internals.startHttpServer(0);
    await new Promise<void>(resolve => internals.httpServer.once('listening', resolve));
    const port = (internals.httpServer.address() as { port: number }).port;
    const url = `http://127.0.0.1:${port}`;
    try {
      expect((await fetch(`${url}/mcp`, { method: 'POST' })).status).toBe(405);
      const handler = vi.fn(async (_request, response) => {
        response.writeHead(202); response.end('mcp'); 
      });
      server.setMcpHandler(handler);
      for (const method of ['GET', 'POST', 'DELETE']) {
        expect((await fetch(`${url}/mcp?test=1`, { method })).status).toBe(202);
      }
      expect(handler).toHaveBeenCalledTimes(3);
      expect((await fetch(`${url}/other`, { method: 'POST' })).status).toBe(405);
      server.setMcpHandler(undefined);
      expect((await fetch(`${url}/mcp`, { method: 'POST' })).status).toBe(405);
    } finally {
      internals.httpServer.closeAllConnections();
      await new Promise<void>(resolve => internals.httpServer.close(() => resolve()));
    }
  });
});
