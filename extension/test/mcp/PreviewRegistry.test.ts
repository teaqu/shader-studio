import { describe, it, expect, vi } from 'vitest';
import { PreviewRegistry } from '../../src/app/mcp/PreviewRegistry';
import type { ViewerRpcRequest, ViewerSnapshot } from '@shader-studio/types';

const state = { path: '/shader.glsl' } as ViewerSnapshot;

describe('PreviewRegistry', () => {
  it('selects an unambiguous viewer and requires an explicit choice otherwise', () => {
    const registry = new PreviewRegistry();
    expect(() => registry.select()).toThrow('No preview');
    registry.register({ id: 'a', kind: 'webview', send: vi.fn() });
    expect(registry.select()).toBe('a');
    registry.register({ id: 'b', kind: 'browser', send: vi.fn() });
    expect(registry.list()).toEqual([{ id: 'a', kind: 'webview' }, { id: 'b', kind: 'browser' }]);
    expect(() => registry.select()).toThrow('Multiple previews');
    expect(() => registry.select('missing')).toThrow('Unknown previewId');
    expect(registry.select('b')).toBe('b');
    registry.dispose();
    expect(registry.list()).toEqual([]);
  });

  it('routes to only one viewer and rejects replies from another connection', async () => {
    const registry = new PreviewRegistry();
    let request!: ViewerRpcRequest;
    const other = vi.fn();
    registry.register({ id: 'a', kind: 'webview', send: message => {
      request = message;
    } });
    registry.register({ id: 'b', kind: 'browser', send: other });
    const result = registry.request('a', 'capture', { expectedPath: state.path });
    registry.receive('a', null);
    registry.receive('a', { type: 'unrelated' });
    registry.receive('b', { type: 'viewerRpcResponse', requestId: request.requestId, error: 'spoof' });
    registry.receive('a', { type: 'viewerRpcResponse', requestId: 'missing', result: state });
    registry.receive('a', { type: 'viewerRpcResponse', requestId: request.requestId, result: state });
    await expect(result).resolves.toEqual(state);
    expect(other).not.toHaveBeenCalled();
    registry.receive('a', { type: 'viewerRpcResponse', requestId: request.requestId, result: state });
  });

  it('rejects failed, invalid, closed and unavailable viewers', async () => {
    const registry = new PreviewRegistry();
    await expect(registry.request('missing', 'get_state')).rejects.toThrow('disconnected');
    let request!: ViewerRpcRequest;
    const disconnect = registry.register({ id: 'a', kind: 'browser', send: message => {
      request = message;
    } });
    const invalid = registry.request('a', 'get_state');
    registry.receive('a', { type: 'viewerRpcResponse', requestId: request.requestId });
    await expect(invalid).rejects.toThrow('Invalid');
    const failed = registry.request('a', 'get_state');
    registry.receive('a', { type: 'viewerRpcResponse', requestId: request.requestId, error: 'compiler failed' });
    await expect(failed).rejects.toThrow('compiler failed');
    const closed = registry.request('a', 'get_state');
    disconnect();
    await expect(closed).rejects.toThrow('disconnected');
    registry.register({ id: 'a', kind: 'browser', send: () => {
      throw new Error('send failed');
    } });
    await expect(registry.request('a', 'get_state')).rejects.toThrow('send failed');
    registry.register({ id: 'b', kind: 'browser', send: vi.fn() });
    const pending = registry.request('b', 'get_state');
    registry.dispose();
    await expect(pending).rejects.toThrow('closed');
  });

  it('cleans up timeouts and cancellation', async () => {
    const registry = new PreviewRegistry(5);
    registry.register({ id: 'a', kind: 'browser', send: vi.fn() });
    await expect(registry.request('a', 'get_state')).rejects.toThrow('timed out');
    const controller = new AbortController();
    const pending = registry.request('a', 'get_state', {}, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('cancelled');
    await expect(registry.request('a', 'get_state', {}, controller.signal)).rejects.toThrow('cancelled');
  });
});
