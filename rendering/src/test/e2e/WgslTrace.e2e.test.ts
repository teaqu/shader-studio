import { describe, expect, it } from 'vitest';
import { captureWgslTrace } from '../../trace/WgslTraceCapture';

const source = `fn helper(x: f32) -> f32 { return x * 2.0; }
fn mainImage(p: vec2f) -> vec4f {
  var total: f32 = 0.25;
  let large: u32 = 4000000001u;
  for (var i = 0u; i < 3u; i++) {
    if (i == 1u) { continue; }
    total += helper(f32(i));
  }
  let gradient = dpdx(p.x);
  return vec4f(total, gradient, p.x / 4.0, p.y / 4.0);
}`;
const launch = { source, path: '/image.wgsl', width: 4, height: 4, pixel: [1, 2] as [number, number],
  time: 0, frame: 0, capacity: 64 };

describe('WGSL GPU trace PoC', () => {
  it('records repeated loop visits, exact locals and normal fragment derivatives', async () => {
    const recording = await captureWgslTrace(launch);
    expect(recording.overflow).toBe(false);
    const condition = recording.sites.find(site => site.line === 6)!;
    expect(recording.events.filter(event => event.siteId === condition.id)).toHaveLength(3);
    expect(recording.events.filter(event => event.line === 7)).toHaveLength(2);
    const final = Object.fromEntries(recording.events.at(-1)!.values.map(value => [value.name, value.value]));
    expect(final).toMatchObject({ p: [1.5, 1.5], total: 4.25, large: 4000000001, gradient: 1 });
    expect(recording.color).toEqual([4.25, 1, 0.375, 0.375]);
  });

  it('captures the preview mouse, clock and camera inputs instead of defaults', async () => {
    const recording = await captureWgslTrace({ ...launch, uniforms: {
      mouse: [7, 8, 9, 10], date: [2026, 10, 3, 100], cameraPos: [1, 2, 3], cameraDir: [4, 5, 6],
      timeDelta: 0.25, frameRate: 60, sampleRate: 48000,
    }, source: `fn mainImage(p: vec2f) -> vec4f {
      let mouse = iMouse;
      let date = iDate;
      let delta = iTimeDelta;
      let rate = iFrameRate;
      let camera = iCameraPos;
      let direction = iCameraDir;
      let sample = iSampleRate;
      return vec4f(mouse.x, date.z, delta, rate);
    }` });
    expect(recording.color).toEqual([7, 3, 0.25, 60]);
    const final = Object.fromEntries(recording.events.at(-1)!.values.map(value => [value.name, value.value]));
    expect(final).toMatchObject({ mouse: [7, 8, 9, 10], date: [2026, 10, 3, 100], delta: 0.25, rate: 60,
      camera: [1, 2, 3], direction: [4, 5, 6], sample: 48000 });
  });

  it('stops recording at capacity while letting the shader finish unchanged', async () => {
    const recording = await captureWgslTrace({ ...launch, capacity: 2 });
    expect(recording.events).toHaveLength(2);
    expect(recording.overflow).toBe(true);
    expect(recording.color).toEqual([4.25, 1, 0.375, 0.375]);
  });

  it('reports compiler failures and allows a subsequent successful capture', async () => {
    await expect(captureWgslTrace({ ...launch, source: 'fn mainImage(p: vec2f) -> vec4f { return undefinedHelper(p); }' }))
      .rejects.toThrow('compilation failed');
    expect((await captureWgslTrace(launch)).events.length).toBeGreaterThan(0);
  });

  it('honours cancellation without returning a recording', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(captureWgslTrace(launch, controller.signal)).rejects.toThrow();
  });

  it('records signed vectors, bools, explicit uniforms and a loop break', async () => {
    const recording = await captureWgslTrace({ ...launch, time: 0.25, frame: 1, source: `fn mainImage(p: vec2f) -> vec4f {
      let negative: i32 = -17;
      let yes = p.x > 0.0;
      let components = vec3i(-1, 2, -3);
      var value = iTime + f32(iFrame);
      while (value < 3.0) {
        value += 1.0;
        if (value > 2.0) { break; }
      }
      return vec4f(value);
    }` });
    const final = Object.fromEntries(recording.events.at(-1)!.values.map(value => [value.name, value.value]));
    expect(final).toMatchObject({ negative: -17, yes: true, components: [-1, 2, -3], value: 2.25 });
    expect(recording.color).toEqual([2.25, 2.25, 2.25, 2.25]);
  });

  it('retains records before discard without claiming later helper-invocation execution', async () => {
    const recording = await captureWgslTrace({ ...launch, source: `fn mainImage(p: vec2f) -> vec4f {
      let value = 0.5;
      discard;
      return vec4f(value);
    }` });
    expect(recording.events.map(event => event.line)).toEqual([2, 3]);
    expect(recording.color).toEqual([0, 0, 0, 0]);
  });
});

