import { describe, expect, it } from 'vitest';
import type { WgslTraceLaunch } from '@shader-studio/types';
import { validateWgslTraceLaunch } from '@shader-studio/types';
import { emitWgslTracePrelude, planWgslTrace, traceVariable } from '../WgslTracePlanner';
import { decodeWgslTrace } from '../WgslTraceDecoder';

const source = `fn helper(x: f32) -> f32 { return x * 2.0; }
fn mainImage(p: vec2f) -> vec4f {
  var total: f32 = 0.25;
  let large: u32 = 4000000001u;
  for (var i = 0u; i < 3u; i++) {
    if (i == 1u) { continue; }
    total += helper(f32(i));
  }
  return vec4f(total);
}`;
const launch: WgslTraceLaunch = { source, path: '/image.wgsl', width: 4, height: 4,
  pixel: [1, 2], time: 0, frame: 0, capacity: 8 };

describe('isolated WGSL trace planner', () => {
  it('records mainImage before statements without modifying helpers or the input', () => {
    const plan = planWgslTrace(launch);
    expect(launch.source).toBe(source);
    expect(plan.source).toContain('fn helper(x: f32) -> f32 { return x * 2.0; }');
    expect(plan.sites.map(site => site.line)).toEqual([3, 4, 5, 6, 6, 7, 9]);
    expect(plan.source).toMatch(/_ss_trace_site0\(p\);\s+var total/);
    expect(plan.sites[0].variables.map(value => value.name)).toEqual(['p']);
    const body = plan.sites.find(site => site.line === 7)!;
    expect(body.variables.map(value => value.name)).toContain('i');
    expect(plan.sites.at(-1)!.variables.map(value => value.name)).not.toContain('i');
    expect(plan.source).not.toContain('break;');
    expect(emitWgslTracePrelude(plan)).toContain('bitcast<u32>(total)');
    expect(emitWgslTracePrelude(plan)).toContain('vec4u(large, 0u, 0u, 0u)');
  });

  it('supports braced else-if chains without inserting hooks between else and if', () => {
    const plan = planWgslTrace({ ...launch, source: `fn mainImage(p: vec2f) -> vec4f {
      var x = 0.0;
      if (p.x < 1.0) { x = 1.0; }
      else if (p.x < 2.0) { x = 2.0; }
      else { x = 3.0; }
      return vec4f(x);
    }` });
    expect(plan.source).toMatch(/else if/);
    expect(plan.source).not.toMatch(/else\s+_ss_trace_/);
    expect(plan.sites.map(site => site.line)).toContain(4);
  });

  it('keeps stepping with explicitly unavailable aggregate locals', () => {
    const plan = planWgslTrace({ ...launch, source: `fn mainImage(p: vec2f) -> vec4f {
      let samples = array<f32, 2>(1.0, 2.0);
      let transform = mat2x2f(1.0, 0.0, 0.0, 1.0);
      let total = samples[0] + samples[1];
      return vec4f(total);
    }` });
    expect(plan.sites.at(-1)!.unavailableVariables).toEqual(expect.arrayContaining([
      { name: 'samples', type: 'array<f32, 2>' }, { name: 'transform', type: 'mat2x2f' },
    ]));
    expect(plan.sites.at(-1)!.variables.map(value => value.name)).toContain('total');
    expect(emitWgslTracePrelude(plan)).not.toContain('samples:');
  });

  it('infers locals from explicit custom uniforms', () => {
    const plan = planWgslTrace({ ...launch, customUniforms: [{ name: 'gain', type: 'float', value: 0.5 }],
      source: 'fn mainImage(p: vec2f) -> vec4f { let result = gain * 2.0; return vec4f(result); }' });
    expect(plan.sites.at(-1)!.variables.find(value => value.name === 'result')?.type).toBe('f32');
  });

  it.each([
    'fn gain() -> f32 { return 1.0; }', 'struct gain { value: f32 }', 'var<private> gain: f32;',
  ])('rejects a custom uniform colliding with an authored global: %s', declaration => {
    expect(() => planWgslTrace({ ...launch, customUniforms: [{ name: 'gain', type: 'float', value: 1 }],
      source: `${declaration} fn mainImage(p: vec2f) -> vec4f { return vec4f(p, 0.0, 1.0); }` })).toThrow('conflicts with an authored global');
  });

  it('allows local shadowing of an explicit custom uniform', () => {
    const plan = planWgslTrace({ ...launch, customUniforms: [{ name: 'gain', type: 'float', value: 0.5 }],
      source: 'fn mainImage(p: vec2f) -> vec4f { let gain = 2.0; return vec4f(gain); }' });
    expect(plan.sites.at(-1)!.variables.find(value => value.name === 'gain')?.type).toBe('f32');
  });

  it('reserves internal counter names when a local is named index', () => {
    const plan = planWgslTrace({ ...launch, source: 'fn mainImage(p: vec2f) -> vec4f { let index = 2u; return vec4f(f32(index)); }' });
    const generated = emitWgslTracePrelude(plan);
    expect(generated).toContain('index: u32');
    expect(generated).toContain('let _ss_trace_index = atomicAdd');
    expect(generated).not.toContain('let index =');
  });

  it('keeps distinct columns for multiple statements on one line', () => {
    const plan = planWgslTrace({ ...launch, source: 'fn mainImage(p: vec2f) -> vec4f { var x = 1.0; x += 2.0; return vec4f(x); }' });
    expect(plan.sites).toHaveLength(3);
    expect(new Set(plan.sites.map(site => site.column)).size).toBe(3);
  });

  it('records the outer value before a shadowing declaration and the inner value afterwards', () => {
    const plan = planWgslTrace({ ...launch, source: `fn mainImage(p: vec2f) -> vec4f {
      let x = 1.0;
      { let x = 2u; let y = x; }
      return vec4f(x);
    }` });
    expect(plan.sites.flatMap(site => site.variables).some(value => value.name === 'x' && value.type === 'u32')).toBe(true);
    expect(plan.sites.at(-1)!.variables.find(value => value.name === 'x')!.type).toBe('f32');
  });

  it.each(['f16', 'mat2x2f', 'array<f32, 2>', 'ptr<function, f32>'])('declines unsupported recorded type %s', type => {
    expect(traceVariable('x', type)).toBeUndefined();
  });

  it.each(['f32', 'i32', 'u32', 'bool', 'vec2f', 'vec3i', 'vec4u', 'vec2<f32>'])('packs supported type %s', type => {
    expect(traceVariable('x', type)).toBeDefined();
  });

  it.each([
    'fn mainImage(p: vec2f) -> vec4f { let _ss_trace_foo = 1.0; return vec4f(1.0); }',
    '@group(1) @binding(0) var<uniform> x: f32; fn mainImage(p: vec2f) -> vec4f { return vec4f(x); }',
    'fn mainImage(p: vec3f) -> vec4f { return vec4f(p, 1.0); }',
    '@compute @workgroup_size(1) fn main() {}',
    'fn mainImage(p: vec2f) -> vec4f { var x = 0.0; if (p.x > 0.0) x = 1.0; return vec4f(x); }',
    'fn mainImage(p: vec2f) -> vec4f { var x = 0.0; for (var i = 0u; i < 2u; i++) x += 1.0; return vec4f(x); }',
  ])('rejects an unsupported source explicitly', source => {
    expect(() => planWgslTrace({ ...launch, source })).toThrow();
  });

  it.each([
    { width: 0 }, { height: 2049 }, { pixel: [4, 0] }, { pixel: [-1, 0] },
    { pixel: [0.5, 0] }, { capacity: 0 }, { capacity: 16385 }, { time: NaN }, { frame: -1 },
  ])('validates launch bounds: %j', patch => {
    expect(() => validateWgslTraceLaunch({ ...launch, ...patch } as WgslTraceLaunch)).toThrow();
  });
});

