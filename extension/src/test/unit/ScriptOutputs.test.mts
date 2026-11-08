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
describe('legacy script vector compatibility', () => {
  it.each([2, 3, 4])('keeps vec%i arity inference when legacy values change', length => {
    vi.useFakeTimers();
    const { evaluator, result } = load(`uniforms(ctx) { return { legacy: Array.from({length:${length}}, (_, index) => ctx.iTime === 0 ? index + 1 : 'legacy' + index) }; }`);
    expect(result.error).toBeUndefined();
    const callback = vi.fn();
    evaluator.startPolling(callback, 100);
    vi.advanceTimersByTime(100);
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback.mock.calls[1][0]).toEqual([{name: 'legacy', type: `vec${length}`, value: Array.from({length}, (_, index) => `legacy${index}`)}]);
  });
});

it('snapshots reused legacy vectors without weakening explicit array validation', () => {
  vi.useFakeTimers();
  const { evaluator } = load(`uniforms: (() => { const vector = [1,2]; return ctx => { vector[0] = ctx.iTime === 0 ? 1 : '3.5'; return {legacy: vector}; }; })()`);
  const callback = vi.fn();
  evaluator.startPolling(callback, 100);
  vi.advanceTimersByTime(100);
  expect(callback.mock.calls[0][0][0].value).toEqual([1,2]);
  expect(callback.mock.calls[1][0][0].value).toEqual(['3.5',2]);
  const invalid = load(`uniforms(ctx) { return {explicit: ctx.floatArray(['3.5',2])}; }`);
  expect(invalid.result.error).toContain('Invalid float');
});

describe('script backend capabilities', () => {
  it('rejects stream exports on WebGL before opening sources, while keeping uniform-only scripts supported', () => {
    const evaluator = new ScriptEvaluator();
    live.push(evaluator);
    const log = vi.spyOn(console, 'log').mockImplementation(() => { });
    try {
      const result = evaluator.loadScript(`var __shaderUniforms={streams(){console.log('opened');return {};}};`, undefined, false);
      expect(result.error).toContain('WebGPU');
      expect(log).not.toHaveBeenCalled();
      expect(evaluator.loadScript(`var __shaderUniforms={uniforms(ctx){return {_counter:ctx.uint(3)};}};`, undefined, false).error).toBeUndefined();
    } finally {
      log.mockRestore();
    }
  });
});

