import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import RenderEntryPointControls from '../../../lib/components/config/RenderEntryPointControls.svelte';

describe('RenderEntryPointControls', () => {
  const entries = [
    { name: 'fullscreenVertex', stage: 'vertex' as const },
    { name: 'renderImage', stage: 'fragment' as const },
  ];

  it('keeps existing render passes on ShaderToy hooks', () => {
    const { getByLabelText, queryByLabelText } = render(RenderEntryPointControls, {
      pass: { inputs: {} }, entryPoints: entries, onCommit: vi.fn(),
    });

    expect((getByLabelText('Render authoring') as HTMLSelectElement).value).toBe('hooks');
    expect(queryByLabelText('Vertex entrypoint')).toBeNull();
  });

  it('selects sole native entry points when native authoring is enabled', async () => {
    const onCommit = vi.fn();
    const { getByLabelText } = render(RenderEntryPointControls, {
      pass: { inputs: {} }, entryPoints: entries, onCommit,
    });

    await fireEvent.change(getByLabelText('Render authoring'), { target: { value: 'native' } });

    expect(onCommit).toHaveBeenCalledWith({
      inputs: {}, entryPoints: { vertex: 'fullscreenVertex', fragment: 'renderImage' },
    });
  });

  it('removes a legacy vertex file when switching to native entry points', async () => {
    const onCommit = vi.fn();
    const { getByLabelText } = render(RenderEntryPointControls, {
      pass: { inputs: {}, vertex: './fullscreen.wgsl' }, entryPoints: entries, onCommit,
    });

    await fireEvent.change(getByLabelText('Render authoring'), { target: { value: 'native' } });

    expect(onCommit).toHaveBeenCalledWith({
      inputs: {}, entryPoints: { vertex: 'fullscreenVertex', fragment: 'renderImage' },
    });
  });

  it('shows a configured missing entry point instead of silently replacing it', () => {
    const { getByLabelText } = render(RenderEntryPointControls, {
      pass: { inputs: {}, entryPoints: { fragment: 'gone' } }, entryPoints: entries, onCommit: vi.fn(),
    });

    const fragment = getByLabelText('Fragment entrypoint') as HTMLSelectElement;
    expect(fragment.value).toBe('gone');
    expect(Array.from(fragment.options).some((option) => option.text === 'gone (missing)')).toBe(true);
  });

  it('returns to hooks by removing native selection', async () => {
    const onCommit = vi.fn();
    const { getByLabelText } = render(RenderEntryPointControls, {
      pass: { inputs: {}, entryPoints: { fragment: 'renderImage' } }, entryPoints: entries, onCommit,
    });

    await fireEvent.change(getByLabelText('Render authoring'), { target: { value: 'hooks' } });

    expect(onCommit).toHaveBeenCalledWith({ inputs: {} });
  });
});
