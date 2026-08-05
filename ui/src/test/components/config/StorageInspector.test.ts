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
    const onWrite = vi.fn(async () => {});
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