describe('WGSL trace coverage gaps', () => {
  it('takes every else-if branch and preserves preceding-statement locals', async () => {
    const source = `fn mainImage(p: vec2f) -> vec4f {
      var value = 0.0;
      if (p.x < 1.0) { value = 0.25; }
      else if (p.x < 2.0) { value = 0.5; }
      else { value = 0.75; }
      return vec4f(value);
    }`;
    for (const [pixel, line, value] of [[0, 3, 0.25], [1, 4, 0.5], [2, 5, 0.75]]) {
      const recording = await captureWgslTrace({ ...launch, source, pixel: [pixel, 0] });
      expect(recording.events.map(event => event.line)).toEqual([2, 3, line, 6]);
      expect(recording.events.at(-2)!.values.find(local => local.name === 'value')?.value).toBe(0);
      expect(recording.events.at(-1)!.values.find(local => local.name === 'value')?.value).toBe(value);
      expect(recording.color).toEqual([value, value, value, value]);
    }
  });

  it('decodes nested struct, array and matrix aggregate leaves without changing shader output', async () => {
    const recording = await captureWgslTrace({ ...launch, source: `struct Sample { value: f32 }
    fn mainImage(p: vec2f) -> vec4f {
      let weights = array<f32, 2>(0.25, 0.5);
      let basis = mat2x2f(1.0, 0.0, 0.0, 1.0);
      let sample = Sample(0.125);
      let total = weights[0] + weights[1] + sample.value;
      return vec4f(total);
    }` });
    const locals = Object.fromEntries(recording.events.at(-1)!.values.map(local => [local.name, local]));
    expect(locals.total.value).toBe(0.875);
    for (const name of ['weights', 'basis', 'sample']) {
      expect(locals[name].value).toEqual(expect.any(String));
      expect(locals[name].children).toBeDefined();
    }
    expect(locals.weights.children).toMatchObject([
      { name: '[0]', type: 'f32', value: 0.25 }, { name: '[1]', type: 'f32', value: 0.5 },
    ]);
    expect(locals.basis.children).toMatchObject([
      { name: '[0]', type: 'vec2f', value: [1, 0] }, { name: '[1]', type: 'vec2f', value: [0, 1] },
    ]);
    expect(locals.sample.children).toMatchObject([{ name: 'value', type: 'f32', value: 0.125 }]);
    expect(recording.color).toEqual([0.875, 0.875, 0.875, 0.875]);
  });

  it('reconstructs caller locals across nested repeated helper calls', async () => {
    const recording = await captureWgslTrace({ ...launch, source: `struct Payload {
      weights: array<f32, 2>,
      basis: mat2x2f,
    }
    fn leaf(payload: Payload) -> f32 {
      let total = payload.weights[0] + payload.weights[1] + payload.basis[1][1];
      return total;
    }
    fn helper(payload: Payload) -> f32 {
      return leaf(payload);
    }
    fn mainImage(p: vec2f) -> vec4f {
      let payload = Payload(array<f32, 2>(0.25, 0.5), mat2x2f(1.0, 0.0, 0.0, 1.0));
      let first = helper(payload);
      let second = helper(payload);
      return vec4f(first + second);
    }` });
    const helperEvents = recording.events.filter(event => event.frames?.[0]?.functionName === 'helper');
    expect(helperEvents).toHaveLength(2);
    expect(new Set(helperEvents.map(event => event.frames![0]!.id)).size).toBe(2);
    const helper = helperEvents.find(event => event.frames!.length >= 2)!;
    const leaf = recording.events.find(event => event.frames?.[0]?.functionName === 'leaf')!;
    expect(leaf.frames).toHaveLength(3);
    const payload = leaf.frames![0]!.values.find(value => value.name === 'payload')!;
    expect(payload.children).toMatchObject([
      { name: 'weights', children: [{ name: '[0]', value: 0.25 }, { name: '[1]', value: 0.5 }] },
      { name: 'basis', children: [{ name: '[0]', value: [1, 0] }, { name: '[1]', value: [0, 1] }] },
    ]);
    const callerPayload = leaf.frames![1]!.values.find(value => value.name === 'payload');
    expect(callerPayload?.children).toMatchObject([{ name: 'weights' }, { name: 'basis' }]);
    expect(recording.color).toEqual([3.5, 3.5, 3.5, 3.5]);
  });

  it('preserves contextual abstract-int conversion through a typed unsigned helper return', async () => {
    const recording = await captureWgslTrace({ ...launch, source: `fn unsigned() -> u32 {
      return 1;
    }
    fn mainImage(p: vec2f) -> vec4f {
      let value = f32(unsigned());
      return vec4f(value);
    }` });
    expect(recording.events.some(event => event.frames?.[0]?.functionName === 'unsigned')).toBe(true);
    expect(recording.color).toEqual([1, 1, 1, 1]);
  });

  it('restores the caller frame after void fallthrough and conditional early-return helpers', async () => {
    const recording = await captureWgslTrace({ ...launch, source: `fn guard(value: f32) {
      if (value < 0.0) { return; }
      let observed = value;
    }
    fn mainImage(p: vec2f) -> vec4f {
      guard(p.x);
      guard(-1.0);
      let color = vec4f(0.5);
      return color;
    }` });
    const helperIndexes = recording.events.map((event, index) => [event, index] as const)
      .filter(([event]) => event.frames?.[0]?.functionName === 'guard');
    expect(new Set(helperIndexes.map(([event]) => event.frames![0]!.id)).size).toBe(2);
    expect(helperIndexes.every(([event]) => event.frames?.length === 2)).toBe(true);
    for (const [event, index] of helperIndexes) {
      const restored = recording.events.slice(index + 1).find(candidate => candidate.frames?.[0]?.functionName === 'mainImage');
      expect(restored?.frames).toHaveLength(1);
      expect(restored?.frames?.some(frame => frame.id === event.frames![0]!.id)).toBe(false);
    }
    expect(recording.color).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it('packs explicit custom float/vector/bool uniforms and infers their locals', async () => {
    const recording = await captureWgslTrace({ ...launch, customUniforms: [
      { name: 'gain', type: 'float', value: 0.5 }, { name: 'offset', type: 'vec2', value: [0.125, 0.25] },
      { name: 'tint', type: 'vec3', value: [0.25, 0.5, 0.75] }, { name: 'alpha', type: 'vec4', value: [0, 0, 0, 1] },
      { name: 'enabled', type: 'bool', value: true },
    ], source: `fn mainImage(p: vec2f) -> vec4f {
      let isEnabled = enabled;
      let color = vec4f(tint * gain + vec3f(offset, 0.0), alpha.w);
      return select(vec4f(0.0), color, isEnabled);
    }` });
    const values = Object.fromEntries(recording.events.at(-1)!.values.map(local => [local.name, local.value]));
    expect(values).toMatchObject({ isEnabled: true, color: [0.25, 0.5, 0.375, 1] });
    expect(recording.color).toEqual([0.25, 0.5, 0.375, 1]);
    const off = await captureWgslTrace({ ...launch, customUniforms: [{ name: 'enabled', type: 'bool', value: false }],
      source: 'fn mainImage(p: vec2f) -> vec4f { let isEnabled = enabled; return select(vec4f(0.0), vec4f(1.0), isEnabled); }' });
    expect(off.color).toEqual([0, 0, 0, 0]);
  });
});

it('allows a shader local named index without colliding with the trace counter', async () => {
  const recording = await captureWgslTrace({ ...launch, source: `fn mainImage(p: vec2f) -> vec4f {
    let index = 2u;
    return vec4f(f32(index));
  }` });
  expect(recording.events.at(-1)!.values.find(value => value.name === 'index')?.value).toBe(2);
  expect(recording.color).toEqual([2, 2, 2, 2]);
});
