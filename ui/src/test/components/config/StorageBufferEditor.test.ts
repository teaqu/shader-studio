import { fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import StorageBufferEditor from '../../../lib/components/config/StorageBufferEditor.svelte';
import type { StorageBufferConfig } from '@shader-studio/types';

function renderEditor(referencedBy: string[] = [], declaration: StorageBufferConfig = { count: 1024, elementType: 'float4' }) {
  const onApply = vi.fn(() => ({}));
  const onDelete = vi.fn(() => ({}));
  const postMessage = vi.fn();
  const handlers: Array<(event: MessageEvent) => void> = [];
  const ui = render(StorageBufferEditor, {
    name: 'particles', declaration,
    existingNames: ['particles'], referencedBy, onApply, onDelete,
    shaderPath: '/shaders/sim.wgsl', postMessage, onMessage: (next: (event: MessageEvent) => void) => {
      handlers.push(next);
    },
  });
  async function selectFile(path: string, index = 0) {
    await fireEvent.click(ui.getAllByRole('button', { name: 'Select' })[index]!);
    const request = postMessage.mock.calls.at(-1)![0];
    for (const handler of handlers) {
      handler({ data: { type: 'fileSelected', payload: { requestId: request.payload.requestId, path } } } as MessageEvent);
    }
    await tick();
    return request;
  }
  return { onApply, onDelete, postMessage, selectFile, ...ui };
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
    const request = await ui.selectFile('data/values.bin');
    expect(request).toMatchObject({ type: 'selectFile', payload: { shaderPath: '/shaders/sim.wgsl', fileType: 'binary' } });
    await fireEvent.click(ui.getByRole('button', { name: 'Apply particles changes' }));
    expect(ui.onApply).toHaveBeenLastCalledWith('particles', 'particles', {
      count: 1024, elementType: 'particles_Element', fields: [{ name: 'position', type: 'float4' }, { name: 'age', type: 'float' }], clearEachFrame: true, resetOnRestart: false, initialDataFiles: [{ path: 'data/values.bin', byteOffset: 0 }],
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
    await fireEvent.click(ui.getByRole('button', { name: 'Apply particles changes' }));
    expect(ui.getByRole('alert')).toHaveTextContent('Choose an initial data file');
    expect(ui.onApply).not.toHaveBeenCalled();
    const resetUI = render(StorageBufferEditor, { name: 'other', declaration: { count: 1, elementType: 'float' }, existingNames: [], referencedBy: [], onApply: vi.fn(() => ({})), onDelete: vi.fn(() => ({ name: 'Cannot remove' })), onReset: async () => {
      throw new Error('Device lost');
    } });
    await fireEvent.click(resetUI.getByRole('button', { name: 'Reset data now' }));
    expect(resetUI.getByText('Device lost')).toBeInTheDocument();
    await fireEvent.click(resetUI.getByRole('button', { name: 'Delete other' }));
    expect(resetUI.getByText('Cannot remove')).toBeInTheDocument();
  });
  it('stores initial data as a file path with no size cap and clears it when switching to zeros', async () => {
    const ui = renderEditor([], { count: 4, elementType: 'u32', initialDataFiles: [{ path: 'old.bin', resolved_path: 'vscode-webview://old.bin' }] });
    expect(ui.getByLabelText('Initial data')).toHaveValue('file');
    expect(ui.getByText(/16 bytes/)).toBeInTheDocument();
    expect(ui.queryByText(/256 KiB/)).not.toBeInTheDocument();
    await ui.selectFile('@/data/new.bin');
    await fireEvent.click(ui.getByRole('button', { name: 'Apply particles changes' }));
    expect(ui.onApply).toHaveBeenLastCalledWith('particles', 'particles', { count: 4, elementType: 'u32', initialDataFiles: [{ path: '@/data/new.bin' }] });
    await fireEvent.change(ui.getByLabelText('Initial data'), { target: { value: 'zero' } });
    await fireEvent.click(ui.getByRole('button', { name: 'Apply particles changes' }));
    expect(ui.onApply).toHaveBeenLastCalledWith('particles', 'particles', { count: 4, elementType: 'u32' });
  });

  it('adds, selects, reorders and removes multiple files while keeping the declaration unchanged', async () => {
    const declaration = { count: 8, elementType: 'uint', initialDataFiles: [{ path: 'a.bin' }, { path: 'b.bin', byteOffset: 4 }] };
    const ui = renderEditor([], declaration);
    expect(ui.getByRole('button', { name: 'Move up file 1' })).toBeDisabled();
    expect(ui.getByRole('button', { name: 'Move down file 2' })).toBeDisabled();
    await fireEvent.click(ui.getByRole('button', { name: '+ Add file' }));
    await ui.selectFile('c.bin', 2);
    await fireEvent.change(ui.getByLabelText('File 3 byte offset'), { target: { value: '0x10' } });
    await fireEvent.click(ui.getByRole('button', { name: 'Move up file 3' }));
    expect(ui.getByLabelText('Initial data file 2')).toHaveValue('c.bin');
    await fireEvent.click(ui.getByRole('button', { name: 'Move down file 1' }));
    await fireEvent.click(ui.getByRole('button', { name: 'Remove file 3' }));
    await fireEvent.click(ui.getByRole('button', { name: 'Apply particles changes' }));
    expect(ui.onApply).toHaveBeenLastCalledWith('particles', 'particles', { count: 8, elementType: 'uint', initialDataFiles: [{ path: 'c.bin', byteOffset: 16 }, { path: 'a.bin' }] });
    expect(declaration.initialDataFiles).toEqual([{ path: 'a.bin' }, { path: 'b.bin', byteOffset: 4 }]);
    await fireEvent.click(ui.getByRole('button', { name: 'Cancel particles changes' }));
    expect(ui.getByLabelText('Initial data file 1')).toHaveValue('a.bin');
    expect(ui.getByLabelText('Initial data file 2')).toHaveValue('b.bin');
  });

  it.each(['-1', '1.5', '', 'nope', '9007199254740992'])('rejects invalid byte offset %s', async (value) => {
    const ui = renderEditor([], { count: 1, elementType: 'uint', initialDataFiles: [{ path: 'a.bin' }] });
    await fireEvent.change(ui.getByLabelText('File 1 byte offset'), { target: { value } });
    await fireEvent.click(ui.getByRole('button', { name: 'Apply particles changes' }));
    expect(ui.getByRole('alert')).toHaveTextContent('Byte offset must be a non-negative safe integer');
    expect(ui.onApply).not.toHaveBeenCalled();
  });

  it('allows removing all files for zero initialisation', async () => {
    const ui = renderEditor([], { count: 1, elementType: 'uint', initialDataFiles: [{ path: 'a.bin' }] });
    await fireEvent.click(ui.getByRole('button', { name: 'Remove file 1' }));
    await fireEvent.click(ui.getByRole('button', { name: 'Apply particles changes' }));
    expect(ui.onApply).toHaveBeenLastCalledWith('particles', 'particles', { count: 1, elementType: 'uint', initialDataFiles: [] });
  });

  it('ignores a cancelled file selection', async () => {
    const ui = renderEditor([], { count: 1, elementType: 'u32', initialDataFiles: [{ path: 'keep.bin' }] });
    await ui.selectFile('');
    expect(ui.queryByRole('button', { name: 'Apply particles changes' })).not.toBeInTheDocument();
    expect(ui.getByDisplayValue('keep.bin')).toBeInTheDocument();
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
