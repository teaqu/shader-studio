import { describe, expect, it } from 'vitest';
import { WGSL_NATIVE_STORAGE_ELEMENT_TYPES, wgslStorageElementType } from './wgslStorage';

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

  describe('native element type set', () => {
    it('covers every native scalar, vector, matrix alias, and integer atomic spelling', () => {
      const expected = [
        'f16', 'f32', 'i32', 'u32',
        ...[2, 3, 4].flatMap(size => [
          `vec${size}<f16>`, `vec${size}<f32>`, `vec${size}<i32>`, `vec${size}<u32>`,
          `vec${size}h`, `vec${size}f`, `vec${size}i`, `vec${size}u`,
        ]),
        ...[2, 3, 4].flatMap(columns => [2, 3, 4].flatMap(rows => [
          `mat${columns}x${rows}<f16>`, `mat${columns}x${rows}<f32>`,
          `mat${columns}x${rows}h`, `mat${columns}x${rows}f`,
        ])),
        'atomic<i32>', 'atomic<u32>',
      ];

      for (const native of expected) {
        expect(WGSL_NATIVE_STORAGE_ELEMENT_TYPES.has(native), native).toBe(true);
      }
    });

    it('covers every spelling the alias table resolves to', () => {
      // Derived from the table, so a new alias cannot land with its WGSL
      // spelling missing from what authoring validation accepts.
      for (const alias of ['float', 'float4', 'int', 'uint4', 'float4x4', 'Atomic<uint>', 'Atomic<int>']) {
        for (const stage of ['render', 'compute'] as const) {
          expect(
            WGSL_NATIVE_STORAGE_ELEMENT_TYPES.has(wgslStorageElementType(alias, stage)),
            `${alias} (${stage})`,
          ).toBe(true);
        }
      }
    });

    it('includes the predeclared vector aliases and excludes non-types', () => {
      for (const native of ['vec2f', 'vec3f', 'vec4f', 'vec2i', 'vec4u', 'atomic<u32>', 'atomic<i32>']) {
        expect(WGSL_NATIVE_STORAGE_ELEMENT_TYPES.has(native), native).toBe(true);
      }
      for (const other of ['Particle', 'uniform', 'fn', 'vec5f', 'float4']) {
        expect(WGSL_NATIVE_STORAGE_ELEMENT_TYPES.has(other), other).toBe(false);
      }
    });
  });
});
