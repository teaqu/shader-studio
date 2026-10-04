import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import StoragePanel from '../../../lib/components/config/StoragePanel.svelte';
const commands = () => ({ referencesFor: vi.fn(() => []), onAdd: vi.fn(() => 'storageB'), onApply: vi.fn(() => ({})), onDelete: vi.fn(() => ({})) });
describe('StoragePanel', () => {
  it('shows one buffer at a time and adds a new one through the owner', async () => {
    const actions = commands();
    const ui = render(StoragePanel, { scope: 'panel-selection', storage: { a: { count: 4, elementType: 'float4' }, b: { count: 1, elementType: 'uint' } }, ...actions });
    expect(ui.getByLabelText('Storage name')).toHaveValue('a');
    await fireEvent.click(ui.getByRole('button', { name: 'Select storage b' }));
    expect(ui.getByLabelText('Storage name')).toHaveValue('b');
    await fireEvent.click(ui.getByRole('button', { name: 'Add storage buffer' }));
    expect(actions.onAdd).toHaveBeenCalledOnce();
  });
  it('shows the inspector with read support alone and returns to settings', async () => {
    const ui = render(StoragePanel, { scope: 'panel-inspect', storage: { counter: { count: 1, elementType: 'u32' } }, ...commands(), onRead: async () => ({ name: 'counter', elementType: 'u32', stride: 4, start: 0, count: 1, data: new Uint32Array([5]).buffer }) });
    await fireEvent.click(ui.getByRole('tab', { name: 'Inspect' }));
    await waitFor(() => expect(ui.getByLabelText('Element 0 value')).toHaveTextContent('5'));
    await fireEvent.click(ui.getByRole('tab', { name: 'Settings' }));
    expect(ui.getByLabelText('Storage name')).toHaveValue('counter');
  });
  it('offers capture points only for passes that run repeatedly', async () => {
    const passes = [{ name: 'Seed', compute: true, dispatchOnce: true }, { name: 'Simulate', compute: true }, { name: 'Image', compute: false }];
    const ui = render(StoragePanel, { scope: 'capture-points', storage: { counter: { count: 1, elementType: 'u32' } }, passes, ...commands(), onRead: async () => ({ name: 'counter', elementType: 'u32', stride: 4, start: 0, count: 1, data: new Uint32Array([5]).buffer }) });
    await fireEvent.click(ui.getByRole('tab', { name: 'Inspect' }));
    await waitFor(() => expect(ui.getByLabelText('Capture point')).not.toBeDisabled());
    expect(ui.queryByRole('option', { name: 'Before Seed' })).not.toBeInTheDocument();
    expect(ui.queryByRole('option', { name: 'After Seed' })).not.toBeInTheDocument();
    expect(ui.getByRole('option', { name: 'Before Simulate' })).toBeInTheDocument();
    expect(ui.getByRole('option', { name: 'After Image' })).toBeInTheDocument();
  });
  it('applies the selected draft from the header and hides that action after cancellation', async () => {
    const actions = commands();
    const ui = render(StoragePanel, { scope: 'header-apply', storage: { counter: { count: 1, elementType: 'u32' } }, ...actions });
    expect(ui.queryByRole('button', { name: 'Apply pending storage changes' })).not.toBeInTheDocument();
    await fireEvent.input(ui.getByLabelText('Element count'), { target: { value: '12' } });
    const apply = await ui.findByRole('button', { name: 'Apply pending storage changes' });
    expect(apply.closest('header')).not.toBeNull();
    await fireEvent.click(apply);
    expect(actions.onApply).toHaveBeenCalledWith('counter', 'counter', expect.objectContaining({ count: 12 }));
    await fireEvent.click(ui.getByLabelText('Cancel counter changes'));
    await waitFor(() => expect(ui.queryByRole('button', { name: 'Apply pending storage changes' })).not.toBeInTheDocument());
  });
  it('validates header submissions and clears the pending action when changing buffers', async () => {
    const actions = commands();
    const ui = render(StoragePanel, { scope: 'header-invalid', storage: { a: { count: 1, elementType: 'u32' }, b: { count: 4, elementType: 'u32' } }, ...actions });
    await fireEvent.input(ui.getByLabelText('Element count'), { target: { value: '0' } });
    await fireEvent.click(await ui.findByRole('button', { name: 'Apply pending storage changes' }));
    expect(actions.onApply).not.toHaveBeenCalled();
    expect(ui.getByRole('alert')).toHaveTextContent('Enter a positive integer');
    expect(ui.getByRole('button', { name: 'Apply pending storage changes' })).toBeInTheDocument();
    await fireEvent.click(ui.getByRole('button', { name: 'Select storage b' }));
    await waitFor(() => expect(ui.queryByRole('button', { name: 'Apply pending storage changes' })).not.toBeInTheDocument());
    expect(ui.getByLabelText('Element count')).toHaveValue('4');
  });
  it('handles an empty collection and unavailable inspection', () => {
    const ui = render(StoragePanel, { storage: {}, ...commands() });
    expect(ui.getByText('No storage buffers are configured.')).toBeInTheDocument();
  });
});
