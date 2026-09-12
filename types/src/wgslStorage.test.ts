import { describe, expect, it } from 'vitest';
import { wgslStorageElementType } from './wgslStorage';

describe('WGSL storage type mapping', () => {
  it.each(['render', 'compute'] as const)('maps scalar, vector and matrix aliases for %s', stage => {
    for (const [base, scalar] of [['float', 'f32'], ['int', 'i32'], ['uint', 'u32']]) {
      expect(wgslStorageElementType(base, stage)).toBe(scalar);
      for (const size of [2, 3, 4]) {
        expect(wgslStorageElementType(`${base}${size}`, stage)).toBe(`vec${size}<${scalar}>`);
      }
    }
    for (const size of [2, 3, 4]) {
      expect(wgslStorageElementType(`float${size}x${size}`, stage)).toBe(`mat${size}x${size}<f32>`);
    }
    for (const native of ['f32', 'vec4f', 'vec3<f32>', 'Particle']) {
      expect(wgslStorageElementType(native, stage)).toBe(native);
    }
  });
  it.each([['uint', 'u32'], ['int', 'i32']])('maps Atomic<%s> as a read-only scalar for replay', (alias, scalar) => {
    expect(wgslStorageElementType(`Atomic<${alias}>`, 'render')).toBe(scalar);
    expect(wgslStorageElementType(`Atomic<${alias}>`, 'compute')).toBe(`atomic<${scalar}>`);
  });
});
