import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setDebugPanelControl } from './debug-panel-controls.mjs';

function fakeFrame(initial, { respond = true } = {}) {
  const calls = { selectors: [], clicks: 0 };
  let active = initial;
  const button = {
    waitFor: async () => {},
    evaluate: async read => read({ classList: { contains: name => name === 'active' && active } }),
    click: async () => {
      calls.clicks++;
      if (respond) {
        active = !active;
      }
    },
  };
  const frame = { locator: selector => {
    calls.selectors.push(selector);
    return { first: () => button };
  } };
  return { frame, calls };
}

for (const [initial, wanted, clicks] of [[false, true, 1], [true, true, 0], [true, false, 1], [false, false, 0]]) {
  test(`a control that is ${initial ? 'on' : 'off'} ends ${wanted ? 'on' : 'off'} with ${clicks} click(s)`, async () => {
    const { frame, calls } = fakeFrame(initial);
    await setDebugPanelControl(frame, 'Toggle inline rendering', wanted);
    assert.equal(calls.clicks, clicks);
    assert.deepEqual(calls.selectors, ['.debug-panel [aria-label="Toggle inline rendering"]']);
  });
}

test('reports a control that never reaches the wanted state', async () => {
  const { frame } = fakeFrame(false, { respond: false });
  await assert.rejects(
    setDebugPanelControl(frame, 'Toggle variable inspector', true, { timeout: 20, interval: 5 }),
    /Toggle variable inspector did not become active/,
  );
});
