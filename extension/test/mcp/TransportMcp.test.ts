import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { WebSocket } from 'ws';
import { join, resolve } from 'node:path';
import { WebviewTransport } from '../../src/app/transport/WebviewTransport';
import { WebSocketTransport } from '../../src/app/transport/WebSocketTransport';
import { Messenger } from '../../src/app/transport/Messenger';
import { mcpLogs } from '../../src/app/mcp/McpLogs';
import { PreviewRegistry } from '../../src/app/mcp/PreviewRegistry';
import type { ShaderProvider } from '../../src/app/ShaderProvider';
import type { GlslFileTracker } from '../../src/app/GlslFileTracker';
import type { ErrorHandler } from '../../src/app/ErrorHandler';

const mocks = vi.hoisted(() => ({ handle: vi.fn(async () => {}), message: vi.fn() }));
vi.mock('../../src/app/ClientMessageHandler', () => ({ ClientMessageHandler: class {
  handle = mocks.handle;
} }));
vi.mock('../../src/app/transport/MessageHandler', () => ({ MessageHandler: class {
  handleMessage = mocks.message;
} }));
vi.mock('../../src/language-services/ShaderAuthoringEnvironmentProvider', () => ({ publishLoadedShaderProjectSnapshot: vi.fn() }));
vi.mock('../../src/app/transport/ConfigPathConverter', () => ({ ConfigPathConverter: { processConfigPaths: async (message: unknown) => message } }));
vi.mock('../../src/app/PathResolver', () => ({ PathResolver: class {} }));

afterEach(() => {
  mcpLogs.setEnabled(false); vi.restoreAllMocks(); vi.useRealTimers();
});
function panel() {
  let receive: (message: unknown) => void = () => {};
  let disposed: () => void = () => {};
  const fake = {
    webview: { postMessage: vi.fn(), onDidReceiveMessage: (callback: typeof receive) => {
      receive = callback;
    } },
    onDidDispose: (callback: typeof disposed) => {
      disposed = callback;
    }, dispose: () => disposed(),
  };
  return { fake, value: fake as unknown as vscode.WebviewPanel, receive: (message: unknown) => receive(message) };
}

