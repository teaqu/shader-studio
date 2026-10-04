import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import type { WgslTraceRecording } from '@shader-studio/types';
import { WgslTraceHost } from '../../step-debugger/WgslTraceHost.js';
import { startWgslTrace } from '../../step-debugger/startWgslTrace.js';
import { registerWgslTraceDebugger } from '../../step-debugger/registerWgslTraceDebugger.js';

const api = vi.hoisted(() => ({
  workspace: { openTextDocument: vi.fn(), getWorkspaceFolder: vi.fn() },
  window: { createWebviewPanel: vi.fn(), showTextDocument: vi.fn(), showErrorMessage: vi.fn() },
  debug: { activeDebugSession: undefined as { type: string } | undefined, startDebugging: vi.fn(), registerDebugAdapterDescriptorFactory: vi.fn() },
  Uri: { file: (fsPath: string) => ({ fsPath }), joinPath: (_base: unknown, ...parts: string[]) => ({ toString: () => parts.join('/') }) },
  ViewColumn: { Beside: 2 },
  Disposable: class {
    constructor(readonly callback: () => void) {} dispose() {
      this.callback();
    }
  },
  EventEmitter: class {
    listeners: ((message: unknown) => void)[] = [];
    event = (callback: (message: unknown) => void) => {
      this.listeners.push(callback);
    };
    fire(message: unknown) {
      this.listeners.forEach(callback => callback(message));
    }
    dispose() {
      this.listeners = [];
    }
  },
  DebugAdapterInlineImplementation: class {
    constructor(readonly implementation: unknown) {}
  },
}));
vi.mock('vscode', () => api);

const path = '/project/image.wgsl';
const source = 'fn mainImage() {}';
const recording: WgslTraceRecording = { path, source, color: [0, 0, 0, 1], overflow: false,
  sites: [{ id: 0, line: 1, column: 1, variables: [] }], events: [{ siteId: 0, line: 1, column: 1, values: [] }] };
const context = { extensionUri: {}, subscriptions: [] as vscode.Disposable[] } as unknown as vscode.ExtensionContext;
const request = { program: path, source, width: 4, height: 4, pixel: [1, 2], time: 0, frame: 0, capacity: 64 };

function document(text = source) {
  return { uri: { fsPath: path }, version: 1, getText: () => text };
}
function panelRig() {
  let receive: (message: object) => void = () => {};
  const closures: (() => void)[] = [];
  const messagesDisposed = vi.fn();
  const closedDisposed = vi.fn();
  const panel = { webview: { html: '', asWebviewUri: (uri: unknown) => String(uri), postMessage: vi.fn(),
    onDidReceiveMessage: (callback: typeof receive) => {
      receive = callback; return { dispose: messagesDisposed };
    } },
  onDidDispose: (callback: () => void) => {
    closures.push(callback); return { dispose: closedDisposed };
  },
  dispose: vi.fn(() => closures.forEach(callback => callback())),
  };
  api.window.createWebviewPanel.mockReturnValue(panel);
  return { panel, receive: (message: object) => receive(message), messagesDisposed, closedDisposed };
}
beforeEach(() => {
  vi.clearAllMocks();
  api.debug.activeDebugSession = undefined;
  api.workspace.openTextDocument.mockResolvedValue(document());
  api.workspace.getWorkspaceFolder.mockReturnValue('folder');
  api.debug.startDebugging.mockResolvedValue(true);
  context.subscriptions.length = 0;
});
afterEach(() => vi.useRealTimers());

describe('trace host source lifetime', () => {
  it('accepts frozen project captures and tracks root and dependency revisions', async () => {
    const root = document();
    const dependency = document('fn helper() {}');
    api.workspace.openTextDocument.mockResolvedValueOnce(root).mockResolvedValueOnce(dependency);
    const host = new WgslTraceHost(context);
    expect(host.sourceIsCurrent()).toBe(false);
    const project = { ...recording, sources: [{ path: '/common.wgsl', source: dependency.getText() }] };
    expect(await host.capture({ ...request, recording: project })).toBe(project);
    expect(api.window.createWebviewPanel).not.toHaveBeenCalled();
    expect(host.sourceIsCurrent()).toBe(true);
    dependency.version++;
    expect(host.sourceIsCurrent()).toBe(false);
    dependency.version--;
    root.version++;
    expect(host.sourceIsCurrent()).toBe(false);
    host.onClose(vi.fn()).dispose();
  });

  it('rejects missing programs and stale preview, root and dependency snapshots', async () => {
    await expect(new WgslTraceHost(context).capture({})).rejects.toThrow('Set program');
    await expect(new WgslTraceHost(context).capture({ ...request, source: 'old' })).rejects.toThrow('preview shader differs');
    await expect(new WgslTraceHost(context).capture({ ...request, recording: { ...recording, path: '/other.wgsl' } })).rejects.toThrow('project recording differs');
    api.workspace.openTextDocument.mockResolvedValueOnce(document()).mockResolvedValueOnce(document('edited'));
    await expect(new WgslTraceHost(context).capture({ ...request, recording: { ...recording, sources: [{ path: '/common.wgsl', source: 'old' }] } })).rejects.toThrow('dependency');
  });

  it.each(['root', 'dependency'] as const)('cancels while opening the %s document', async stage => {
    let finish!: (value: ReturnType<typeof document>) => void;
    const deferred = new Promise<ReturnType<typeof document>>(resolve => {
      finish = resolve;
    });
    if (stage === 'dependency') {
      api.workspace.openTextDocument.mockResolvedValueOnce(document());
    }
    api.workspace.openTextDocument.mockReturnValueOnce(deferred);
    const host = new WgslTraceHost(context);
    const pending = host.capture({ ...request, recording: { ...recording, sources: [{ path, source }] } });
    await Promise.resolve();
    host.dispose();
    finish(document());
    await expect(pending).rejects.toThrow('cancelled');
    await expect(host.capture(request)).rejects.toThrow('cancelled');
  });
});

