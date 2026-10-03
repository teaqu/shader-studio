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
