import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeExplorerSettings, EXPLORER_STATE_KEY, seedExplorerState, useSharedShaderEditor } from './explorer-preferences.mjs';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, value), values };
}

test('seeds the shared-editor preference into empty storage', () => {
  const storage = memoryStorage();
  seedExplorerState({ key: EXPLORER_STATE_KEY, state: { keepActiveShaderFiles: false }, storage });
  assert.deepEqual(JSON.parse(storage.values.get(EXPLORER_STATE_KEY)), { keepActiveShaderFiles: false });
});

test('keeps preferences a test saved before a reload', () => {
  const saved = JSON.stringify({ keepActiveShaderFiles: true, sortBy: 'name' });
  const storage = memoryStorage({ [EXPLORER_STATE_KEY]: saved });
  seedExplorerState({ key: EXPLORER_STATE_KEY, state: { keepActiveShaderFiles: false }, storage });
  assert.equal(storage.values.get(EXPLORER_STATE_KEY), saved);
});

test('registers the seed as a page init script', async () => {
  const calls = [];
  await useSharedShaderEditor({ addInitScript: async (script, arg) => calls.push([script, arg]) });
  assert.deepEqual(calls, [[seedExplorerState, { key: EXPLORER_STATE_KEY, state: { keepActiveShaderFiles: false } }]]);
});

test('closes Explorer settings with Escape and waits for it to hide', async () => {
  const calls = [];
  const page = {
    keyboard: { press: async key => calls.push(['press', key]) },
    getByRole: (role, options) => ({ waitFor: async state => calls.push(['waitFor', role, options.name, state.state]) }),
  };
  await closeExplorerSettings(page);
  assert.deepEqual(calls, [['press', 'Escape'], ['waitFor', 'region', 'Explorer settings', 'hidden']]);
});