describe('MCP transport routing', () => {
  it('does not attach preview tracking while MCP is disabled', () => {
    const messenger = new Messenger({} as vscode.LogOutputChannel, {} as ErrorHandler);
    const transport = { attachPreviewRegistry: vi.fn(), send: vi.fn(), close: vi.fn(), onMessage: vi.fn(), hasActiveClients: () => true };
    messenger.addTransport(transport);
    expect(transport.attachPreviewRegistry).not.toHaveBeenCalled();
    messenger.close();
  });

  it('cleans up previews whose panels become unavailable while sending', () => {
    const transport = new WebviewTransport();
    const registry = new PreviewRegistry(); transport.attachPreviewRegistry(registry);
    const working = panel(); const missing = panel(); const throwing = panel();
    transport.addPanel(working.value); transport.addPanel(missing.value); transport.addPanel(throwing.value);
    // A disposed VS Code panel can lose its webview or throw on postMessage.
    Object.assign(missing.value, { webview: undefined });
    throwing.fake.webview.postMessage.mockImplementation(() => {
      throw new Error('disposed');
    });
    transport.send({ type: 'reset' });
    expect(working.fake.webview.postMessage).toHaveBeenCalledWith({ type: 'reset' });
    expect(registry.list()).toHaveLength(1);
    missing.receive({ type: 'log', payload: 'late message' });
    working.fake.dispose = () => {
      throw new Error('already disposed');
    };
    transport.close(); expect(registry.list()).toEqual([]);
    const unattached = new WebviewTransport(); const plain = panel();
    unattached.addPanel(plain.value); plain.receive({ type: 'log', payload: 'ordinary message' }); unattached.close();
  });

  it('registers existing/new panels, correlates responses, and unregisters disposed panels', async () => {
    const transport = new WebviewTransport(); const first = panel(); const second = panel();
    transport.addPanel(first.value);
    const registry = new PreviewRegistry(); transport.attachPreviewRegistry(registry);
    transport.attachPreviewRegistry(registry); transport.addPanel(second.value);
    expect(registry.list()).toHaveLength(2);
    const handler = vi.fn(); transport.onMessage(handler);
    const id = registry.list()[0].id;
    const result = registry.request(id, 'get_state');
    const request = first.fake.webview.postMessage.mock.calls[0][0];
    expect(second.fake.webview.postMessage).not.toHaveBeenCalled();
    second.receive({ type: 'viewerRpcResponse', requestId: request.requestId, result: { path: 'wrong' } });
    first.receive({ type: 'viewerRpcResponse', requestId: request.requestId, result: { path: 'correct' } });
    await expect(result).resolves.toEqual({ path: 'correct' });
    first.fake.webview.postMessage.mockClear(); second.fake.webview.postMessage.mockClear();
    await registry.sendSource(id, { type: 'shaderSource', path: '/selected.glsl', config: {} });
    expect(first.fake.webview.postMessage).toHaveBeenCalledWith({ type: 'shaderSource', path: '/selected.glsl', config: {} });
    expect(second.fake.webview.postMessage).not.toHaveBeenCalled();
    await registry.sendSource(id, { type: 'customUniformValues', payload: { values: { amount: 1 } } });
    expect(first.fake.webview.postMessage).toHaveBeenLastCalledWith({ type: 'customUniformValues', payload: { values: { amount: 1 } } });
    expect(handler).not.toHaveBeenCalled();
    first.receive({ type: 'log', message: 'viewer log' }); expect(handler).toHaveBeenCalledOnce();
    first.fake.dispose(); expect(registry.list()).toHaveLength(1);
    transport.close(); expect(registry.list()).toEqual([]);
    transport.removePanel(second.value);
  });

  it('toggles existing panels, cancels pending requests and discards diagnostic collection', async () => {
    const messenger = new Messenger({} as vscode.LogOutputChannel, {} as ErrorHandler);
    const transport = new WebviewTransport(); const first = panel();
    transport.addPanel(first.value); messenger.addTransport(transport);
    expect(() => messenger.previews).toThrow('disabled');
    messenger.setMcpEnabled(true);
    const registry = messenger.previews;
    expect(registry.list()).toHaveLength(1);
    messenger.setMcpEnabled(true); expect(messenger.previews).toBe(registry);
    expect(mcpLogs.read({}).collecting).toBe(false);
    mcpLogs.start(); first.receive({ type: 'log', payload: 'collected' });
    expect(mcpLogs.read({}).entries).toHaveLength(1);
    const pending = registry.request(registry.select(), 'get_state');
    const rejected = expect(pending).rejects.toThrow('closed');
    messenger.setMcpEnabled(false); await rejected;
    expect(registry.list()).toEqual([]);
    expect(mcpLogs.read({})).toMatchObject({ collecting: false, entries: [] });
    first.receive({ type: 'log', payload: 'disabled' });
    expect(mcpLogs.read({}).entries).toEqual([]);
    const handler = vi.fn(); transport.onMessage(handler);
    transport.send({ type: 'reset' }); first.receive({ type: 'log', payload: 'ordinary' });
    expect(first.fake.webview.postMessage).toHaveBeenLastCalledWith({ type: 'reset' });
    expect(handler).toHaveBeenCalledOnce();
    messenger.setMcpEnabled(true);
    expect(messenger.previews).not.toBe(registry);
    expect(messenger.previews.list()).toHaveLength(1);
    expect(mcpLogs.read({}).collecting).toBe(false);
    const nextRegistry = messenger.previews;
    messenger.removeTransport(transport); expect(nextRegistry.list()).toEqual([]);
    messenger.close(); transport.close();
  });

  it('attaches the registry to transports and tracks source compile sequences', () => {
    const errors = { setShaderConfig: vi.fn() } as unknown as ErrorHandler;
    const messenger = new Messenger({} as vscode.LogOutputChannel, errors);
    const transport = { attachPreviewRegistry: vi.fn(), send: vi.fn(), close: vi.fn(), onMessage: vi.fn(), hasActiveClients: () => true };
    messenger.addTransport(transport);
    messenger.setMcpEnabled(true);
    expect(transport.attachPreviewRegistry).toHaveBeenCalledWith(messenger.previews);
    transport.onMessage.mock.calls[0][0]({ type: 'log' }); expect(mocks.message).toHaveBeenCalled();
    messenger.send({ type: 'shaderSource', path: '/main', compileSequence: 4, config: {} });
    expect(messenger.getCompileSequence('/main')).toBe(4);
    messenger.send({ type: 'shaderSource', path: '/main' });
    expect(messenger.getCompileSequence('/main')).toBe(4);
    const sendSource = vi.fn(async () => {});
    messenger.previews.register({ id: 'selected', kind: 'webview', send: vi.fn(), sendSource });
    return messenger.send({ type: 'customUniformValues', payload: { values: { amount: 1 } } }, 'selected').then(() => {
      expect(sendSource).toHaveBeenCalledWith({ type: 'customUniformValues', payload: { values: { amount: 1 } } });
      expect(transport.send).toHaveBeenCalledTimes(2);
      messenger.close(); expect(transport.close).toHaveBeenCalledOnce();
    });
  });

  it('maps packaged browser assets through the UI route', () => {
    (vscode.workspace as unknown as { getConfiguration: () => { get: () => number } }).getConfiguration = () => ({ get: () => 4567 });
    const transport = Object.create(WebSocketTransport.prototype) as WebSocketTransport;
    const extensionPath = resolve('/extension');
    (transport as unknown as { extensionPath: string }).extensionPath = extensionPath;
    expect(transport.convertUriForClient(join(extensionPath, 'ui-dist', 'assets', 'nebula-texture.png'))).toBe('http://localhost:4567/assets/nebula-texture.png');
    expect(transport.convertUriForClient('/workspace/image.png')).toBe('http://localhost:4567/textures/%2Fworkspace%2Fimage.png');
  });

  it('routes MCP directly over a connected browser socket and cleans up on disconnect', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    // Isolate source loading; the actual loopback socket and connection routing are exercised.
    vi.spyOn(WebSocketTransport.prototype as unknown as { sendCurrentShaderToNewClient(): void }, 'sendCurrentShaderToNewClient').mockImplementation(() => {});
    let resolveListening!: (port: number) => void;
    const listening = new Promise<number>(resolve => {
      resolveListening = resolve;
    });
    const transport = new WebSocketTransport(0, {} as ShaderProvider, {} as GlslFileTracker, {} as vscode.ExtensionContext, '/extension', resolveListening);
    const registry = new PreviewRegistry();
    transport.setAllowedWebServerPort(12345);
    const client = new WebSocket(`ws://127.0.0.1:${await listening}`, { origin: 'http://127.0.0.1:12345' });
    try {
      await new Promise<void>((resolve, reject) => {
        client.once('open', resolve); client.once('error', reject);
      });
      expect(registry.list()).toEqual([]);
      transport.attachPreviewRegistry(registry);
      expect(registry.list()[0].kind).toBe('browser');
      transport.attachPreviewRegistry(undefined); expect(registry.list()).toEqual([]);
      transport.attachPreviewRegistry(registry); transport.attachPreviewRegistry(registry);
      expect(registry.list()).toHaveLength(1);
      const replacement = new PreviewRegistry(); transport.attachPreviewRegistry(replacement);
      expect(registry.list()).toEqual([]); expect(replacement.list()).toHaveLength(1);
      transport.attachPreviewRegistry(registry); expect(replacement.list()).toEqual([]);
      const handler = vi.fn(); transport.onMessage(handler);
      const received = new Promise<unknown>(resolve => client.once('message', data => {
        const request = JSON.parse(data.toString());
        client.send(JSON.stringify({ type: 'viewerRpcResponse', requestId: request.requestId, result: { path: '/browser' } }));
        resolve(request);
      }));
      const response = registry.request(registry.list()[0].id, 'get_state');
      await received; await expect(response).resolves.toEqual({ path: '/browser' });
      const sourceMessage = new Promise<unknown>(resolve => client.once('message', data => resolve(JSON.parse(data.toString()))));
      await registry.sendSource(registry.list()[0].id, { type: 'shaderSource', path: '/browser.glsl', config: {} });
      await expect(sourceMessage).resolves.toMatchObject({ type: 'shaderSource', path: '/browser.glsl' });
      expect(handler).not.toHaveBeenCalled();
      client.send(JSON.stringify({ type: 'log', message: 'browser log' }));
      await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
      const socket = [...(transport as unknown as { wsClients: Set<WebSocket> }).wsClients][0];
      Object.defineProperty(socket, 'readyState', { value: WebSocket.CLOSED, configurable: true });
      await expect(registry.request(registry.list()[0].id, 'get_state')).rejects.toThrow('disconnected');
      await expect(registry.sendSource(registry.list()[0].id, { type: 'shaderSource', config: {} })).rejects.toThrow('disconnected');
      Reflect.deleteProperty(socket, 'readyState');
      client.close(); await vi.waitFor(() => expect(registry.list()).toEqual([]));
    } finally {
      client.terminate(); transport.close(); registry.dispose();
    }
  });
});
