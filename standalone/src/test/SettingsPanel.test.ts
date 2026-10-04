import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, expect, it, vi } from 'vitest';
import SettingsPanel from '../settings/SettingsPanel.svelte';
import { StandaloneSettings } from '../settings/StandaloneSettings';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn();
});

it('exposes a persistent default shader mode in global settings', async () => {
  const values = new Map<string, string>();
  const backend = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => {
    values.set(key, value);
  } };
  const settings = new StandaloneSettings(backend);
  render(SettingsPanel, { settings, onClose: vi.fn() });
  const mode = screen.getByRole('combobox', { name: 'Default shader mode' });
  await fireEvent.change(mode, { target: { value: 'native' } });
  expect(new StandaloneSettings(backend).snapshot).toMatchObject({ 'webgpu.defaultRenderAuthoring': 'native' });
});

it('searches relevant preferences and applies and resets them through the store', async () => {
  const settings = new StandaloneSettings({ getItem: () => null, setItem: vi.fn() });
  render(SettingsPanel, { settings, onClose: vi.fn() });
  const camera = screen.getByRole('checkbox', { name: 'Use viewer camera' });
  await fireEvent.click(camera);
  expect(settings.snapshot['webgpu.useViewerCamera']).toBe(false);
  await fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'font size' } });
  expect(screen.queryByRole('checkbox', { name: 'Use viewer camera' })).toBeNull();
  const font = screen.getByRole('spinbutton', { name: 'Font size' });
  await fireEvent.change(font, { target: { value: '22' } });
  expect(settings.snapshot['editor.fontSize']).toBe(22);
  await fireEvent.change(font, { target: { value: '99' } });
  expect(settings.snapshot['editor.fontSize']).toBe(22);
  expect((font as HTMLInputElement).value).toBe('22');
  await fireEvent.click(screen.getByRole('button', { name: 'Reset all settings' }));
  expect(settings.snapshot['editor.fontSize']).toBe(14);
  expect(settings.snapshot['webgpu.useViewerCamera']).toBe(true);
  await fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'unmatched' } });
  expect(screen.getByRole('status').textContent).toBe('No matching settings.');
});

it('closes on dialog cancellation and releases its settings subscription', async () => {
  const settings = new StandaloneSettings({ getItem: () => null, setItem: vi.fn() });
  const subscribe = vi.spyOn(settings, 'subscribe');
  const onClose = vi.fn();
  const { unmount } = render(SettingsPanel, { settings, onClose });
  await fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  expect(onClose).toHaveBeenCalledOnce();
  await fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(2);
  expect(subscribe).toHaveBeenCalledOnce();
  unmount();
  expect(HTMLDialogElement.prototype.close).toHaveBeenCalledOnce();
});
