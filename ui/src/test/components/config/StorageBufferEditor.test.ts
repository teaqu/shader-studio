import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import StorageBufferEditor from '../../../lib/components/config/StorageBufferEditor.svelte';

function renderEditor(referencedBy: string[] = []) {
  const onApply = vi.fn(() => ({}));
  const onDelete = vi.fn(() => ({}));
  return {
    onApply, onDelete,
    ...render(StorageBufferEditor, {
      name: 'particles', declaration: { count: 1024, stride: 16, elementType: 'float4' },
      existingNames: ['particles'], referencedBy, onApply, onDelete,
    }),
  };
}

describe('StorageBufferEditor', () => {
  it('keeps edits local until Apply, then applies them immediately', async () => {
    const { getByLabelText, getByRole, onApply } = renderEditor();
    await fireEvent.input(getByLabelText('Element count'), { target: { value: '2048' } });
    expect(onApply).not.toHaveBeenCalled();
    await fireEvent.click(getByRole('button', { name: 'Apply particles changes' }));
    expect(onApply).toHaveBeenCalledWith('particles', 'particles', { count: 2048, stride: 16, elementType: 'float4' });
  });

  it('derives stride for built-in types and keeps the field for custom types', async () => {
    const { getByLabelText, queryByLabelText, onApply } = renderEditor();

    expect(queryByLabelText('Byte stride')).toBeNull();

    await fireEvent.input(getByLabelText('Element type'), { target: { value: 'Particle' } });
    expect(getByLabelText('Byte stride')).toBeInTheDocument();
    await fireEvent.input(getByLabelText('Byte stride'), { target: { value: '32' } });
    await fireEvent.click(getByLabelText('Apply particles changes'));
    expect(onApply).toHaveBeenCalledWith('particles', 'particles', { count: 1024, stride: 32, elementType: 'Particle' });
  });

  it('deletes an unreferenced buffer immediately', async () => {
    const { getByRole, onDelete } = renderEditor();

    await fireEvent.click(getByRole('button', { name: 'Delete particles' }));

    expect(onDelete).toHaveBeenCalledWith('particles');
  });

  it('opens the inspector when GPU read and write controls are available', async () => {
    const { getByRole, getByLabelText } = render(StorageBufferEditor, {
      name: 'particles', declaration: { count: 4, stride: 16, elementType: 'float4' },
      existingNames: ['particles'], referencedBy: [], onApply: vi.fn(() => ({})), onDelete: vi.fn(() => ({})),
      onRead: vi.fn(async () => ({
        name: 'particles', elementType: 'float4', stride: 16, start: 0, count: 1, data: new ArrayBuffer(16),
      })),
      onWrite: vi.fn(async () => {}),
    });

    await fireEvent.click(getByRole('button', { name: 'Inspect particles' }));

    expect(getByLabelText('Page status')).toHaveTextContent('Page 1 of 1');
  });

  it('cancels a draft and blocks referenced deletion', async () => {
    const { getByLabelText, getByRole, queryByRole, onDelete } = renderEditor(['ComputeSim']);
    await fireEvent.input(getByLabelText('Element type'), { target: { value: 'uint' } });
    await fireEvent.click(getByRole('button', { name: 'Cancel particles changes' }));
    expect((getByLabelText('Element type') as HTMLInputElement).value).toBe('float4');
    expect(queryByRole('button', { name: 'Delete particles' })).toBeNull();
    expect(getByRole('alert')).toHaveTextContent('ComputeSim');
    expect(onDelete).not.toHaveBeenCalled();
  });
});
