import { afterEach, expect, it, vi } from 'vitest';
import { getWgslTraceState, registerWgslTraceControls, registerWgslTraceStartHandler, requestWgslTraceStart,
  resetWgslTraceState, selectWgslTraceTarget, setWgslTraceInvocation, setWgslTraceState, setWgslTraceVertexIndex } from '../lib/state/wgslTraceState.svelte';

afterEach(resetWgslTraceState);

it('dispatches trace controls and removes listeners when unregistered', () => {
  const start = vi.fn(); const target = vi.fn(); const invocation = vi.fn(); const vertex = vi.fn();
  registerWgslTraceStartHandler(start); registerWgslTraceControls({ target, invocation, vertex });
  requestWgslTraceStart(); selectWgslTraceTarget('Update:compute'); setWgslTraceInvocation(2, 4); setWgslTraceVertexIndex(7);
  expect(start).toHaveBeenCalledOnce(); expect(target).toHaveBeenCalledWith('Update:compute');
  expect(invocation).toHaveBeenCalledWith(2, 4); expect(vertex).toHaveBeenCalledWith(7);
  registerWgslTraceStartHandler(null); registerWgslTraceControls(null);
  requestWgslTraceStart(); selectWgslTraceTarget('Image:fragment'); setWgslTraceInvocation(0, 1); setWgslTraceVertexIndex(0);
  expect(start).toHaveBeenCalledOnce(); expect(target).toHaveBeenCalledOnce();
  expect(invocation).toHaveBeenCalledOnce(); expect(vertex).toHaveBeenCalledOnce();
});

it('preserves unrelated state in partial updates and resets the recording session', () => {
  const handler = vi.fn(); registerWgslTraceStartHandler(handler);
  setWgslTraceState({ available: true, selectedTarget: 'Update:compute', invocation: [1, 2, 3], vertexIndex: 7 });
  setWgslTraceState({ busy: true });
  expect(getWgslTraceState()).toMatchObject({ available: true, selectedTarget: 'Update:compute', invocation: [1, 2, 3], vertexIndex: 7, busy: true });
  resetWgslTraceState(); requestWgslTraceStart();
  expect(handler).not.toHaveBeenCalled();
  expect(getWgslTraceState()).toEqual({ available: false, reason: 'Select a pixel to trace.', targets: [], selectedTarget: null, invocation: [0, 0, 0], vertexIndex: 0, busy: false });
});
