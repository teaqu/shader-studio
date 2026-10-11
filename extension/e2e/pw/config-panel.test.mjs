import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openConfigPanel } from './config-panel.mjs';

for (const visible of [true, false]) {
  test(`configuration uses the reachable control when toolbar visibility is ${visible}`, async () => {
    const clicks = [];
    const control = name => ({ click: async () => {
 clicks.push(name); 
} });
    const frame = {
      locator: selector => selector.startsWith('.collapse-config')
        ? { ...control('toolbar'), isVisible: async () => visible }
        : { getByLabel: () => control('menu config') },
      getByLabel: () => control('options'),
    };
    await openConfigPanel(frame);
    assert.deepEqual(clicks, visible ? ['toolbar'] : ['options', 'menu config']);
  });
}

test('configuration propagates menu failures', async () => {
  const frame = {
    locator: () => ({ isVisible: async () => false }),
    getByLabel: () => ({ click: async () => {
 throw new Error('menu unavailable'); 
} }),
  };
  await assert.rejects(openConfigPanel(frame), /menu unavailable/);
});
