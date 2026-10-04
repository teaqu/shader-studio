import { describe, expect, it } from 'vitest';
import { planWgslTraceProgram, type WgslTraceProgramRequest } from '../WgslTraceProgramPlanner';

const source = '@compute @workgroup_size(1) fn kernel() { let value = 1u; }';
const request: WgslTraceProgramRequest = { source, entryPoint: 'kernel', stage: 'compute', capacity: 1,
  sourceRanges: [{ path: '/compute.wgsl', startLine: 1, endLine: 1 }] };

describe('production program trace planning', () => {
  it.each([{ path: '', startLine: 1, endLine: 1 }, { path: '/a', startLine: 0, endLine: 1 },
    { path: '/a', startLine: 2, endLine: 1 }])('rejects invalid source identity %j', range => {
    expect(() => planWgslTraceProgram({ ...request, sourceRanges: [range] })).toThrow('source ranges');
  });

  it('rejects missing entries, malformed sources and ranges without executable statements', () => {
    expect(() => planWgslTraceProgram({ ...request, entryPoint: 'missing' })).toThrow('not found');
    expect(() => planWgslTraceProgram({ ...request, source: 'fn kernel(' })).toThrow();
    expect(() => planWgslTraceProgram({ ...request, sourceRanges: [] })).toThrow('no statements');
  });

  it.each([
    ['fragment', '@fragment fn kernel(@location(0) uv: vec2f) -> @location(0) vec4f { return vec4f(uv, 0, 1); }', '@builtin(position) _ss_trace_position: vec4f', 'floor(_ss_trace_position.xy)'],
    ['compute', '@compute @workgroup_size(1) fn kernel(@builtin(global_invocation_id) gid: vec3u) { let value = gid.x; }', '@builtin(global_invocation_id) gid: vec3u', 'all(gid == vec3u'],
    ['vertex', '@vertex fn kernel(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f { return vec4f(f32(index)); }', '@builtin(vertex_index) index: u32', 'index == u32'],
  ] as const)('preserves authored %s inputs while adding only missing selectors', (stage, source, parameter, gate) => {
    const plan = planWgslTraceProgram({ ...request, stage, source });
    expect(plan.source).toContain(parameter); expect(plan.source).toContain(gate);
    expect(plan.source.match(new RegExp(parameter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(1);
    expect(plan.bindingGroup).toBe(0);
  });

  it('tracks lexical shadowing and loop-local lifetimes without tracing the for header', () => {
    const source = `@group(2) @binding(0) var<uniform> settings: vec4f;
@compute @workgroup_size(1) fn kernel() {
  var value = 1u;
  for (var i = 0u; i < 2u; i++) {
    let value = i;
    let nested = value;
  }
  let after = value;
  var unsupported: array<f32, 2>;
  let final = after;
}`;
    const plan = planWgslTraceProgram({ ...request, source, sourceRanges: [{ path: '/compute.wgsl', startLine: 1, endLine: 11 }] });
    const nested = plan.sites.find(site => site.line === 6)!;
    expect(nested.variables.filter(value => value.name === 'value')).toHaveLength(1);
    expect(nested.variables.some(value => value.name === 'i')).toBe(true);
    const after = plan.sites.find(site => site.line === 8)!;
    expect(after.variables.some(value => value.name === 'i')).toBe(false);
    expect(plan.sites.filter(site => site.line === 4)).toHaveLength(1);
    expect(plan.sites.at(-1)?.valueShapes?.some(value => value.name === 'unsupported')).toBe(true);
    expect(plan.bindingGroup).toBe(3);
  });
});
