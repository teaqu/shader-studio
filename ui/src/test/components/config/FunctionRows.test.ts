import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import RenderEntryPointControls from '../../../lib/components/config/RenderEntryPointControls.svelte';

describe('function rows', () => {
  it('shows all stage candidates and selects a row without changing the other stage', async () => {
    const onCommit = vi.fn();
    const view = render(RenderEntryPointControls, { pass: { entryPoints: { vertex: 'mesh' } }, entryPoints: [{ name: 'colour', stage: 'fragment' }, { name: 'normals', stage: 'fragment' }, { name: 'mesh', stage: 'vertex' }], onCommit });
    expect(view.getByRole('radio', { name: '@fragment colour' })).toBeTruthy();
    await fireEvent.click(view.getByRole('radio', { name: '@fragment normals' }));
    expect(onCommit).toHaveBeenCalledWith({ entryPoints: { vertex: 'mesh', fragment: 'normals' } });
    expect(view.queryByRole('combobox')).toBeNull();
  });
});
