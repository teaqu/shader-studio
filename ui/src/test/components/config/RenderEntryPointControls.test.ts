import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import RenderEntryPointControls from '../../../lib/components/config/RenderEntryPointControls.svelte';

describe('RenderEntryPointControls', () => {
  const entries = [
    { name: 'fullscreenVertex', stage: 'vertex' as const },
    { name: 'renderImage', stage: 'fragment' as const },
  ];

  it('keeps omitted stages on their hooks without choosing a sole native function', () => {
    const { getByLabelText } = render(RenderEntryPointControls, {
      pass: { inputs: {}, entryPoints: {} }, entryPoints: entries, onCommit: vi.fn(),
    });

    expect((getByLabelText('Built-in / mainVertex') as HTMLInputElement).checked).toBe(true);
    expect((getByLabelText('mainImage') as HTMLInputElement).checked).toBe(true);
  });

  it('selects only the chosen native vertex stage', async () => {
    const onCommit = vi.fn();
    const { getByLabelText } = render(RenderEntryPointControls, {
      pass: { inputs: {} }, entryPoints: entries, onCommit,
    });

    await fireEvent.click(getByLabelText('@vertex fullscreenVertex'));

    expect(onCommit).toHaveBeenCalledWith({ inputs: {}, entryPoints: { vertex: 'fullscreenVertex' } });
  });

  it('selects a native fragment without deleting the external mainVertex hook', async () => {
    const onCommit = vi.fn();
    const { getByLabelText } = render(RenderEntryPointControls, {
      pass: { inputs: {}, vertex: './camera.wgsl' }, entryPoints: entries, onCommit,
    });

    await fireEvent.click(getByLabelText('@fragment renderImage'));

    expect(onCommit).toHaveBeenCalledWith({
      inputs: {}, vertex: './camera.wgsl', entryPoints: { fragment: 'renderImage' },
    });
  });

  it('clears only the requested native stage without silently choosing the sole candidate', async () => {
    const onCommit = vi.fn();
    const { getByLabelText } = render(RenderEntryPointControls, {
      pass: { inputs: {}, entryPoints: { vertex: 'fullscreenVertex', fragment: 'renderImage' } }, entryPoints: entries, onCommit,
    });

    await fireEvent.click(getByLabelText('Built-in / mainVertex'));

    expect(onCommit).toHaveBeenCalledWith({ inputs: {}, entryPoints: { fragment: 'renderImage' } });
  });

  it('shows a configured missing stage instead of replacing it', () => {
    const { getByLabelText } = render(RenderEntryPointControls, {
      pass: { inputs: {}, entryPoints: { fragment: 'gone' } }, entryPoints: entries, onCommit: vi.fn(),
    });

    expect((getByLabelText('gone (missing)') as HTMLInputElement).checked).toBe(true);
  });
});
