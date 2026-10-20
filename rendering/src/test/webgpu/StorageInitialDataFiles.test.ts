import { describe, expect, it, vi } from 'vitest';
import { loadStorageInitialData } from '../../webgpu/StorageInitialData';
import type { StorageInitialDataFile } from '@shader-studio/types';
import type { StorageBindingNode } from '../../types/PassGraph';

const file = (path: string, byteOffset = 0) => ({ path, byteOffset, resolved_path: `https://host/${path}` });
const node = (files: StorageInitialDataFile[], count = 4): StorageBindingNode => ({
  name: 'ram', binding: 0, elementType: 'uint', builtin: true, count, stride: 4,
  initialDataFiles: files,
});
const response = (bytes: number[]) => ({ ok: true, arrayBuffer: async () => new Uint8Array(bytes).buffer }) as Response;

describe('multiple storage initial data files', () => {
  it('loads resolved paths in list order, with zero gaps and later overlaps winning', async () => {
    const target = node([file('a.bin', 1), file('b.bin', 3), file('c.bin', 8)]);
    const fetchBytes = vi.fn(async (url: string) => response(url.endsWith('a.bin') ? [1, 2, 3, 4] : url.endsWith('b.bin') ? [9] : [8]));
    expect(await loadStorageInitialData([target], fetchBytes)).toEqual([]);
    expect(fetchBytes.mock.calls.map(([url]) => url)).toEqual(['https://host/a.bin', 'https://host/b.bin', 'https://host/c.bin']);
    expect(target.initialBytes).toEqual(new Uint8Array([0, 1, 2, 9, 4, 0, 0, 0, 8]));
  });

  it('rejects a file whose offset plus length exceeds capacity, without publishing partial bytes', async () => {
    const target = node([file('a.bin'), file('b.bin', 15)]);
    target.initialBytes = new Uint8Array([99]);
    expect(await loadStorageInitialData([target], async () => response([1, 2]))).toEqual([
      'Storage ram: initial data file "b.bin" at byte offset 15 needs 17 bytes but the buffer holds 16 bytes',
    ]);
    expect(target.initialBytes).toBeUndefined();
  });

  it('reports a later failed file without retaining earlier or stale bytes', async () => {
    const target = node([file('a.bin'), file('missing.bin', 4)]);
    const errors = await loadStorageInitialData([target], async url => {
      if (url.endsWith('missing.bin')) {
        throw new Error('offline');
      }
      return response([1]);
    });
    expect(errors).toEqual(['Storage ram: unable to load initial data file "missing.bin" (offline)']);
    expect(target.initialBytes).toBeUndefined();
  });

  it('allows an empty file at the end of the buffer and an empty list', async () => {
    const empty = node([]);
    const atEnd = node([file('empty.bin', 16)]);
    expect(await loadStorageInitialData([empty, atEnd], async () => response([]))).toEqual([]);
    expect(empty.initialBytes).toBeUndefined();
    expect(atEnd.initialBytes?.byteLength ?? 0).toBe(0);
  });
  it.each([-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1, 17])('rejects invalid destination offset %s before fetching', async byteOffset => {
    const target = node([file('a.bin', byteOffset)]);
    const fetchBytes = vi.fn();
    expect((await loadStorageInitialData([target], fetchBytes))[0]).toContain('invalid byte offset');
    expect(fetchBytes).not.toHaveBeenCalled();
  });

  it('accepts a file ending exactly at capacity and falls back to the configured path', async () => {
    const target = node([{ path: 'tail.bin', byteOffset: 14 }]);
    const fetchBytes = vi.fn(async () => response([1, 2]));
    expect(await loadStorageInitialData([target], fetchBytes)).toEqual([]);
    expect(fetchBytes).toHaveBeenCalledWith('tail.bin');
    expect(target.initialBytes).toEqual(new Uint8Array([...Array(14).fill(0), 1, 2]));
  });

});
