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
  it('handles an empty collection and unavailable inspection', () => {
    const ui = render(StoragePanel, { storage: {}, ...commands() });
    expect(ui.getByText('No storage buffers are configured.')).toBeInTheDocument();
  });
});
