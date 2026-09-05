import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import NewShaderModal from '../../lib/components/NewShaderModal.svelte';

describe('NewShaderModal', () => {
  it('submits the selected GLSL shader name', async () => {
    const onCreate = vi.fn();
    render(NewShaderModal, { props: { onCreate, onClose: vi.fn() } });

    await fireEvent.input(screen.getByLabelText('Shader name'), { target: { value: 'aurora' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create Shader' }));

    expect(onCreate).toHaveBeenCalledWith('aurora', 'glsl');
  });

  it('submits Slang and closes on cancel or Escape', async () => {
    const onCreate = vi.fn();
    const onClose = vi.fn();
    render(NewShaderModal, { props: { onCreate, onClose } });

    await fireEvent.input(screen.getByLabelText('Shader name'), { target: { value: 'plasma' } });
    await fireEvent.change(screen.getByLabelText('Shader language'), { target: { value: 'slang' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create Shader' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await fireEvent.keyDown(window, { key: 'Escape' });

    expect(onCreate).toHaveBeenCalledWith('plasma', 'slang');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
