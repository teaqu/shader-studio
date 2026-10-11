import { fireEvent, render, within } from '@testing-library/svelte';
import { expect, it, vi } from 'vitest';
import BufferConfig from '../../../lib/components/config/BufferConfig.svelte';
import { getOverlayActiveFile, setOverlayActiveFile, setEditorOverlayVisible } from '../../../lib/state/editorOverlayState.svelte';

const base = { bufferName: 'BufferA', language: 'wgsl' as const, shaderPath: '/shaders/image.wgsl', config: { path: 'a.wgsl' }, onUpdate: vi.fn(), getWebviewUri: () => undefined, postMessage: vi.fn() };
it.each(['BufferA', 'common'])('opens %s through the same editor action as its tab', async bufferName => {
  setEditorOverlayVisible(false);
  const onOpenInNewTab = vi.fn();
  const view = render(BufferConfig, { ...base, bufferName, onOpenInNewTab });
  await fireEvent.click(view.getByRole('button', { name: 'Open in editor' }));
  expect(onOpenInNewTab).toHaveBeenCalledWith(bufferName, 'active');
});
it('switches an existing editor overlay to the selected buffer', async () => {
  setEditorOverlayVisible(true);
  setOverlayActiveFile('Image');
  const onOpenInNewTab = vi.fn();
  const view = render(BufferConfig, { ...base, onOpenInNewTab });
  await fireEvent.click(view.getByRole('button', { name: 'Open in editor' }));
  expect(getOverlayActiveFile()).toBe('BufferA');
  expect(onOpenInNewTab).not.toHaveBeenCalled();
  setEditorOverlayVisible(false);
});
it('omits GLSL fragment controls while retaining buffer paths and optional vertex controls', () => {
  const view = render(BufferConfig, { ...base, language: 'glsl', config: { path: 'a.glsl' } });
  expect(view.queryByRole('heading', { name: 'Fragment shader' })).toBeNull();
  expect(view.queryByRole('group', { name: 'Fragment function controls' })).toBeNull();
  expect(view.getAllByText('a.glsl')[0]).toBeVisible();
  expect(view.getByRole('heading', { name: 'Vertex shader' })).toBeVisible();
});
it('keeps output format in its own section after resolution', () => {
  const view = render(BufferConfig, base);
  expect(view.getByRole('region', { name: 'Output' }).contains(view.getByLabelText('Output format'))).toBe(true);
  expect(view.container.querySelector('.resolution-section')!.contains(view.getByLabelText('Output format'))).toBe(false);
});
it('shows the current fragment file and offers config files through Choose another file', async () => {
  const onUpdate = vi.fn();
  const view = render(BufferConfig, { ...base, onUpdate, projectConfig: { version: '1.0', passes: { Image: {}, BufferB: { path: 'b.wgsl' } } } });
  expect(view.getAllByText('a.wgsl')[0]).toBeVisible();
  await fireEvent.click(view.getByRole('button', { name: 'Choose another file…' }));
  await fireEvent.click(view.getByRole('button', { name: 'b.wgsl' }));
  expect(onUpdate).toHaveBeenCalledWith('BufferA', expect.objectContaining({ path: 'b.wgsl' }));
  expect(view.queryByRole('dialog')).toBeNull();
});
it('reveals a visible editable path for Separate file', async () => {
  const view = render(BufferConfig, { ...base, isImagePass: true, bufferName: 'Image', config: {} });
  expect(view.getByRole('button', { name: /^Built-in$/ })).toHaveAttribute('aria-pressed', 'true');
  expect(view.queryByText('Viewer vertex shader')).toBeNull();
  await fireEvent.click(view.getByRole('button', { name: 'Separate file' }));
  expect(view.getByLabelText('File')).toBeVisible();
});
it('preserves fragment settings when choosing same file and clearing vertex', async () => {
  const onUpdate = vi.fn();
  const view = render(BufferConfig, { ...base, onUpdate, config: { path: 'a.wgsl', entryPoints: { fragment: 'shade' } } });
  await fireEvent.click(view.getByRole('button', { name: 'Same file' }));
  expect(onUpdate).toHaveBeenLastCalledWith('BufferA', expect.objectContaining({ vertex: 'a.wgsl', entryPoints: { fragment: 'shade' } }));
  await fireEvent.click(view.getByRole('button', { name: 'Built-in' }));
  expect(onUpdate.mock.calls.at(-1)![1]).not.toHaveProperty('vertex');
  expect(onUpdate.mock.calls.at(-1)![1].entryPoints).toEqual({ fragment: 'shade' });
});
it.each(['glsl', 'wgsl', 'slang'] as const)('hides same-file path and keeps vertex Add for %s', language => {
  const path = `/shaders/image.${language}`;
  const view = render(BufferConfig, { ...base, language, shaderPath: path, isImagePass: true, bufferName: 'Image', config: { vertex: path } });
  const section = view.getByRole('heading', { name: 'Vertex shader' }).parentElement!;
  expect(within(section).queryByLabelText('File')).toBeNull();
  expect(within(section).getByRole('button', { name: 'Add function…' })).toBeVisible();
});
it('Image has no fragment file selection', () => {
  const view = render(BufferConfig, { ...base, isImagePass: true, bufferName: 'Image', config: {} });
  expect(view.queryByLabelText('File')).toBeNull();
  expect(view.queryByRole('button', { name: 'Change…' })).toBeNull();
});
