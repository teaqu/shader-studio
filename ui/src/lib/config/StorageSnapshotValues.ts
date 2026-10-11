import { storageValueLayout, type StorageBufferSnapshot, type StorageFieldLayout } from '@shader-studio/types';
import { halfToFloat } from '../halfFloat';
export function snapshotFields(snapshot: StorageBufferSnapshot): StorageFieldLayout[] {
  return snapshot.fields ?? (storageValueLayout(snapshot.elementType) ? [{ name: 'value', type: snapshot.elementType, offset: 0 }] : []);
}
export function readSnapshotField(snapshot: StorageBufferSnapshot, field: StorageFieldLayout): number[][] {
  const layout = storageValueLayout(field.type);
  if (!layout) {
    throw new Error(`${field.type} cannot be displayed yet. Select a numeric scalar or vector field.`);
  }
  const view = new DataView(snapshot.data);
  return Array.from({ length: snapshot.count }, (_, row) => Array.from({ length: layout.columns }, (_, column) => {
    const offset = row * snapshot.stride + field.offset + column * layout.bytes;
    if (field.offset < 0 || field.offset + layout.size > snapshot.stride || offset + layout.bytes > snapshot.data.byteLength) {
      throw new Error('Storage snapshot is incomplete or its field layout is invalid');
    }
    if (layout.kind === 'half') {
      return halfToFloat(view.getUint16(offset, true));
    }
    if (layout.kind === 'float') {
      return view.getFloat32(offset, true);
    }
    if (layout.kind === 'int') {
      return view.getInt32(offset, true);
    }
    return view.getUint32(offset, true);
  }));
}
export function formatStorageValue(value: number, type: string, hex: boolean): string {
  const layout = storageValueLayout(type);
  if (layout?.kind === 'int' || layout?.kind === 'uint') {
    return hex ? `0x${(value >>> 0).toString(16).padStart(8, '0')}` : String(value);
  }
  if (!Number.isFinite(value)) {
    return String(value);
  }
  return Number(value.toPrecision(7)).toString();
}