describe('GPU runner transport', () => {
  it('sends explicit launch inputs only after readiness and resolves exactly once', async () => {
    const rig = panelRig();
    const host = new WgslTraceHost(context);
    const pending = host.capture(request);
    await Promise.resolve();
    expect(rig.panel.webview.html).toContain('Content-Security-Policy');
    expect(rig.panel.webview.postMessage).not.toHaveBeenCalled();
    rig.receive({ type: 'unrelated' });
    rig.receive({ type: 'wgslTraceReady' });
    expect(rig.panel.webview.postMessage).toHaveBeenCalledWith({ type: 'captureWgslTrace', launch: { path, source, width: 4, height: 4, pixel: [1, 2], time: 0, frame: 0, capacity: 64, customUniforms: undefined, uniforms: undefined } });
    rig.receive({ type: 'wgslTraceResult', recording });
    expect(await pending).toBe(recording);
    rig.receive({ type: 'wgslTraceError', message: 'late error' });
    expect(rig.messagesDisposed).toHaveBeenCalledOnce();
    expect(rig.closedDisposed).toHaveBeenCalledOnce();
    host.onClose(vi.fn()).dispose();
    host.dispose();
    expect(rig.panel.dispose).toHaveBeenCalledOnce();
  });

  it.each(['error', 'default-error', 'close', 'cancel', 'timeout'] as const)('releases subscriptions on runner %s', async mode => {
    vi.useFakeTimers();
    const rig = panelRig();
    const host = new WgslTraceHost(context);
    const pending = host.capture({ program: path });
    const rejected = expect(pending).rejects.toThrow(/failed|closed|cancelled|timed out/);
    await Promise.resolve();
    rig.receive({ type: 'wgslTraceReady' });
    expect(rig.panel.webview.postMessage.mock.calls[0]?.[0].launch).toMatchObject({ width: 256, height: 256, pixel: [128, 128], time: 0, frame: 0, capacity: 4096 });
    if (mode === 'error') {
      rig.receive({ type: 'wgslTraceError', message: 'GPU failed' });
    }
    if (mode === 'default-error') {
      rig.receive({ type: 'wgslTraceError' });
    }
    if (mode === 'close') {
      rig.panel.dispose();
    }
    if (mode === 'cancel') {
      host.dispose();
    }
    if (mode === 'timeout') {
      await vi.advanceTimersByTimeAsync(30000);
    }
    await rejected;
    host.dispose();
    expect(rig.messagesDisposed).toHaveBeenCalled();
  });
});

describe('starting and registering traces', () => {
  it('opens the exact shader editor before starting its trace adapter', async () => {
    await startWgslTrace(request);
    expect(api.window.showTextDocument).toHaveBeenCalledWith(expect.objectContaining({ uri: { fsPath: path } }), { preview: false, preserveFocus: false });
    expect(api.debug.startDebugging).toHaveBeenCalledWith('folder', expect.objectContaining({ type: 'shader-studio-wgsl-trace', pixel: [1, 2] }));
    expect(api.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('reports active sessions, stale source, malformed inputs and startup failures', async () => {
    api.debug.activeDebugSession = { type: 'shader-studio-wgsl-trace' };
    await startWgslTrace(request);
    expect(api.debug.startDebugging).not.toHaveBeenCalled();
    api.debug.activeDebugSession = undefined;
    await startWgslTrace(null);
    await startWgslTrace({ ...request, source: 'old' });
    api.debug.startDebugging.mockResolvedValueOnce(false);
    await startWgslTrace(request);
    api.debug.startDebugging.mockRejectedValueOnce(new Error('GPU unavailable')).mockRejectedValueOnce('host unavailable');
    await startWgslTrace(request);
    await startWgslTrace(request);
    expect(api.window.showErrorMessage.mock.calls.map(([error]) => error)).toEqual([
      expect.stringContaining('Stop the current'), expect.stringContaining('Inspect a WGSL'), expect.stringContaining('preview shader differs'),
      expect.stringContaining('could not start'), 'GPU unavailable', 'host unavailable',
    ]);
  });

  it('registers an inline DAP adapter and disposes its host and event stream', async () => {
    registerWgslTraceDebugger(context);
    const [type, factory] = api.debug.registerDebugAdapterDescriptorFactory.mock.calls[0]!;
    expect(type).toBe('shader-studio-wgsl-trace');
    const descriptor = factory.createDebugAdapterDescriptor() as { implementation: { onDidSendMessage: (callback: (message: { command?: string; event?: string }) => void) => void; handleMessage: (message: object) => void; dispose: () => void } };
    const messages: { command?: string; event?: string }[] = [];
    descriptor.implementation.onDidSendMessage(message => messages.push(message));
    descriptor.implementation.handleMessage({ seq: 1, type: 'request', command: 'launch', arguments: { ...request, recording } });
    await vi.waitFor(() => expect(messages.some(message => message.command === 'launch')).toBe(true));
    descriptor.implementation.handleMessage({ seq: 2, type: 'request', command: 'next' });
    await vi.waitFor(() => expect(messages.some(message => message.command === 'next')).toBe(true));
    descriptor.implementation.dispose();
    expect(context.subscriptions).toHaveLength(1);
  });
});
