import { describe, it, expect, vi } from 'vitest';
import type * as vscode from 'vscode';
import { Logger } from '../../src/app/services/Logger';
import { ScriptEvaluator } from '../../src/app/ScriptEvaluator';
import { mcpLogs } from '../../src/app/mcp/McpLogs';

describe('MCP diagnostic logging', () => {
  it('retains extension levels and script console output without changing script results', () => {
    const output = { info: vi.fn(), debug: vi.fn(), trace: vi.fn(), warn: vi.fn(), error: vi.fn() };
    Logger.initialize(output as unknown as vscode.LogOutputChannel);
    const logger = Logger.getInstance();
    const cursor = mcpLogs.read({}).nextCursor;
    logger.info('started'); logger.debug('detail'); logger.warn('warning'); logger.warn('warning');
    logger.error(new Error('failure')); logger.error('failure'); logger.trace('trace');
    expect(mcpLogs.read({ after: cursor }).entries.map(entry => entry.level)).toEqual(['info', 'debug', 'warning', 'error']);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const evaluator = new ScriptEvaluator();
      const result = evaluator.loadScript('var __shaderUniforms = { uniforms() { console.log("script %d", 42); return { gain: 1 }; } };');
      expect(result.error).toBeUndefined();
      expect(result.uniforms).toEqual([{ name: 'gain', type: 'float' }]);
      expect(mcpLogs.read({ after: cursor }).entries.some(entry => entry.source === 'script' && entry.message.includes('script 42'))).toBe(true);
      evaluator.stop();
    } finally {
      consoleSpy.mockRestore(); 
    }
  });
});
