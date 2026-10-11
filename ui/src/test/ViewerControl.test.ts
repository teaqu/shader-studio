import { describe, it, expect, vi } from 'vitest';
import { ViewerControl, validateViewerSettings } from '../lib/ViewerControl';
import type { ViewerRpcRequest, ViewerSnapshot } from '@shader-studio/types';

function fixture(timeout = 50) {
  const state = { path: '/shader', compileSequence: 2 } as ViewerSnapshot;
  const host = {
    readStorage: vi.fn(async () => ({ name: 'data', elementType: 'uint', stride: 4, start: 0, count: 1, bytes: [42, 0, 0, 0] })),
    snapshot: vi.fn(() => state), capture: vi.fn(async () => ({ ...state, mimeType: 'image/png' as const, data: 'pixels' })),
    settings: vi.fn(), playback: vi.fn(), respond: vi.fn(),
  };
  return { state, host, control: new ViewerControl(host, timeout) };
}
const request = (operation: ViewerRpcRequest['operation'], payload = {}): ViewerRpcRequest => ({ type: 'viewerRpcRequest', requestId: operation, operation, payload });

describe('ViewerControl', () => {
  it('does not apply cancelled or expired queued mutations', async () => {
    const { control, host } = fixture(25);
    control.compileStarted('/shader', 1);
    control.handle(request('settings', { speed: 2 }));
    control.handle({ ...request('cancel'), requestId: 'settings' });
    control.handle({ ...request('cancel'), requestId: 'unknown' });
    await vi.waitFor(() => expect(host.respond).toHaveBeenCalledOnce());
    expect(host.respond.mock.calls[0][0].error).toContain('cancelled');
    control.compileCancelled('/shader', 1);
    expect(control.compiling).toBe(false);
    expect(host.settings).not.toHaveBeenCalled();
  });
  it('reads actual storage through the selected renderer and carries its layout', async () => {
    const { control, host } = fixture();
    control.handle(request('read_storage', { name: 'data', start: 0, count: 1 }));
    await vi.waitFor(() => expect(host.respond).toHaveBeenCalledOnce());
    expect(host.readStorage).toHaveBeenCalledWith({ name: 'data', start: 0, count: 1 });
    expect(host.respond.mock.calls[0][0].result.storageRead.bytes).toEqual([42, 0, 0, 0]);
  });
  it('returns live state and actual capture results, serializing commands', async () => {
    const { control, host } = fixture();
    control.handle(request('settings', { speed: 2 }));
    control.handle(request('playback', { paused: true }));
    control.handle(request('get_state'));
    control.handle(request('capture'));
    await vi.waitFor(() => expect(host.respond).toHaveBeenCalledTimes(4));
    expect(host.settings).toHaveBeenCalledWith({ speed: 2 });
    expect(host.playback).toHaveBeenCalledWith({ paused: true });
    expect(host.respond.mock.calls[3][0].result.data).toBe('pixels');
  });

  it('waits for the requested compilation instead of capturing stale output', async () => {
    const { control, host } = fixture(1000);
    control.compileStarted('/shader', 2);
    control.handle(request('capture', { requiredPath: '/shader', requiredSequence: 2, expectedPath: '/shader' }));
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(host.capture).not.toHaveBeenCalled();
    control.compileFinished('/shader', 1);
    expect(control.compiling).toBe(true);
    control.compileFinished('/shader', 2);
    control.compileFinished('/shader', undefined);
    await vi.waitFor(() => expect(host.capture).toHaveBeenCalledOnce());
    expect(control.compiling).toBe(false);
  });

  it('reports switched previews, timeout, shutdown, unsupported operations and host errors', async () => {
    const switched = fixture();
    switched.control.handle(request('get_state', { expectedPath: '/other' }));
    await vi.waitFor(() => expect(switched.host.respond).toHaveBeenCalled());
    expect(switched.host.respond.mock.calls[0][0].error).toContain('switched');
    const timeout = fixture(1);
    timeout.control.handle(request('capture', { requiredPath: '/shader', requiredSequence: 10 }));
    await vi.waitFor(() => expect(timeout.host.respond).toHaveBeenCalled());
    expect(timeout.host.respond.mock.calls[0][0].error).toContain('Timed out');
    const closed = fixture();
    closed.control.dispose();
    closed.control.handle(request('get_state'));
    await vi.waitFor(() => expect(closed.host.respond).toHaveBeenCalled());
    expect(closed.host.respond.mock.calls[0][0].error).toContain('closed');
    const bad = fixture();
    bad.control.handle(request('bad' as ViewerRpcRequest['operation']));
    bad.host.capture.mockRejectedValueOnce(new Error('no canvas'));
    bad.control.handle(request('capture'));
    await vi.waitFor(() => expect(bad.host.respond).toHaveBeenCalledTimes(2));
    expect(bad.host.respond.mock.calls[0][0].error).toContain('Unsupported');
    expect(bad.host.respond.mock.calls[1][0].error).toBe('no canvas');
  });

  it('validates temporary viewer settings without accepting persistent config', () => {
    expect(() => validateViewerSettings({ fpsLimit: 0, speed: 100, expectedPath: '/shader', uniforms: {} })).not.toThrow();
    expect(() => validateViewerSettings({ passes: {} })).toThrow('Unsupported');
    for (const value of [-1, Infinity, 'fast', 1001]) {
      expect(() => validateViewerSettings({ fpsLimit: value })).toThrow('fpsLimit');
    }
    for (const value of [-1, NaN, 'fast', 101]) {
      expect(() => validateViewerSettings({ speed: value })).toThrow('speed');
    }
  });
});
