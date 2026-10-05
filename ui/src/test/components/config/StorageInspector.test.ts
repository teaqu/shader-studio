import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StorageBufferSnapshot } from '@shader-studio/types';
import StorageInspector from '../../../lib/components/config/StorageInspector.svelte';

function snapshot(elementType = 'float4', stride = 16): StorageBufferSnapshot {
  return { name: 'particles', elementType, stride, start: 0, count: 1, data: new Float32Array([1.5, 2.5, 3.5, 4.5]).buffer, frame: 10 };
}
afterEach(() => vi.useRealTimers());
describe('StorageInspector', () => {
  it('reads bounded ranges and presents vector components read-only', async () => {
    const onRead = vi.fn(async () => snapshot());
    const ui = render(StorageInspector, { name: 'particles', count: 32, onRead });
    await waitFor(() => expect(ui.getByLabelText('Element 0 component 0')).toHaveTextContent('1.5'));
    expect(onRead).toHaveBeenCalledWith('particles', 0, 16, undefined);
    expect(ui.getAllByRole('columnheader').map(item => item.textContent)).toEqual(['#', 'x', 'y', 'z', 'w']);
    expect(ui.container.querySelector('table input')).toBeNull();
    expect(ui.getByText(/Frame 10/)).toBeInTheDocument();
  });
  it('shows only the selected struct field and remembers it without another read', async () => {
    const data = new Float32Array([1, 2, 3, 4, 10, 20, 30, 40]).buffer;
    const onRead = vi.fn(async () => ({ ...snapshot('Particle', 32), data, fields: [{ name: 'position', type: 'float4', offset: 0 }, { name: 'velocity', type: 'float4', offset: 16 }] }));
    const ui = render(StorageInspector, { name: 'particles', scope: 'struct-test', count: 1, onRead });
    await waitFor(() => expect(ui.getByLabelText('Element 0 component 0')).toHaveTextContent('1'));
    await fireEvent.change(ui.getByLabelText('Inspect field'), { target: { value: 'velocity' } });
    expect(ui.getByLabelText('Element 0 component 0')).toHaveTextContent('10');
    expect(ui.getAllByRole('columnheader')).toHaveLength(5);
    expect(onRead).toHaveBeenCalledOnce();
  });
  it('uses a scalar list and hexadecimal integers without a redundant picker', async () => {
    const ui = render(StorageInspector, { name: 'counter', count: 1, onRead: async () => ({ ...snapshot('u32', 4), data: new Uint32Array([4294967295]).buffer }) });
    await waitFor(() => expect(ui.getByLabelText('Element 0 value')).toHaveTextContent('4294967295'));
    expect(ui.queryByRole('table')).toBeNull();
    expect(ui.queryByLabelText('Inspect field')).toBeNull();
    await fireEvent.change(ui.getByLabelText('Number display'), { target: { value: 'true' } });
    expect(ui.getByLabelText('Element 0 value')).toHaveTextContent('0xffffffff');
  });
  it.each([['f32', 1, 4], ['i32', 1, 4], ['u32', 1, 4], ['f16', 1, 2], ['vec3f', 3, 16], ['vec3h', 3, 8], ['vec3i', 3, 16], ['vec3u', 3, 16], ['atomic<i32>', 1, 4], ['Atomic<uint>', 1, 4]])('reads %s layouts', async (elementType, columns, stride) => {
    const ui = render(StorageInspector, { name: 'data', count: 1, onRead: async () => ({ ...snapshot(elementType, stride), data: new ArrayBuffer(stride) }) });
    await waitFor(() => expect(ui.getByLabelText(columns === 1 ? 'Element 0 value' : `Element 0 component ${columns - 1}`)).toHaveTextContent('0'));
  });
  it('reports missing layouts, unsupported fields and malformed snapshots', async () => {
    const ui = render(StorageInspector, { name: 'data', count: 1, onRead: async () => snapshot('Unknown') });
    await waitFor(() => expect(ui.getByRole('alert')).toHaveTextContent('Field layout unavailable'));
    await ui.rerender({ name: 'matrix', count: 1, onRead: async () => ({ ...snapshot('M'), fields: [{ name: 'matrix', type: 'mat4x4f', offset: 0 }] }) });
    await waitFor(() => expect(ui.getByRole('alert')).toHaveTextContent('cannot be displayed'));
    await ui.rerender({ name: 'truncated', count: 1, onRead: async () => ({ ...snapshot(), data: new ArrayBuffer(0) }) });
    await waitFor(() => expect(ui.getByRole('alert')).toHaveTextContent('incomplete'));
  });
  it('navigates partial pages and resets ranges when changing buffers', async () => {
    const onRead = vi.fn(async (name: string, start: number, count: number) => ({ ...snapshot(), name, start, count, data: new ArrayBuffer(count * 16) }));
    const ui = render(StorageInspector, { name: 'data', count: 18, onRead });
    await waitFor(() => expect(onRead).toHaveBeenCalledWith('data', 0, 16, undefined));
    await fireEvent.click(ui.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(onRead).toHaveBeenCalledWith('data', 16, 2, undefined));
    expect(ui.getByRole('button', { name: 'Next' })).toBeDisabled();
    await ui.rerender({ name: 'other', count: 2, onRead });
    await waitFor(() => expect(onRead).toHaveBeenCalledWith('other', 0, 2, undefined));
  });
  it('requests a pass boundary and stops live updates after errors', async () => {
    const onRead = vi.fn(async () => snapshot());
    const ui = render(StorageInspector, { name: 'data', count: 1, passes: ['Compute'], onRead });
    await waitFor(() => expect(ui.getByRole('button', { name: 'Capture snapshot' })).toBeEnabled());
    await fireEvent.change(ui.getByLabelText('Capture point'), { target: { value: JSON.stringify({ pass: 'Compute', timing: 'after' }) } });
    await waitFor(() => expect(onRead).toHaveBeenLastCalledWith('data', 0, 1, { pass: 'Compute', timing: 'after' }));
    onRead.mockRejectedValueOnce(new Error('Capture failed'));
    await fireEvent.click(ui.getByRole('button', { name: 'Start live' }));
    await waitFor(() => expect(ui.getByRole('alert')).toHaveTextContent('Capture failed'));
    expect(ui.getByRole('button', { name: 'Start live' })).toBeInTheDocument();
  });
  it('does not overlap live reads or let an old request replace a new buffer', async () => {
    let resolve!: (value: StorageBufferSnapshot) => void;
    const onRead = vi.fn(() => new Promise<StorageBufferSnapshot>(r => {
      resolve = r;
    }));
    const ui = render(StorageInspector, { name: 'data', count: 1, onRead });
    await waitFor(() => expect(onRead).toHaveBeenCalledOnce());
    const oldResolve = resolve;
    await fireEvent.click(ui.getByRole('button', { name: 'Start live' }));
    expect(onRead).toHaveBeenCalledOnce();
    await ui.rerender({ name: 'new', count: 1, onRead: async () => ({ ...snapshot(), data: new Float32Array([9, 8, 7, 6]).buffer }) });
    await waitFor(() => expect(ui.getByLabelText('Element 0 component 0')).toHaveTextContent('9'));
    oldResolve(snapshot());
    await Promise.resolve();
    expect(ui.getByLabelText('Element 0 component 0')).toHaveTextContent('9');
  });
  it('leaves an empty buffer uncaptured and reports non-Error read failures', async () => {
    const onRead = vi.fn(async () => snapshot());
    const ui = render(StorageInspector, { name: 'empty', count: 0, onRead });
    await Promise.resolve();
    expect(onRead).not.toHaveBeenCalled();
    await ui.rerender({ name: 'data', count: 1, onRead: async () => Promise.reject('unavailable') });
    await waitFor(() => expect(ui.getByRole('alert')).toHaveTextContent('unavailable'));
  });
  it.each(['before', 'after'] as const)('labels a %s pass snapshot without a frame counter', async timing => {
    const ui = render(StorageInspector, { name: 'counter', scope: `metadata-${timing}`, count: 1,
      onRead: async () => ({ ...snapshot('u32', 4), frame: undefined, data: new Uint32Array([7]).buffer,
        capturePoint: { pass: 'Simulate', timing } }),
    });
    await waitFor(() => expect(ui.getByLabelText('Element 0 value')).toHaveTextContent('7'));
    expect(ui.getByText(`Snapshot · ${timing === 'before' ? 'Before' : 'After'} Simulate`)).toBeInTheDocument();
  });

});
