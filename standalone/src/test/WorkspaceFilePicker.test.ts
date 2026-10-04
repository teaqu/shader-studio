import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, expect, it } from 'vitest';
import WorkspaceFilePicker from '../WorkspaceFilePicker.svelte';
import { finishFileSelection, requestFileSelection } from '../state/fileSelectionState.svelte';

afterEach(() => finishFileSelection(null));

it('filters paths without case sensitivity, selects a file and resets its filter', async () => {
  render(WorkspaceFilePicker);
  expect(screen.queryByRole('dialog')).toBeNull();
  await fireEvent.keyDown(window, { key: 'Escape' });
  const selected = requestFileSelection(['/Aurora.WGSL', '/buffers/clouds.glsl']);
  await tick();
  const filter = screen.getByRole('textbox', { name: 'Filter files' });
  await fireEvent.input(filter, { target: { value: 'AURORA' } });
  expect(screen.queryByRole('button', { name: '/buffers/clouds.glsl' })).toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: '/Aurora.WGSL' }));
  await expect(selected).resolves.toBe('/Aurora.WGSL');
  expect(screen.queryByRole('dialog')).toBeNull();
  const next = requestFileSelection(['/other.slang']);
  await tick();
  expect(screen.getByRole('textbox', { name: 'Filter files' })).toHaveProperty('value', '');
  expect(screen.getByRole('button', { name: '/other.slang' })).toBeTruthy();
  await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await expect(next).resolves.toBeNull();
});

it('shows an empty filtered result and only Escape cancels the request', async () => {
  render(WorkspaceFilePicker);
  const result = requestFileSelection(['/source.glsl']);
  await tick();
  await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'missing' } });
  expect(screen.getByText(/No matching workspace files/)).toBeTruthy();
  await fireEvent.keyDown(window, { key: 'Enter' });
  expect(screen.getByRole('dialog')).toBeTruthy();
  await fireEvent.keyDown(window, { key: 'Escape' });
  await expect(result).resolves.toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
});
