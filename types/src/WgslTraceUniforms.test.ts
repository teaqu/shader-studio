import { describe, expect, it } from 'vitest';
import { validateWgslTraceUniforms, type WgslTraceUniform } from './WgslTraceUniforms';

describe('explicit WGSL trace custom uniforms', () => {
  it('accepts every supported scalar/vector/bool shape', () => {
    expect(() => validateWgslTraceUniforms(undefined)).not.toThrow();
    expect(() => validateWgslTraceUniforms([])).not.toThrow();
    expect(() => validateWgslTraceUniforms(Array.from({ length: 32 }, (_, index) => ({ name: `u${index}`, type: 'float', value: 1 })))).not.toThrow();
    expect(() => validateWgslTraceUniforms([
      { name: 'gain', type: 'float', value: 0.5 }, { name: 'offset', type: 'vec2', value: [1, -2] },
      { name: 'tint', type: 'vec3', value: [0.25, 0.5, 0.75] }, { name: 'color', type: 'vec4', value: [0, 1, 2, 3] },
      { name: 'enabled', type: 'bool', value: false },
    ])).not.toThrow();
  });

  it.each([
    null, {}, [null], [{ name: 'bad-name', type: 'float', value: 1 }],
    [{ name: '_ss_custom', type: 'float', value: 1 }], [{ name: 'if', type: 'float', value: 1 }],
    ...['_', '__reserved', 'mainImage', 'vertexMain', 'fragmentMain'].map(name => [{ name, type: 'float', value: 1 }]),
    [{ name: 'iTime', type: 'float', value: 1 }], [{ name: 'gain', type: 'i32', value: 1 }],
    [{ name: 'gain', type: 'float', value: NaN }], [{ name: 'gain', type: 'float', value: Infinity }],
    [{ name: 'gain', type: 'float', value: 1e100 }], [{ name: 'gain', type: 'float', value: [1] }],
    [{ name: 'gain', type: 'vec2', value: 1 }], [{ name: 'gain', type: 'vec3', value: [1, 2] }],
    [{ name: 'gain', type: 'vec4', value: [1, 2, 3, '4'] }], [{ name: 'gain', type: 'bool', value: 1 }],
    [{ name: 'gain', type: 'float', value: 1 }, { name: 'gain', type: 'float', value: 2 }],
    Array.from({ length: 33 }, (_, index) => ({ name: `u${index}`, type: 'float', value: 1 })),
  ].map(uniforms => ({ uniforms })))('rejects invalid explicit values: %j', ({ uniforms }) => {
    expect(() => validateWgslTraceUniforms(uniforms as WgslTraceUniform[])).toThrow();
  });
});
