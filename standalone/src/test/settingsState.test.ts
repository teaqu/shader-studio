import { afterEach, expect, it, vi } from 'vitest';
import { StandaloneSettings } from '../settings/StandaloneSettings';
import { connectSettings, getDefaultShaderMode, getEditorPreferences } from '../settings/settingsState.svelte';

function settings() {
  return new StandaloneSettings({ getItem: () => null, setItem: vi.fn() });
}
afterEach(() => connectSettings(settings())());

it('publishes initial settings and reacts to all editor and authoring preferences', () => {
  const store = settings();
  store.update('webgpu.defaultRenderAuthoring', 'native');
  const disconnect = connectSettings(store);
  expect(getDefaultShaderMode()).toBe('native');
  store.update('webgpu.defaultRenderAuthoring', 'hooks');
  store.update('editor.fontSize', 20);
  store.update('editor.tabSize', 2);
  store.update('editor.insertSpaces', false);
  store.update('editor.wordWrap', 'on');
  store.update('editor.minimap.enabled', true);
  store.update('editor.lineNumbers', 'off');
  expect(getDefaultShaderMode()).toBe('hooks');
  expect(getEditorPreferences()).toEqual({
    fontSize: 20, tabSize: 2, insertSpaces: false, wordWrap: 'on', minimap: true, lineNumbers: 'off',
  });
  disconnect();
  store.update('editor.fontSize', 30);
  expect(getEditorPreferences().fontSize).toBe(20);
});
