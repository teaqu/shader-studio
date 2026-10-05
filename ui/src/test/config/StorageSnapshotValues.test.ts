import { describe, expect, it } from 'vitest';
import { formatStorageValue, readSnapshotField, snapshotFields } from '../../lib/config/StorageSnapshotValues';
describe('Storage snapshot values', () => {
  it('reads selected fields using offsets and padded element strides', () => {
    const data = new Float32Array([1, 2, 3, 9, 4, 5, 6, 8]).buffer;
    const snapshot = { name: 'data', elementType: 'Particle', stride: 16, start: 0, count: 2, data };
    expect(readSnapshotField(snapshot, { name: 'position', type: 'vec3f', offset: 0 })).toEqual([[1, 2, 3], [4, 5, 6]]);
    expect(readSnapshotField(snapshot, { name: 'age', type: 'f32', offset: 12 })).toEqual([[9], [8]]);
  });
  it('supports half values, signed integers and atomic unsigned values', () => {
    const snapshot = { name: 'data', elementType: 'f16', stride: 2, start: 0, count: 1, data: new Uint16Array([0x3e00]).buffer };
    expect(readSnapshotField(snapshot, { name: 'value', type: 'f16', offset: 0 })).toEqual([[1.5]]);
    expect(readSnapshotField({ ...snapshot, stride: 4, data: new Int32Array([-7]).buffer }, { name: 'value', type: 'i32', offset: 0 })).toEqual([[-7]]);
    expect(snapshotFields(snapshot)).toEqual([{ name: 'value', type: 'f16', offset: 0 }]);
    expect(formatStorageValue(-1, 'i32', true)).toBe('0xffffffff');
    expect(formatStorageValue(3.5, 'f32', true)).toBe('3.5');
    expect(formatStorageValue(Infinity, 'f32', false)).toBe('Infinity');
  });
  it('rejects unsupported and incomplete fields rather than showing invented zeros', () => {
    const snapshot = { name: 'data', elementType: 'Unknown', stride: 4, start: 0, count: 1, data: new ArrayBuffer(0) };
    expect(snapshotFields(snapshot)).toEqual([]);
    expect(() => readSnapshotField(snapshot, { name: 'value', type: 'u32', offset: 0 })).toThrow('incomplete');
    expect(() => readSnapshotField(snapshot, { name: 'value', type: 'mat4x4f', offset: 0 })).toThrow('cannot be displayed');
  });
});
