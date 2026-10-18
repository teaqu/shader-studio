import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearestVerticalBoxIndex, sashAtLeftEdge } from './dock-sashes.mjs';

test('picks the vertical sash nearest the pane edge, ignoring horizontal ones', () => {
  const boxes = [
    { x: 260, width: 4, height: 600 },
    { x: 0, width: 260, height: 4 },
    { x: 718, width: 4, height: 600 },
  ];
  assert.equal(nearestVerticalBoxIndex(boxes, 720), 2);
  assert.equal(nearestVerticalBoxIndex(boxes, 250), 0);
  assert.equal(nearestVerticalBoxIndex([{ x: 0, width: 260, height: 4 }], 10), -1);
});

function fakePage(boxes) {
  const nth = [];
  return {
    nth,
    locator: () => ({
      evaluateAll: async callback => callback(boxes.map(box => ({ getBoundingClientRect: () => box }))),
      nth: index => {
        nth.push(index);
        return { index };
      },
    }),
  };
}

test('returns the matching sash locator and reports a layout without one', async () => {
  const page = fakePage([{ x: 0, width: 300, height: 4 }, { x: 500, width: 4, height: 400 }]);
  assert.deepEqual(await sashAtLeftEdge(page, 502), { index: 1 });
  await assert.rejects(sashAtLeftEdge(fakePage([{ x: 0, width: 300, height: 4 }]), 10), /No vertical layout sash/);
});
