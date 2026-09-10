import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import StorageInspector from '../../../lib/components/config/StorageInspector.svelte';

function floatSnapshot(): import('@shader-studio/types').StorageBufferSnapshot {
  const data = new ArrayBuffer(16);
  const view = new DataView(data);
  view.setFloat32(0, 1.5, true);
  view.setFloat32(4, 2.5, true);
  view.setFloat32(8, 3.5, true);
  view.setFloat32(12, 4.5, true);
  return { name: 'particles', elementType: 'float4', stride: 16, start: 4, count: 1, data };
}

describe('StorageInspector', () => {
  it('reads a range, exposes typed values, and writes edits back automatically', async () => {
    const onRead = vi.fn(async () => floatSnapshot());
    const onWrite = vi.fn(async (_name: string, _start: number, _data: ArrayBuffer) => {});
    const { getAllByRole, getByLabelText } = render(StorageInspector, {
      name: 'particles', count: 32, onRead, onWrite, onClose: vi.fn(),
    });

    await waitFor(() => expect(onRead).toHaveBeenCalledWith('particles', 0, 32));
    expect(onRead).toHaveBeenCalledWith('particles', 0, 32 > 100 ? 100 : 32);
    expect((getByLabelText('Element 4 component 0') as HTMLInputElement).value).toBe('1.5');

    await fireEvent.input(getByLabelText('Element 4 component 1'), { target: { value: '9.25' } });
    await waitFor(() => expect(onWrite).toHaveBeenCalledOnce());

    const [, start, data] = onWrite.mock.calls[0] as unknown as [string, number, ArrayBuffer];
    expect(start).toBe(4);
    expect(new DataView(data).getFloat32(4, true)).toBeCloseTo(9.25);
  });

  it('shows a clear message for custom storage element types', async () => {
    const { getByRole } = render(StorageInspector, {
      name: 'particles', count: 4,
      onRead: vi.fn(async () => ({ ...floatSnapshot(), elementType: 'Particle' })),
      onWrite: vi.fn(async () => {}), onClose: vi.fn(),
    });

    await waitFor(() => expect(getByRole('alert')).toHaveTextContent('Particle is not editable yet'));

    expect(getByRole('alert')).toHaveTextContent('Particle is not editable yet');
  });

  it('reads and writes WGSL f32 vectors using their padded storage stride', async () => {
    const data = new ArrayBuffer(16);
    const view = new DataView(data);
    view.setFloat32(0, 1, true); view.setFloat32(4, 2, true); view.setFloat32(8, 3, true);
    const onWrite = vi.fn(async (_name: string, _start: number, _data: ArrayBuffer) => {});
    const { getByLabelText } = render(StorageInspector, {
      name: 'directions', count: 1,
      onRead: vi.fn(async () => ({ name: 'directions', elementType: 'vec3<f32>', stride: 16, start: 0, count: 1, data })),
      onWrite, onClose: vi.fn(),
    });

    await waitFor(() => expect((getByLabelText('Element 0 component 2') as HTMLInputElement).value).toBe('3'));
    await waitFor(() => expect(getByLabelText('Element 0 component 1')).toBeTruthy());
    await fireEvent.input(getByLabelText('Element 0 component 1'), { target: { value: '9' } });
    await waitFor(() => expect(onWrite).toHaveBeenCalledOnce());
    const written = (onWrite.mock.calls as Array<[string, number, ArrayBuffer]>)[0]![2];
    expect(new DataView(written).getFloat32(4, true)).toBe(9);
  });

  it.each(['float3', 'vec3<f32>'])('edits the second component of a %s storage element', async (elementType) => {
    const data = new ArrayBuffer(16);
    const view = new DataView(data);
    view.setFloat32(0, 1, true); view.setFloat32(4, 2, true); view.setFloat32(8, 3, true);
    const onWrite = vi.fn(async (_name: string, _start: number, _data: ArrayBuffer) => {});
    const { getByLabelText } = render(StorageInspector, {
      name: 'directions', count: 1,
      onRead: vi.fn(async () => ({ name: 'directions', elementType, stride: 16, start: 0, count: 1, data })),
      onWrite, onClose: vi.fn(),
    });

    await waitFor(() => expect(getByLabelText('Element 0 component 1')).toBeTruthy());
    await fireEvent.input(getByLabelText('Element 0 component 1'), { target: { value: '9' } });
    await waitFor(() => expect(onWrite).toHaveBeenCalledOnce());
    const written = (onWrite.mock.calls as Array<[string, number, ArrayBuffer]>)[0]![2];
    expect(new DataView(written).getFloat32(4, true)).toBe(9);
  });

  it('reads and writes WGSL f16 scalar values', async () => {
    const data = new ArrayBuffer(2);
    new DataView(data).setUint16(0, 0x3e00, true); // 1.5 in IEEE-754 binary16
    const onWrite = vi.fn(async (_name: string, _start: number, _data: ArrayBuffer) => {});
    const { getByLabelText } = render(StorageInspector, {
      name: 'halves', count: 1,
      onRead: vi.fn(async () => ({ name: 'halves', elementType: 'f16', stride: 2, start: 0, count: 1, data })),
      onWrite, onClose: vi.fn(),
    });

    await waitFor(() => expect((getByLabelText('Element 0 component 0') as HTMLInputElement).value).toBe('1.5'));
    await fireEvent.input(getByLabelText('Element 0 component 0'), { target: { value: '2' } });
    await waitFor(() => expect(onWrite).toHaveBeenCalledOnce());
    const written = (onWrite.mock.calls as Array<[string, number, ArrayBuffer]>)[0]![2];
    expect(new DataView(written).getUint16(0, true)).toBe(0x4000);
  });

  it('edits a vec3<f16> component at its two-byte offset', async () => {
    const data = new ArrayBuffer(8);
    const view = new DataView(data);
    view.setUint16(0, 0x3c00, true); view.setUint16(2, 0x4000, true); view.setUint16(4, 0x4200, true);
    const onWrite = vi.fn(async (_name: string, _start: number, _data: ArrayBuffer) => {});
    const { getByLabelText } = render(StorageInspector, {
      name: 'halves', count: 1,
      onRead: vi.fn(async () => ({ name: 'halves', elementType: 'vec3<f16>', stride: 8, start: 0, count: 1, data })),
      onWrite, onClose: vi.fn(),
    });

    await waitFor(() => expect(getByLabelText('Element 0 component 1')).toBeTruthy());
    await fireEvent.input(getByLabelText('Element 0 component 1'), { target: { value: '4' } });
    await waitFor(() => expect(onWrite).toHaveBeenCalledOnce());
    const written = (onWrite.mock.calls as Array<[string, number, ArrayBuffer]>)[0]![2];
    expect(new DataView(written).getUint16(2, true)).toBe(0x4400);
  });

  it.each([
    ['f32', 1, 4], ['i32', 1, 4], ['u32', 1, 4], ['f16', 1, 2],
    ['vec3f', 3, 16], ['vec3h', 3, 8], ['vec3i', 3, 16], ['vec3u', 3, 16],
    ['atomic<i32>', 1, 4], ['atomic<u32>', 1, 4],
  ])('accepts WGSL storage spelling %s', async (elementType, columns, stride) => {
    const { getByLabelText } = render(StorageInspector, {
      name: 'values', count: 1,
      onRead: vi.fn(async () => ({
        name: 'values', elementType, stride, start: 0, count: 1, data: new ArrayBuffer(stride),
      })),
      onWrite: vi.fn(async () => {}), onClose: vi.fn(),
    });

    await waitFor(() => expect(getByLabelText(`Element 0 component ${columns - 1}`)).toBeTruthy());
  });

  it('reads fixed-size pages and handles the final partial page', async () => {
    const onRead = vi.fn(async (_name: string, start: number, count: number) => ({
      ...floatSnapshot(), start, count, data: new ArrayBuffer(count * 16),
    }));
    const { getAllByRole, getByLabelText } = render(StorageInspector, {
      name: 'particles', count: 250, onRead, onWrite: vi.fn(async () => {}), onClose: vi.fn(),
    });

    await waitFor(() => expect(onRead).toHaveBeenCalledWith('particles', 0, 100));
    await fireEvent.click(getAllByRole('button', { name: 'Page 2' })[0]!);
    await waitFor(() => expect(onRead).toHaveBeenCalledWith('particles', 100, 100));
    await fireEvent.click(getAllByRole('button', { name: 'Page 3' })[0]!);
    await waitFor(() => expect(onRead).toHaveBeenCalledWith('particles', 200, 50));

    expect(getByLabelText('Page status')).toHaveTextContent('Page 3 of 3');
    expect(getAllByRole('button', { name: 'Page 3' })).toHaveLength(2);
  });
});
