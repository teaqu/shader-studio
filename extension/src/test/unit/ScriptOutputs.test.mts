import { describe, it, expect, vi, afterEach } from 'vitest';
vi.mock('../../app/services/Logger.js', () => ({ Logger: { getInstance: () => ({ warn: vi.fn() }) } }));
import { ScriptEvaluator } from '../../app/ScriptEvaluator.js';
const live: ScriptEvaluator[] = [];
function load(exports: string) {
  const evaluator = new ScriptEvaluator();
  live.push(evaluator);
  const result = evaluator.loadScript(`var __shaderUniforms = { ${exports} };`);
  return { evaluator, result };
}
afterEach(() => {
  for (const evaluator of live.splice(0)) {
    evaluator.dispose();
  }
  vi.useRealTimers();
});
describe('separate script outputs', () => {
  it('initializes multiple streams once, retains pre-return pushes and leases until acknowledged', () => {
    const { evaluator, result } = load(`streams(ctx) {
      const net = ctx.stream({maxPerFrame: 2, maxQueued: 5});
      const uart = ctx.stream({maxPerFrame: 1});
      net.push([1, 2, 3]); uart.push([4294967295]); return {net, uart};
    }`);
    expect(result.error).toBeUndefined();
    expect(result.uniforms).toEqual([]);
    expect(evaluator.hasUniforms()).toBe(false);
    const frame = evaluator.requestStreamFrame(result.session!);
    expect(frame?.streams.map(s => s.data)).toEqual([[1, 2], [4294967295]]);
    expect(evaluator.requestStreamFrame(result.session!)).toBe(frame);
    const next = evaluator.requestStreamFrame(result.session!, frame!.sequence);
    expect(next?.streams.map(s => s.data)).toEqual([[3], []]);
    expect(evaluator.requestStreamFrame(result.session! - 1)).toBeNull();
    evaluator.resetTime();
    expect(evaluator.requestStreamFrame(result.session!)?.streams[0].data).toEqual([]);
  });
  it('preserves existing inference and emits typed integer/array values', () => {
    const { evaluator, result } = load(`uniforms(ctx) { return {
      f: 0.5, v: [1,2,3], b: true, i: ctx.int(-2), u: ctx.uint(4294967295), a: ctx.floatArray([1,2]), ints: ctx.intArray([-1,2]), words: ctx.uintArray([0,4294967295])
    }; }`);
    expect(result.error).toBeUndefined();
    expect(result.declarations).toContain('uniform float a[2];');
    const callback = vi.fn();
    evaluator.startPolling(callback);
    expect(callback.mock.calls[0][0]).toContainEqual({ name: 'u', type: 'uint', value: 4294967295 });
    expect(callback.mock.calls[0][0]).toContainEqual({ name: 'a', type: 'float[2]', value: [1, 2] });
  });
  it('runs cleanup on reload, disposal, and initialization failure, even if another cleanup throws', () => {
    const cleanup = vi.fn();
    const other = vi.fn();
    const evaluator = new ScriptEvaluator();
    live.push(evaluator);
    // Console is intentionally available to user scripts; spies observe VM lifecycle.
    const log = vi.spyOn(console, 'log').mockImplementation(cleanup);
    const warn = vi.spyOn(console, 'warn').mockImplementation(other);
    try {
      const code = `var __shaderUniforms={streams(ctx){ const s=ctx.stream(); ctx.onDispose(()=>console.log('closed'));ctx.onDispose(()=>{console.warn('closed');throw Error('cleanup');}); return {net:s}; }};`;
      expect(evaluator.loadScript(code).error).toBeUndefined();
      evaluator.loadScript(code);
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(other).toHaveBeenCalledTimes(1);
      evaluator.dispose();
      expect(cleanup).toHaveBeenCalledTimes(2);
      expect(evaluator.loadScript(`var __shaderUniforms={streams(ctx){ctx.onDispose(()=>console.log('failed'));throw Error('init');}};`).error).toContain('init');
      expect(cleanup).toHaveBeenCalledTimes(3);
    } finally {
      log.mockRestore();
      warn.mockRestore();
    }
  });
  it.each([
    ['streams(ctx){ return Promise.resolve({}); }', 'synchronously'],
    ['streams(ctx){return {net:{push(){}}};}', 'unique ctx.stream'],
    ['streams(ctx){const s=ctx.stream();return {a:s,b:s};}', 'unique ctx.stream'],
    ['streams(ctx){return {iTime:ctx.stream()};}', 'built-ins'],
    ['streams(ctx){return {net:ctx.stream()};},uniforms(){return {net:1};}', 'conflict'],
    ['uniforms(ctx){return {u:ctx.uint(-1)};}', 'Invalid uint'],
    ['uniforms(ctx){return {"bad-name":1};}', 'invalid'],
    ['', 'uniforms(ctx) or streams(ctx)'],
  ])('rejects invalid exports: %s', (code, error) => {
    expect(load(code).result.error).toContain(error);
  });
  it('freezes array shapes and snapshots reused arrays for change detection', () => {
    vi.useFakeTimers();
    const { evaluator } = load(`uniforms(ctx){return {a:ctx.intArray(ctx.iTime < 0.15 ? [ctx.iFrame,2] : [1,2,3])};}`);
    const callback = vi.fn();
    evaluator.startPolling(callback, 100);
    vi.advanceTimersByTime(100);
    expect(callback).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(100);
    expect(callback).toHaveBeenCalledTimes(2);
  });
});
describe('script lifecycle and independent preview cursors', () => {
  it('stops source timers on disposal and failed loads', () => {
    vi.useFakeTimers();
    const { evaluator, result } = load(`streams(ctx){const s=ctx.stream();setInterval(()=>s.push([7]),10);setTimeout(()=>s.push([9]),5);return {net:s};}`);
    vi.advanceTimersByTime(20);
    const frame = evaluator.requestStreamFrame(result.session!);
    expect(frame?.streams[0].data).toEqual([9, 7, 7]);
    evaluator.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(evaluator.loadScript('setInterval(()=>{},10);var __shaderUniforms={};').error).toBeDefined();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('lets previews acknowledge independently and releases a slow preview', () => {
    vi.useFakeTimers();
    const { evaluator, result } = load(`streams(ctx){const s=ctx.stream({maxPerFrame:1,maxQueued:2});let n=0;setInterval(()=>s.push([++n]),10);return {net:s};}`);
    evaluator.requestStreamFrame(result.session!, undefined, 'fast');
    evaluator.requestStreamFrame(result.session!, undefined, 'slow');
    vi.advanceTimersByTime(20);
    let fast = evaluator.requestStreamFrame(result.session!, 1, 'fast')!;
    const slow = evaluator.requestStreamFrame(result.session!, 2, 'slow')!;
    expect(fast.streams[0].data).toEqual([1]);
    expect(slow.streams[0].data).toEqual([1]);
    fast = evaluator.requestStreamFrame(result.session!, fast.sequence, 'fast')!;
    expect(fast.streams[0].data).toEqual([2]);
    evaluator.releaseStreamConsumer(result.session!, 'slow');
    vi.advanceTimersByTime(10);
    fast = evaluator.requestStreamFrame(result.session!, fast.sequence, 'fast')!;
    expect(fast.streams[0].data).toEqual([3]);
  });
});
describe('script backend capabilities', () => {
  it('rejects stream exports on WebGL before opening sources, while keeping uniform-only scripts supported', () => {
    const evaluator = new ScriptEvaluator();
    live.push(evaluator);
    const log = vi.spyOn(console, 'log').mockImplementation(() => { });
    try {
      const result = evaluator.loadScript(`var __shaderUniforms={streams(){console.log('opened');return {};}};`, undefined, false);
      expect(result.error).toContain('Slang / WebGPU');
      expect(log).not.toHaveBeenCalled();
      expect(evaluator.loadScript(`var __shaderUniforms={uniforms(ctx){return {_counter:ctx.uint(3)};}};`, undefined, false).error).toBeUndefined();
    } finally {
      log.mockRestore();
    }
  });
});
