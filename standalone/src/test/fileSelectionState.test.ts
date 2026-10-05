import { afterEach, expect, it } from 'vitest';
import { finishFileSelection, getFileSelection, requestFileSelection } from '../state/fileSelectionState.svelte';

afterEach(() => finishFileSelection(null));

it('publishes selectable paths and resolves the selected file exactly once', async () => {
  finishFileSelection(null);
  expect(getFileSelection()).toBeNull();
  const result = requestFileSelection(['/image.wgsl', '/buffer.wgsl']);
  expect(getFileSelection()?.paths).toEqual(['/image.wgsl', '/buffer.wgsl']);
  finishFileSelection('/buffer.wgsl');
  finishFileSelection('/image.wgsl');
  await expect(result).resolves.toBe('/buffer.wgsl');
  expect(getFileSelection()).toBeNull();
});

it('cancels an outstanding request when a replacement arrives', async () => {
  const previous = requestFileSelection(['/old.glsl']);
  const replacement = requestFileSelection([]);
  await expect(previous).resolves.toBeNull();
  expect(getFileSelection()?.paths).toEqual([]);
  finishFileSelection(null);
  await expect(replacement).resolves.toBeNull();
});
