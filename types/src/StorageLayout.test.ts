import { describe, expect, it } from 'vitest';
import { configuredStorageLayout, slangStorageFieldType, storageStructDeclaration, storageValueLayout, validateStorageOptions } from './StorageLayout';
import type { StorageBufferConfig } from './ShaderConfig';
describe('Storage layouts', () => {
  it('validates malformed JSON, field counts and lifecycle options', () => {
    for (const config of [null, { fields: null }, { fields: [] }, { fields: [null] }, { fields: Array(65).fill({ name: 'x', type: 'f32' }) }]) {
      expect(configuredStorageLayout(config as unknown as StorageBufferConfig)).toBeNull();
      expect(validateStorageOptions(config as unknown as StorageBufferConfig).length).toBeGreaterThan(0);
    }
    expect(storageValueLayout(null as unknown as string)).toBeNull();
    expect(validateStorageOptions({ count: 1, elementType: 'u32', clearEachFrame: 1, resetOnRestart: 'yes' } as unknown as StorageBufferConfig)).toHaveLength(2);
    expect(validateStorageOptions({ count: 1, elementType: 'f32', fields: [{ name: 'x', type: 'float' }] })).toContain('Struct type must be a shader identifier');
    expect(validateStorageOptions({ count: 1, elementType: 'Data', fields: [{ type: 'f32' } as never] })).toContain('Field names must be unique shader identifiers');
    expect(validateStorageOptions({ count: 1, elementType: 'u32', initialData: 'A'.repeat(349529) })).toHaveLength(1);
    expect(validateStorageOptions({ count: 1, elementType: 'u32', initialData: 'AQI=' })).toEqual([]);
    expect(validateStorageOptions({ count: 1, elementType: 'f16', initialData: 'AAAA' })).toContain('Initial data exceeds the buffer size');
  });
  it('emits native scalar, vector and atomic fields without changing source types', () => {
    expect(slangStorageFieldType('f16')).toBe('half');
    expect(slangStorageFieldType('atomic<u32>')).toBe('Atomic<uint>');
    expect(slangStorageFieldType('Custom')).toBe('Custom');
    expect(storageStructDeclaration({ count: 1, elementType: 'float' }, 'wgsl')).toBe('');
  });
  it.each([['float3', 16, 12], ['vec3f', 16, 12], ['vec3<f16>', 8, 6], ['Atomic<uint>', 4, 4], ['u32', 4, 4]])('resolves %s size and array stride', (type, stride, size) => {
    expect(storageValueLayout(type)).toMatchObject({ stride, size });
  });
  it('packs fields with member sizes rather than array strides', () => {
    const config = { count: 2, elementType: 'Particle', fields: [{ name: 'position', type: 'float3' }, { name: 'age', type: 'float' }, { name: 'velocity', type: 'float4' }] };
    expect(configuredStorageLayout(config)).toEqual({ stride: 32, fields: [{ name: 'position', type: 'float3', offset: 0 }, { name: 'age', type: 'float', offset: 12 }, { name: 'velocity', type: 'float4', offset: 16 }] });
    expect(storageStructDeclaration(config, 'wgsl')).toContain('position: vec3<f32>');
    expect(storageStructDeclaration(config, 'slang')).toContain('float3 position;');
  });
  it('keeps source-owned types and rejects invalid configuration options', () => {
    expect(configuredStorageLayout({ count: 1, elementType: 'External' })).toBeNull();
    expect(validateStorageOptions({ count: 1, elementType: 'External' })).toEqual([]);
    expect(validateStorageOptions({ count: 1, elementType: 'bad type', fields: [{ name: 'x', type: 'float' }, { name: 'x', type: 'texture' }] })).toHaveLength(3);
    expect(validateStorageOptions({ count: 1, elementType: 'u32', initialData: 'not base64' })).toHaveLength(1);
    expect(validateStorageOptions({ count: 1, elementType: 'u32', initialData: 'AAAAAAAAAAAA' })).toEqual(['Initial data exceeds the buffer size']);
    expect(validateStorageOptions({ count: 1, elementType: 'u32', initialData: 'AQIDBA==' })).toEqual([]);
  });
});
