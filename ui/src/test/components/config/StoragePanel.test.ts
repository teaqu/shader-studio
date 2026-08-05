import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import StoragePanel from '../../../lib/components/config/StoragePanel.svelte';

describe('StoragePanel', () => {
  it('shows existing storage buffers and adds a new buffer', async () => {
    const onAdd = vi.fn(() => 'storageB');
    const { getByRole, getByText } = render(StoragePanel, {
      storage: { storageA: { count: 64, stride: 16, elementType: 'float4' } },
      referencesFor: vi.fn(() => []),
      onAdd,
      onApply: vi.fn(() => ({})),
      onDelete: vi.fn(() => ({})),
    });

    expect(getByText('storageA')).toBeInTheDocument();
    await fireEvent.click(getByRole('button', { name: 'Add storage buffer' }));

    expect(onAdd).toHaveBeenCalledOnce();
  });

  it('explains that source declarations are not automatically rewritten', () => {
    const { getByText } = render(StoragePanel, {
      storage: {},
      referencesFor: vi.fn(() => []),
      onAdd: vi.fn(() => null),
      onApply: vi.fn(() => ({})),
      onDelete: vi.fn(() => ({})),
    });

    expect(getByText(/does not rewrite your Slang source/i)).toBeInTheDocument();
  });
});