describe('stream evaluator edge cases', () => {
  it.each([
    ['streams(){return null;}', 'named object'],
    ['streams(){return 1;}', 'named object'],
    ['streams(){return [];}', 'named object'],
    ['streams(ctx){return Object.fromEntries(Array.from({length:9},(_,i)=>["s"+i,ctx.stream()]));}', 'at most 8'],
    ['streams(ctx){ctx.onDispose(1);return {};}', 'onDispose expects'],
    ['uniforms(){return null;}', 'synchronously'],
    ['uniforms(){return 1;}', 'synchronously'],
    ['uniforms(){return [];}', 'synchronously'],
    ['uniforms(){return Promise.resolve({});}', 'synchronously'],
    ['uniforms(){throw "plain failure";}', 'plain failure'],
    ['uniforms(){throw {message:42};}', '42'],
  ])('rejects malformed exports %s', (code, error) => {
    expect(load(code).result.error).toContain(error);
  });
  it.each(['gl_custom', 'a__b', 'iChannel19', 'iCh9', '_stExtra', '_dbgExtra', '_scriptStreamExtra', '_ScriptStreamExtra', 'bad-name'])('rejects reserved name %s', name => {
    expect(load(`uniforms(){return {${JSON.stringify(name)}:1};}`).result.error).toContain('invalid');
  });
  it('disposes unexported streams and rejects creation from a retained disposed context', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { evaluator, result } = load(`streams(ctx){const unused=ctx.stream();console.log({ctx,unused,setTimeout,setInterval});return {net:ctx.stream()};}`);
      expect(result.error).toBeUndefined();
      const retained = log.mock.calls[0][0] as {
        ctx: {stream: () => unknown; onDispose: (cleanup: () => void) => void};
        unused: {push: (words: number[]) => boolean};
        setTimeout: (callback: () => void) => unknown;
        setInterval: (callback: () => void) => unknown;
      };
      expect(retained.unused.push([1])).toBe(false);
      evaluator.dispose();
      expect(() => retained.ctx.stream()).toThrow('disposed');
      const cleanup = vi.fn();
      retained.ctx.onDispose(cleanup);
      expect(cleanup).toHaveBeenCalledOnce();
      expect(retained.setTimeout(vi.fn())).toBeUndefined();
      expect(retained.setInterval(vi.fn())).toBeUndefined();
    } finally {
      log.mockRestore();
    }
  });
  it('forwards timer arguments, clears timers explicitly, and contains asynchronous callback errors', () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      load(`streams(ctx){
        const net=ctx.stream();
        const cancelled=setTimeout(()=>console.log('cancelled'),1);clearTimeout(cancelled);
        const cancelledInterval=setInterval(()=>console.log('cancelled'),1);clearInterval(cancelledInterval);
        setTimeout((a,b)=>console.log(a,b),2,'arg',7);
        setTimeout(()=>{throw Error('timeout');},3);
        setInterval(()=>{throw Error('interval');},5);
        return {net};
      }`);
      vi.advanceTimersByTime(10);
      expect(log).toHaveBeenCalledExactlyOnceWith('arg', 7);
      expect(vi.getTimerCount()).toBe(1);
    } finally {
      log.mockRestore();
    }
  });
  it('limits live cursors, reports source/consumer queues and releases slots safely', () => {
    const { evaluator, result } = load(`streams(ctx){const net=ctx.stream({maxPerFrame:1});net.push([1,2]);return {net};}`);
    const session = result.session!;
    expect(evaluator.getStreamQueues(session - 1, 'missing')).toBeNull();
    expect(evaluator.getStreamQueues(session, 'missing')).toEqual([{name: 'net', queued: 2}]);
    const first = evaluator.requestStreamFrame(session, undefined, 'first')!;
    expect(evaluator.requestStreamFrame(session, first.sequence + 1, 'first')).toBe(first);
    evaluator.requestStreamFrame(session, first.sequence, 'first');
    expect(evaluator.getStreamQueues(session, 'first')).toEqual([{name: 'net', queued: 1}]);
    for (let i = 1; i < 16; i++) {
      evaluator.requestStreamFrame(session, undefined, `other${i}`);
    }
    expect(() => evaluator.requestStreamFrame(session, undefined, 'overflow')).toThrow('at most 16');
    evaluator.releaseStreamConsumer(session - 1, 'first');
    evaluator.releaseStreamConsumer(session, 'missing');
    expect(() => evaluator.requestStreamFrame(session, undefined, 'overflow')).toThrow('at most 16');
    evaluator.releaseStreamConsumer(session, 'first');
    expect(evaluator.requestStreamFrame(session, undefined, 'overflow')).not.toBeNull();
    evaluator.dispose();
    expect(evaluator.getStreamQueues(session, 'overflow')).toBeNull();
    expect(evaluator.requestStreamFrame(session)).toBeNull();
    expect(evaluator.currentValues()).toEqual([]);
  });
  it('skips unsupported uniform values and preserves typed zero shapes after runtime errors', () => {
    const { evaluator, result } = load(`uniforms(ctx){if(ctx.iTime>0)throw Error('runtime');return {ignored:'text',flag:true,vector:[1,2,3,4],array:ctx.uintArray([1,2]),scalar:ctx.int(4)};}`);
    expect(result.uniforms.map(value => value.name)).not.toContain('ignored');
    evaluator.setRuntimeState({time: 1, paused: true});
    expect(evaluator.currentValues()).toEqual([
      {name:'flag',type:'bool',value:false}, {name:'vector',type:'vec4',value:[0,0,0,0]},
      {name:'array',type:'uint[2]',value:[0,0]}, {name:'scalar',type:'int',value:0},
    ]);
  });
});
