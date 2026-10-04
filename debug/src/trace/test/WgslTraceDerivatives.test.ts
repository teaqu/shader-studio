import { describe, expect, it } from 'vitest';
import { parseWgslDocument } from '@shader-studio/wgsl-analysis';
import { normalizeWgslTraceDerivatives } from '../WgslTraceDerivatives';

const normalize = (source: string) => normalizeWgslTraceDerivatives(parseWgslDocument('/image.wgsl', source, 'fragment'), source);

describe('WGSL trace derivative normalization', () => {
  it.each([
    ['fwidth', ''], ['fwidthFine', 'Fine'], ['fwidthCoarse', 'Coarse'],
  ])('preserves %s scalar and vector precision', (builtin, suffix) => {
    const source = `fn mainImage(p: vec2f) -> vec4f {
      let scalar = ${builtin}(p.x);
      let vector = ${builtin}(p);
      return vec4f(vector, scalar, 1.0);
    }`;
    const result = normalize(source);
    expect(result).toContain(`fn _ss_trace_${builtin}_f32(x: f32) -> f32`);
    expect(result).toContain(`fn _ss_trace_${builtin}_vec2f(x: vec2f) -> vec2f`);
    expect(result).toContain(`return abs(dpdx${suffix}(x)) + abs(dpdy${suffix}(x));`);
    expect(result).toContain(`_ss_trace_${builtin}_vec2f(p)`);
  });

  it('deduplicates helpers for nested and repeated calls', () => {
    const result = normalize('fn mainImage(p: vec2f) -> vec4f { let x = fwidth(fwidth(p.x)); return vec4f(fwidth(p.x) + x); }');
    expect(result.match(/fn _ss_trace_fwidth_f32/g)).toHaveLength(1);
    expect(result).toContain('_ss_trace_fwidth_f32(_ss_trace_fwidth_f32(p.x))');
  });

  it('resolves aliases and host-provided float types', () => {
    const source = 'alias FloatVector = vec3<f32>; fn mainImage(p: vec2f) -> vec4f { let v: FloatVector = vec3f(p, 1.0); return vec4f(fwidth(v), fwidth(host)); }';
    const document = parseWgslDocument('/image.wgsl', source, 'fragment');
    const result = normalizeWgslTraceDerivatives(document, source, () => true, { variableType: name => name === 'host' ? 'f32' : undefined });
    expect(result).toContain('x: vec3<f32>');
    expect(result).toContain('_ss_trace_fwidth_f32(host)');
  });

  it('leaves authored functions, unresolved values and unsupported types intact', () => {
    const shadow = 'fn fwidth(x: f32) -> f32 { return x; } fn mainImage(p: vec2f) -> vec4f { return vec4f(fwidth(p.x)); }';
    expect(normalize(shadow)).toBe(shadow);
    const unknown = 'fn mainImage(p: vec2f) -> vec4f { return vec4f(fwidth(missing)); }';
    expect(normalize(unknown)).toBe(unknown);
    const unsupported = 'fn mainImage(p: vec2f) -> vec4f { let m = mat2x2f(1.0, 0.0, 0.0, 1.0); return vec4f(fwidth(m)); }';
    expect(normalize(unsupported)).toBe(unsupported);
    const malformed = 'fn mainImage(p: vec2f) -> vec4f { return vec4f(fwidth(p.x; }';
    expect(normalize(malformed)).toBe(malformed);
  });

  it('restricts normalization to authored regions while preserving other call positions', () => {
    const source = `fn generated(x: f32) -> f32 { return fwidth(x); }
fn mainImage(p: vec2f) -> vec4f { return vec4f(fwidth(p.x)); }`;
    const result = normalizeWgslTraceDerivatives(parseWgslDocument('/image.wgsl', source, 'fragment'), source, line => line === 2);
    expect(result).toContain('return fwidth(x);');
    expect(result).toContain('vec4f(_ss_trace_fwidth_f32(p.x))');
  });

  it('rejects changed call order instead of rewriting a different expression', () => {
    const source = 'fn mainImage(p: vec2f) -> vec4f { return vec4f(fwidth(p.x) + fwidthFine(p.y)); }';
    const document = parseWgslDocument('/image.wgsl', source, 'fragment');
    expect(() => normalizeWgslTraceDerivatives(document, source.replace('fwidth(p.x)', 'fwidthCoarse(p.x)'))).toThrow('changed derivative call order');
    expect(() => normalizeWgslTraceDerivatives(document, source.replace('fwidth(p.x)', 'p.x'))).toThrow('changed derivative call order');
  });

  it('preserves modules without derivative-width calls', () => {
    const source = 'fn mainImage(p: vec2f) -> vec4f { return vec4f(p, 0.0, 1.0); }';
    expect(normalize(source)).toBe(source);
  });
});
