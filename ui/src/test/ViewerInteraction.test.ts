import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewerInteraction } from '../lib/ViewerInteraction';
import type { ViewerInputEvent, ViewerInputListener, ViewerInputSource } from '../../../rendering/src/types/ViewerInteraction';

function fixture() {
  let listener: ViewerInputListener = () => {};
  const injectInput = vi.fn(() => ({ mouse: [0, 0, 0, 0] as [number, number, number, number], heldCodes: ['KeyW'] }));
  const unsubscribe = vi.fn();
  const engine = {
    injectInput, getTimeManager: () => ({ getCurrentTime: () => 2, getFrame: () => 4, isPaused: () => false }),
    subscribeInput: (next: ViewerInputListener) => {
      listener = next;
      return { dispose: unsubscribe };
    },
  };
  const reset = vi.fn(async () => {});
  const context = { path: '/a.glsl', compileSequence: 3, reset };
  const controller = new ViewerInteraction(engine, () => ({ ...context }));
  return { controller, injectInput, reset, context, unsubscribe, emit: (event: ViewerInputEvent, source: ViewerInputSource = 'physical') => listener(event, source) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('ViewerInteraction', () => {
  it('records physical and injected input without releasing initial held state, returning isolated snapshots', () => {
    const { controller, emit, injectInput, unsubscribe } = fixture();
    expect(controller.get()).toBeNull();
    const initial = controller.start();
    expect(initial.initial.heldCodes).toEqual(['KeyW']);
    expect(injectInput).toHaveBeenCalledExactlyOnceWith([]);
    emit({ type: 'pointer_down', x: 2, y: 3 });
    vi.advanceTimersByTime(50);
    emit({ type: 'key_down', code: 'KeyW' }, 'injected');
    expect(initial.events).toHaveLength(0);
    expect(controller.stop()).toMatchObject({ path: '/a.glsl', compileSequence: 3, initial: { frame: 4 }, events: [{ source: 'physical', time: 0 }, { source: 'injected', time: 0.05 }] });
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('validates whole batches before applying any event', () => {
    const { controller, injectInput, emit } = fixture();
    expect(() => controller.inject(Array.from({ length: 257 }, () => ({ type: 'release_all' } as const)))).toThrow('256');
    expect(() => controller.inject([{ type: 'key_up', code: 'KeyW' }, { type: 'key_down', code: 'unknown' }])).toThrow('Invalid');
    expect(() => controller.inject([{ type: 'pointer_up', x: 1 }])).toThrow('Invalid');
    expect(injectInput).not.toHaveBeenCalled();
    expect(controller.inject([{ type: 'pointer_move', x: 0, y: 1 }, { type: 'pointer_up' }])).toHaveProperty('mouse');
    controller.start();
    emit({ type: 'key_down', code: 'unknown' });
    emit(null as unknown as ViewerInputEvent);
    emit({ type: 'wat' } as unknown as ViewerInputEvent);
    expect(controller.stop()?.events).toEqual([]);
  });

  it('bounds trace duration and event count and stops after the source changes', () => {
    const { controller, emit, context } = fixture();
    controller.start();
    for (let index = 0; index < 257; index++) {
      emit({ type: 'release_all' });
    }
    expect(controller.get()).toMatchObject({ truncated: true, stopped: true });
    controller.start();
    vi.advanceTimersByTime(60_000);
    expect(controller.get()).toMatchObject({ truncated: true, stopped: true });
    controller.start();
    context.compileSequence++;
    emit({ type: 'pointer_up' });
    expect(controller.get()).toMatchObject({ stopped: true, events: [] });
    controller.dispose();
  });

  it('resets and replays against the post-reset compilation, then releases held input', async () => {
    const { controller, injectInput, reset, context } = fixture();
    const trace = controller.start();
    trace.events.push({ sequence: 0, time: .01, frame: 4, source: 'injected', event: { type: 'key_down', code: 'KeyW' } });
    reset.mockImplementation(async () => {
      context.compileSequence++;
    });
    await controller.replay(trace, 'reset-and-play');
    expect(reset).toHaveBeenCalledOnce();
    expect(controller.replayStatus()).toBe('running');
    await vi.advanceTimersByTimeAsync(20);
    expect(injectInput).toHaveBeenCalledWith([{ type: 'key_down', code: 'KeyW' }]);
    expect(controller.replayStatus()).toBe('completed');
    expect(injectInput).toHaveBeenLastCalledWith([{ type: 'release_all' }]);
  });

  it('rejects stale, malformed and out-of-range traces before scheduling', async () => {
    const { controller } = fixture();
    const trace = controller.start();
    await expect(controller.replay(trace, 'bad' as 'from-current')).rejects.toThrow('mode');
    await expect(controller.replay({ ...trace, events: [{ time: 61, event: { type: 'release_all' } }] } as typeof trace, 'from-current')).rejects.toThrow('invalid');
    await expect(controller.replay({ ...trace, path: '/old.glsl' }, 'from-current')).rejects.toThrow('changed');
    expect(controller.replayStatus()).toBe('failed');
  });

  it('cancels pending reset and scheduled input without leaking timers', async () => {
    const { controller, reset, injectInput } = fixture();
    const trace = controller.start();
    let resolve!: () => void;
    reset.mockImplementation(() => new Promise<void>(done => {
      resolve = done;
    }));
    const pending = controller.replay(trace, 'reset-and-play');
    controller.cancel();
    resolve();
    await pending;
    expect(controller.replayStatus()).toBe('cancelled');
    trace.events.push({ sequence: 0, time: 10, frame: 4, source: 'physical', event: { type: 'key_down', code: 'Space' } });
    await controller.replay(trace, 'from-current');
    controller.dispose();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(injectInput).not.toHaveBeenCalledWith([{ type: 'key_down', code: 'Space' }]);
  });

  it('fails when reset rejects or the shader changes while resetting or replaying', async () => {
    const { controller, reset, context } = fixture();
    const trace = controller.start();
    reset.mockRejectedValueOnce(new Error('reset failed'));
    await expect(controller.replay(trace, 'reset-and-play')).rejects.toThrow('reset failed');
    expect(controller.replayStatus()).toBe('failed');
    reset.mockImplementationOnce(async () => {
      context.path = '/b.glsl';
    });
    await expect(controller.replay(trace, 'reset-and-play')).rejects.toThrow('switched');
    context.path = trace.path;
    trace.events.push({ sequence: 0, time: 1, frame: 4, source: 'physical', event: { type: 'release_all' } });
    await controller.replay(trace, 'from-current');
    context.compileSequence++;
    await vi.advanceTimersByTimeAsync(1000);
    expect(controller.replayStatus()).toBe('failed');
  });

  it('converts asynchronous input failures into failed replay status', async () => {
    const { controller, injectInput } = fixture();
    const trace = controller.start();
    trace.events.push({ sequence: 0, time: 0, frame: 4, source: 'physical', event: { type: 'release_all' } });
    await controller.replay(trace, 'from-current');
    injectInput.mockImplementationOnce(() => {
      throw new Error('renderer unavailable');
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(controller.replayStatus()).toBe('failed');
  });
});
