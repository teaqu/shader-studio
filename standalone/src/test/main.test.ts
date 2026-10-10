import { afterEach, expect, it, vi } from 'vitest';
import type { HostConfig } from '@shader-studio/ui';

const mocks = vi.hoisted(() => ({
  configureHost: vi.fn(), mount: vi.fn(), update: vi.fn(),
  install: vi.fn(), start: vi.fn(),
}));
vi.mock('svelte', () => ({ mount: mocks.mount }));
vi.mock('@shader-studio/ui', () => ({ configureHost: mocks.configureHost }));
vi.mock('../App.svelte', () => ({ default: {} }));
vi.mock('../WebTransport', () => ({ WebTransport: class {
  settings = { update: mocks.update };
} }));
vi.mock('../slangAssets', () => ({ installSlangAssetMetadata: mocks.install }));
vi.mock('../pwa', () => ({ createPwaController: () => ({ start: mocks.start }) }));
vi.mock('../settings/settingsState.svelte', () => ({ getEditorPreferences: vi.fn() }));

afterEach(() => {
  document.body.innerHTML = '';
});
it('connects persisted wrap commands to the mobile host before mounting the app', async () => {
  document.body.innerHTML = '<div id="app"></div>';
  await import('../main');
  const config = mocks.configureHost.mock.calls[0][0] as HostConfig;
  expect(config.createTransport?.()).toHaveProperty('settings');
  config.setEditorWordWrap?.('on');
  config.setEditorWordWrap?.('off');
  expect(mocks.update.mock.calls).toEqual([['editor.wordWrap', 'on'], ['editor.wordWrap', 'off']]);
  expect(config.defaultAssets).toHaveLength(2);
  expect(config.defaultAssets?.every(asset => asset.thumbnailUri?.startsWith(document.baseURI))).toBe(true);
  expect(config.capabilities).toEqual({ compileOnSave: false });
  expect(mocks.install).toHaveBeenCalledOnce();
  expect(mocks.mount).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ target: document.getElementById('app') }));
  expect(mocks.start).toHaveBeenCalledOnce();
});
