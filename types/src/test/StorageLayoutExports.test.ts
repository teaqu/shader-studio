import { describe, expect, it } from 'vitest';
import { configuredStorageLayout, storageStructDeclaration, storageValueLayout, validateStorageOptions } from '../index';

describe('public storage layout exports', () => {
  it('exposes the storage layout helpers through the package entry point', () => {
    const config = { elementType: 'f32', count: 2 };
    expect(storageValueLayout('f32')).toMatchObject({ kind: 'float', stride: 4 });
    expect(configuredStorageLayout(config)).toEqual({ stride: 4, fields: [{ name: 'value', type: 'f32', offset: 0 }] });
    expect(storageStructDeclaration(config, 'wgsl')).toBe('');
    expect(validateStorageOptions(config)).toEqual([]);
  });
});
