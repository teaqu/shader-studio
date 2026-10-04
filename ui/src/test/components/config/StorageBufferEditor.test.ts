import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import StorageBufferEditor from '../../../lib/components/config/StorageBufferEditor.svelte';

function renderEditor(referencedBy: string[] = []) {
  const onApply = vi.fn(() => ({}));
  const onDelete = vi.fn(() => ({}));
  return {
    onApply, onDelete,
    ...render(StorageBufferEditor, {
      name: 'particles', declaration: { count: 1024, elementType: 'float4' },
      existingNames: ['particles'], referencedBy, onApply, onDelete,
    }),
  };
}

describe('StorageBufferEditor', () => {
  it('edits a config-owned struct, lifecycle and imported data without mutating the declaration', async () => {
    const ui = renderEditor();
    await fireEvent.change(ui.getByLabelText('Data layout'), { target: { value: 'struct' } });
    expect(ui.getByText(/Stride: 32 bytes/)).toBeInTheDocument();
    await fireEvent.click(ui.getByRole('button', { name: '+ Add field' }));
    await fireEvent.input(ui.getByLabelText('Field 3 name'), { target: { value: 'age' } });
    await fireEvent.click(ui.getByRole('button', { name: 'Remove field 2' }));
    await fireEvent.change(ui.getByLabelText('Between frames'), { target: { value: 'clear' } });
    await fireEvent.click(ui.getByLabelText('Reset on restart'));
    await fireEvent.change(ui.getByLabelText('Initial data'), { target: { value: 'file' } });
    const file = { name: 'values.bin', size: 4, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer };
    await fireEvent.change(ui.getByLabelText('Initial data file'), { target: { files: [file] } });
    await fireEvent.click(ui.getByRole('button', { name: 'Apply particles changes' }));
    expect(ui.onApply).toHaveBeenLastCalledWith('particles', 'particles', {
      count: 1024, elementType: 'particles_Element', fields: [{ name: 'position', type: 'float4' }, { name: 'age', type: 'float' }], clearEachFrame: true, resetOnRestart: false, initialData: 'AQIDBA==', initialDataName: 'values.bin',
    });
    await fireEvent.click(ui.getByRole('button', { name: 'Cancel particles changes' }));
    expect(ui.getByLabelText('Element type')).toHaveValue('float4');
  });
  it('reports invalid drafts, file errors and reset failures', async () => {
    const ui = renderEditor();
    await fireEvent.input(ui.getByLabelText('Storage name'), { target: { value: 'invalid name' } });
    await fireEvent.input(ui.getByLabelText('Element count'), { target: { value: '-1' } });
    await fireEvent.input(ui.getByLabelText('Element type'), { target: { value: '' } });
    await fireEvent.click(ui.getByRole('button', { name: 'Apply particles changes' }));
    expect(ui.getAllByRole('alert')).toHaveLength(3);
    expect(ui.onApply).not.toHaveBeenCalled();
    await fireEvent.click(ui.getByRole('button', { name: 'Cancel particles changes' }));
    await fireEvent.change(ui.getByLabelText('Initial data'), { target: { value: 'file' } });
    await fireEvent.change(ui.getByLabelText('Initial data file'), { target: { files: [{ size: 262145 }] } });
    expect(ui.getByRole('alert')).toHaveTextContent('256 KiB');
    const resetUI = render(StorageBufferEditor, { name: 'other', declaration: { count: 1, elementType: 'float' }, existingNames: [], referencedBy: [], onApply: vi.fn(() => ({})), onDelete: vi.fn(() => ({ name: 'Cannot remove' })), onReset: async () => {
      throw new Error('Device lost');
    } });
    await fireEvent.click(resetUI.getByRole('button', { name: 'Reset data now' }));
    expect(resetUI.getByText('Device lost')).toBeInTheDocument();
    await fireEvent.click(resetUI.getByRole('button', { name: 'Delete other' }));
    expect(resetUI.getByText('Cannot remove')).toBeInTheDocument();
  });
  it('keeps edits local until Apply, then applies them immediately', async () => {
    const { getByLabelText, getByRole, onApply } = renderEditor();
    await fireEvent.input(getByLabelText('Element count'), { target: { value: '2048' } });
    expect(onApply).not.toHaveBeenCalled();
    await fireEvent.click(getByRole('button', { name: 'Apply particles changes' }));
    expect(onApply).toHaveBeenCalledWith('particles', 'particles', { count: 2048, elementType: 'float4' });
  });

  it('shows auto-inferred stride for built-in types', async () => {
    const { getByText } = renderEditor();

    expect(getByText(/Stride: 16 bytes/)).toBeInTheDocument();
  });

  it('shows struct-inferred stride for custom types', async () => {
    const { getByLabelText, getByText } = renderEditor();

    await fireEvent.input(getByLabelText('Element type'), { target: { value: 'Particle' } });
    expect(getByText('Stride inferred from struct definition in source')).toBeInTheDocument();
  });

  it('deletes an unreferenced buffer immediately', async () => {
    const { getByRole, onDelete } = renderEditor();

    await fireEvent.click(getByRole('button', { name: 'Delete particles' }));

    expect(onDelete).toHaveBeenCalledWith('particles');
  });

  it('resets through the owner and disables deletion for dispatch references', async () => {
    const onReset = vi.fn(async () => {});
    const ui = render(StorageBufferEditor, {
      name: 'particles', declaration: { count: 4, elementType: 'float4' },
      existingNames: ['particles'], referencedBy: ['Compute'], onApply: vi.fn(() => ({})), onDelete: vi.fn(() => ({})), onReset,
    });
    await fireEvent.click(ui.getByRole('button', { name: 'Reset data now' }));
    expect(onReset).toHaveBeenCalledWith('particles');
    expect(ui.getByRole('button', { name: 'Delete particles' })).toBeDisabled();
  });
});
