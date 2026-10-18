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
    expect((getByLabelText('Fragment function') as HTMLSelectElement).value).toBe('');
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

    await fireEvent.change(getByLabelText('Fragment function'), { target: { value: 'renderImage' } });

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

    expect((getByLabelText('Fragment function') as HTMLSelectElement).value).toBe('gone');
  });
  it('shows a sole selected fragment as text, but requires an explicit choice when its hook is missing', async () => {
    const onCommit = vi.fn();
    const props = { pass: { entryPoints: { fragment: 'shade' } }, entryPoints: [{ name: 'shade', stage: 'fragment' as const }], showFragmentHook: false, stage: 'fragment' as const, onCommit };
    const view = render(RenderEntryPointControls, props);
    expect(view.getByLabelText('Fragment function')).toHaveTextContent('shade');
    expect(view.queryByRole('combobox')).toBeNull();
    expect(view.queryByText('Fragment functions')).toBeNull();
    await view.rerender({ ...props, pass: {} });
    expect(view.getByRole('combobox', { name: 'Fragment function' })).toHaveValue('');
    expect(onCommit).not.toHaveBeenCalled();
    await fireEvent.change(view.getByRole('combobox'), { target: { value: 'shade' } });
    expect(onCommit).toHaveBeenCalledWith({ entryPoints: { fragment: 'shade' } });
  });

  it('keeps missing selections visible and handles an empty fragment source', async () => {
    const props = { pass: { entryPoints: { fragment: 'gone' } }, showFragmentHook: false, stage: 'fragment' as const, onCommit: vi.fn() };
    const view = render(RenderEntryPointControls, props);
    expect(view.getByLabelText('Fragment function')).toHaveTextContent('gone (missing)');
    await view.rerender({ ...props, pass: {} });
    expect(view.getByText('No function found')).toBeVisible();
  });

  it('returns to the built-in fragment without clearing the vertex selection', async () => {
    const onCommit = vi.fn();
    const view = render(RenderEntryPointControls, { pass: { entryPoints: { vertex: 'vert', fragment: 'shade' } }, entryPoints: [{ name: 'shade', stage: 'fragment' }], stage: 'fragment', onCommit });
    await fireEvent.change(view.getByRole('combobox'), { target: { value: '' } });
    expect(onCommit).toHaveBeenCalledWith({ entryPoints: { vertex: 'vert' } });
  });


  it('lists a missing configured function and labels a native mainImage among several choices', () => {
    const { getByLabelText } = render(RenderEntryPointControls, {
      pass: { inputs: {}, entryPoints: { fragment: 'removedFn' } }, stage: 'fragment', showFragmentHook: false, onCommit: vi.fn(),
      entryPoints: [{ name: 'mainImage', stage: 'fragment' as const }, { name: 'other', stage: 'fragment' as const }],
    });
    const select = getByLabelText('Fragment function') as HTMLSelectElement;
    expect(select.classList.contains('missing')).toBe(true);
    expect([...select.options].map(option => option.textContent)).toEqual(['removedFn (missing)', 'mainImage (native)', 'other']);
  });

  it('asks for a choice when no fragment function is configured and the hook is unavailable', async () => {
    const onCommit = vi.fn();
    const { getByLabelText } = render(RenderEntryPointControls, {
      pass: { inputs: {} }, stage: 'fragment', showFragmentHook: false, onCommit,
      entryPoints: [{ name: 'only', stage: 'fragment' as const }],
    });
    const select = getByLabelText('Fragment function') as HTMLSelectElement;
    expect(select.options[0].textContent).toBe('Choose function');
    await fireEvent.change(select, { target: { value: 'only' } });
    expect(onCommit).toHaveBeenCalledWith({ inputs: {}, entryPoints: { fragment: 'only' } });
  });

  it.each([
    [{ fragment: 'gone' }, [], 'gone (missing)'],
    [undefined, [], 'mainImage'],
    [{ fragment: 'kept' }, [{ name: 'kept', stage: 'fragment' as const }], 'kept'],
  ])('shows a single fragment choice as text (%j)', (configured, candidates, text) => {
    const { getByLabelText } = render(RenderEntryPointControls, {
      pass: { inputs: {}, entryPoints: configured }, stage: 'fragment', showFragmentHook: !configured, onCommit: vi.fn(), entryPoints: candidates,
    });
    expect(getByLabelText('Fragment function').textContent).toBe(text);
  });

  it('reports when no fragment function exists', () => {
    const { getByText } = render(RenderEntryPointControls, {
      pass: { inputs: {} }, stage: 'fragment', showFragmentHook: false, onCommit: vi.fn(), entryPoints: [],
    });
    expect(getByText('No function found')).toBeTruthy();
  });
});