describe('WGSL trace decoding', () => {
  const plan = planWgslTrace({ ...launch, source: `fn mainImage(p: vec2f) -> vec4f {
    let signed: i32 = -123;
    let large: u32 = 4000000001u;
    let yes = true;
    return vec4f(0.5);
  }` });
  const last = plan.sites.at(-1)!;
  function buffer() {
    const data = new ArrayBuffer(16 + plan.capacity * plan.recordWords * 4);
    const words = new Uint32Array(data);
    const floats = new Float32Array(data);
    words[0] = 1;
    words[4] = last.id;
    for (const [slot, value] of last.variables.entries()) {
      const offset = 8 + slot * 4;
      if (value.name === 'p') {
        floats[offset] = 1.5;
        floats[offset + 1] = 2.5;
      } else {
        words[offset] = { signed: -123 >>> 0, large: 4000000001, yes: 1 }[value.name]!;
      }
    }
    return data;
  }

  it('preserves integer bits, bool and vector components', () => {
    const result = decodeWgslTrace(plan, buffer());
    expect(result.overflow).toBe(false);
    expect(Object.fromEntries(result.events[0].values.map(value => [value.name, value.value])))
      .toEqual({ p: [1.5, 2.5], signed: -123, large: 4000000001, yes: true });
  });

  it('surfaces unavailable values without allocating GPU record slots for them', () => {
    const marked = { ...plan, sites: plan.sites.map(site => ({ ...site,
      unavailableVariables: [{ name: 'weights', type: 'array<f32, 2>' }] })) };
    const result = decodeWgslTrace(marked, buffer());
    expect(result.events[0].values.at(-1)).toEqual({ name: 'weights', type: 'array<f32, 2>',
      value: '<not recorded: unsupported or unresolved type>' });
    expect(result.events[0].values.find(value => value.name === 'large')?.value).toBe(4000000001);
  });

  it('bounds decoding and exposes overflow', () => {
    const data = buffer();
    new Uint32Array(data)[0] = plan.capacity + 1;
    new Uint32Array(data)[1] = 1;
    expect(decodeWgslTrace(plan, data).events).toHaveLength(plan.capacity);
    expect(decodeWgslTrace(plan, data).overflow).toBe(true);
  });

  it('preserves special floats through JSON transport', () => {
    const floatPlan = planWgslTrace({ ...launch, source: 'fn mainImage(p: vec2f) -> vec4f { let x = vec4f(1.0); return x; }' });
    const site = floatPlan.sites.at(-1)!;
    const data = new ArrayBuffer(16 + floatPlan.capacity * floatPlan.recordWords * 4);
    const words = new Uint32Array(data);
    words[0] = 1;
    words[4] = site.id;
    const slot = site.variables.findIndex(value => value.name === 'x');
    new Float32Array(data).set([NaN, Infinity, -Infinity, -0], 8 + slot * 4);
    const transmitted = JSON.parse(JSON.stringify(decodeWgslTrace(floatPlan, data)));
    expect(transmitted.events[0].values.find((value: { name: string }) => value.name === 'x').value)
      .toEqual(['NaN', 'Infinity', '-Infinity', '-0']);
  });

  it('rejects malformed sizes and unknown site ids', () => {
    expect(() => decodeWgslTrace(plan, new ArrayBuffer(0))).toThrow('size');
    const data = buffer();
    new Uint32Array(data)[4] = 999;
    expect(() => decodeWgslTrace(plan, data)).toThrow('site');
  });
});
