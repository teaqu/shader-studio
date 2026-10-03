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

  it('marks aggregate locals unavailable and still captures scalar results', async () => {
    const recording = await captureWgslTrace({ ...launch, source: `struct Sample { value: f32 }
    fn mainImage(p: vec2f) -> vec4f {
      let weights = array<f32, 2>(0.25, 0.5);
      let basis = mat2x2f(1.0, 0.0, 0.0, 1.0);
      let sample = Sample(0.125);
      let total = weights[0] + weights[1] + sample.value;
      return vec4f(total);
    }` });
    const locals = Object.fromEntries(recording.events.at(-1)!.values.map(local => [local.name, local.value]));
    expect(locals).toMatchObject({ weights: '<not recorded: unsupported or unresolved type>',
      basis: '<not recorded: unsupported or unresolved type>', sample: '<not recorded: unsupported or unresolved type>', total: 0.875 });
    expect(recording.color).toEqual([0.875, 0.875, 0.875, 0.875]);
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
