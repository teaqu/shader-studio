import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import NewShaderModal from '../NewShaderModal.svelte';

describe('NewShaderModal', () => {
  it('defaults to the global mode and allows an explicit override', async () => {
    const onCreate = vi.fn();
    render(NewShaderModal, { props: { onCreate, onClose: vi.fn(), defaultAuthoringMode: 'native' } });
    await fireEvent.change(screen.getByLabelText('Shader language'), { target: { value: 'wgsl' } });
    expect((screen.getByLabelText('Shader functions') as HTMLSelectElement).value).toBe('native');
    await fireEvent.change(screen.getByLabelText('Shader functions'), { target: { value: 'hooks' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create Shader' }));
    expect(onCreate).toHaveBeenCalledWith('untitled', 'wgsl', 'hooks');
  });
  it('defaults new shaders to GLSL', async () => {
    const onCreate = vi.fn();
    render(NewShaderModal, { props: { onCreate, onClose: vi.fn() } });

    await fireEvent.input(screen.getByLabelText('Shader name'), { target: { value: 'aurora' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create Shader' }));

    expect(onCreate).toHaveBeenCalledWith('aurora', 'glsl');
  });

  it('submits the selected WGSL shader name', async () => {
    const onCreate = vi.fn();
    render(NewShaderModal, { props: { onCreate, onClose: vi.fn() } });

    await fireEvent.input(screen.getByLabelText('Shader name'), { target: { value: 'aurora' } });
    await fireEvent.change(screen.getByLabelText('Shader language'), { target: { value: 'wgsl' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create Shader' }));

    expect(onCreate).toHaveBeenCalledWith('aurora', 'wgsl', 'hooks');
  });

  it('submits a native authoring choice for WGSL', async () => {
    const onCreate = vi.fn();
    render(NewShaderModal, { props: { onCreate, onClose: vi.fn() } });

    await fireEvent.input(screen.getByLabelText('Shader name'), { target: { value: 'aurora' } });
    await fireEvent.change(screen.getByLabelText('Shader language'), { target: { value: 'wgsl' } });
    await fireEvent.change(screen.getByLabelText('Shader functions'), { target: { value: 'native' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create Shader' }));

    expect(onCreate).toHaveBeenCalledWith('aurora', 'wgsl', 'native');
  });

  it('uses code-shaped function choices instead of authoring terminology', async () => {
    render(NewShaderModal, { props: { onCreate: vi.fn(), onClose: vi.fn() } });

    await fireEvent.change(screen.getByLabelText('Shader language'), { target: { value: 'wgsl' } });
    expect(screen.getByRole('option', { name: 'mainImage / mainVertex' })).not.toBeNull();
    expect(screen.getByRole('option', { name: '@fragment' })).not.toBeNull();
    expect(screen.queryByText(/authoring/i)).toBeNull();
  });

  it('offers the same native choice for Slang', async () => {
    const onCreate = vi.fn();
    render(NewShaderModal, { props: { onCreate, onClose: vi.fn() } });

    await fireEvent.input(screen.getByLabelText('Shader name'), { target: { value: 'aurora' } });
    await fireEvent.change(screen.getByLabelText('Shader language'), { target: { value: 'slang' } });
    await fireEvent.change(screen.getByLabelText('Shader functions'), { target: { value: 'native' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create Shader' }));

    expect(onCreate).toHaveBeenCalledWith('aurora', 'slang', 'native');
  });

  it('submits the selected GLSL shader name', async () => {
    const onCreate = vi.fn();
    render(NewShaderModal, { props: { onCreate, onClose: vi.fn() } });

    await fireEvent.input(screen.getByLabelText('Shader name'), { target: { value: 'aurora' } });
    await fireEvent.change(screen.getByLabelText('Shader language'), { target: { value: 'glsl' } });
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

    expect(onCreate).toHaveBeenCalledWith('plasma', 'slang', 'hooks');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
