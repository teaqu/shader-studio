import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpLogs, mcpLogs, scriptConsole } from '../../src/app/mcp/McpLogs';
import { Logger } from '../../src/app/services/Logger';
import type * as vscode from 'vscode';

afterEach(() => vi.restoreAllMocks());

describe('MCP diagnostic history', () => {
  it('bounds history and message size while supporting cursors and filters', () => {
    const logs = new McpLogs(3);
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
    const logs = new McpLogs();
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
    const after = mcpLogs.read({}).nextCursor;
    const logger = Logger.getInstance();
    logger.info('startup'); logger.debug('debug'); logger.warn('warning'); logger.error(new Error('failure'));
    expect(mcpLogs.read({ after })).toMatchObject({ entries: [
      { message: 'startup' }, { message: 'debug' }, { message: 'warning' }, { message: 'failure' },
    ] });
  });
});
