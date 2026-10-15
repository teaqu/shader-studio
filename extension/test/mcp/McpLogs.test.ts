import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpLogs, mcpLogs, scriptConsole } from '../../src/app/mcp/McpLogs';
import { Logger } from '../../src/app/services/Logger';
import type * as vscode from 'vscode';

afterEach(() => {
  mcpLogs.setEnabled(false); vi.restoreAllMocks(); vi.useRealTimers();
});

describe('MCP diagnostic history', () => {
  it('does not retain diagnostics until collection is explicitly requested', () => {
    const logs = new McpLogs();
    logs.append('extension', 'info', 'idle');
    logs.recordViewer('a', { type: 'error', payload: 'idle viewer' });
    expect(logs.read({}).entries).toEqual([]);
  });

  it('requires explicit collection, expires without timers, stops, and clears on disable', () => {
    vi.useFakeTimers();
    const logs = new McpLogs();
    expect(() => logs.start()).toThrow('disabled');
    logs.setEnabled(true);
    logs.append('extension', 'info', 'enabled but idle');
    expect(logs.read({})).toMatchObject({ entries: [], collecting: false, expiresAt: null });
    for (const duration of [0, 301, NaN, Infinity]) {
      expect(() => logs.start(duration)).toThrow('duration');
    }
    expect(logs.start(1)).toMatchObject({ collecting: true, entries: [], expiresAt: expect.any(String) });
    logs.append('extension', 'info', 'collected');
    vi.advanceTimersByTime(1000);
    logs.append('extension', 'info', 'expired');
    expect(logs.read({})).toMatchObject({ collecting: false, entries: [{ message: 'collected' }] });
    expect(vi.getTimerCount()).toBe(0);
    logs.start(); logs.append('extension', 'info', 'fresh');
    expect(logs.stop()).toMatchObject({ collecting: false, entries: [{ message: 'fresh' }] });
    logs.recordViewer('a', { type: 'log', payload: 'stopped' });
    logs.append('extension', 'info', 'stopped');
    expect(logs.read({}).entries).toHaveLength(1);
    logs.start(); logs.append('extension', 'info', 'private'); logs.setEnabled(false);
    expect(logs.read({})).toMatchObject({ collecting: false, entries: [] });
    logs.setEnabled(true);
    expect(logs.read({}).collecting).toBe(false);
  });

  it('preserves console and extension output without collecting when idle', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const payload = { toString: vi.fn(() => 'formatted') };
    scriptConsole().log('%s', payload);
    expect(spy).toHaveBeenCalledWith('%s', payload);
    expect(payload.toString).not.toHaveBeenCalled();
    const channel = { info: vi.fn(), debug: vi.fn(), trace: vi.fn(), warn: vi.fn(), error: vi.fn() };
    Logger.initialize(channel as unknown as vscode.LogOutputChannel);
    Logger.getInstance().info('normal output');
    expect(channel.info).toHaveBeenCalledWith('normal output');
    expect(mcpLogs.read({}).entries).toEqual([]);
  });

  it('bounds history and message size while supporting cursors and filters', () => {
    const logs = new McpLogs(3); logs.setEnabled(true); logs.start();
    logs.append('extension', 'info', 'first');
    logs.append('viewer', 'debug', 'a', 'a');
    logs.append('viewer', 'error', 'b', 'b');
    logs.append('script', 'warning', 'x'.repeat(5000));
    const first = logs.read({ limit: 1 });
    expect(first).toMatchObject({ nextCursor: 2, hasMore: true });
    expect(logs.read({ after: 2, previewId: 'a' })).toMatchObject({ entries: [{ source: 'script', message: 'x'.repeat(4096) }], hasMore: false, nextCursor: 4 });
    expect(logs.read({ level: 'error' })).toMatchObject({ entries: [{ message: 'b', previewId: 'b' }] });
    logs.append('extension', 'info', 'last');
    expect(logs.read({ after: 1 })).toMatchObject({ droppedBeforeCursor: true });
    expect(logs.read({ after: 500 })).toMatchObject({ entries: [] });
  });

  it('retains typed viewer diagnostics and ignores unrelated transport messages', () => {
    const logs = new McpLogs(); logs.setEnabled(true); logs.start();
    logs.recordViewer('a', { type: 'shaderSource' });
    logs.recordViewer('a', { type: 'warning' });
    logs.recordViewer('a', { type: 'warning', payload: ['line 1', 'line 2'] });
    logs.recordViewer('a', { type: 'error', payload: 'error' });
    expect(logs.read({})).toMatchObject({ entries: [
      { level: 'warning', message: 'line 1\nline 2', previewId: 'a' },
      { level: 'error', message: 'error' },
    ] });
  });

  it('captures script console output without removing the original console behavior', () => {
    mcpLogs.setEnabled(true); mcpLogs.start();
    const after = mcpLogs.read({}).nextCursor;
    for (const method of ['log', 'info', 'debug', 'warn', 'error'] as const) {
      const spy = vi.spyOn(console, method).mockImplementation(() => undefined);
      scriptConsole('test.uniforms.ts')[method]('value %d', 42);
      expect(spy).toHaveBeenCalledWith('value %d', 42);
    }
    scriptConsole().info('default path');
    expect(mcpLogs.read({ after })).toMatchObject({ entries: [
      { source: 'script', level: 'info', message: 'test.uniforms.ts: value 42' },
      { source: 'script', level: 'info' }, { level: 'debug' }, { level: 'warning' }, { level: 'error' },
      { message: 'uniform script: default path' },
    ] });
  });

  it('retains extension logs through the existing logger', () => {
    const channel = { info: vi.fn(), debug: vi.fn(), trace: vi.fn(), warn: vi.fn(), error: vi.fn(), dispose: vi.fn() };
    Logger.initialize(channel as unknown as vscode.LogOutputChannel);
    mcpLogs.setEnabled(true); mcpLogs.start();
    const after = mcpLogs.read({}).nextCursor;
    const logger = Logger.getInstance();
    logger.info('startup'); logger.debug('debug'); logger.warn('warning'); logger.error(new Error('failure'));
    expect(mcpLogs.read({ after })).toMatchObject({ entries: [
      { message: 'startup' }, { message: 'debug' }, { message: 'warning' }, { message: 'failure' },
    ] });
  });
});
