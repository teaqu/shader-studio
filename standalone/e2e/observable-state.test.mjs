import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { waitForAnimationFrames } from './observable-state.mjs';

test('waitForAnimationFrames waits for exactly the requested fresh frames', async () => {
  let frames = 0;
  const page = { evaluate: async callback => {
    frames += 1;
    return callback();
  } };
  // requestAnimationFrame is a browser global, so a fake page only verifies
  // the number of evaluate round trips; browser coverage verifies real frames.
  const original = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = callback => callback();
  try {
    await waitForAnimationFrames(page, 3);
  } finally {
    globalThis.requestAnimationFrame = original;
  }
  assert.equal(frames, 3);
});

test('node helper contracts stay outside the standalone jsdom Vitest project', () => {
  const config = readFileSync(new URL('../vitest.config.ts', import.meta.url), 'utf8');
  assert.match(config, /e2e\/\*\*\/\*\.test\.mjs/);
});

test('replaced standalone waits are observable frame or finite stability checks', () => {
  for (const file of ['mouse-input.e2e.mjs', 'canvas-focus.e2e.mjs', 'web.e2e.mjs']) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /waitForTimeout/);
  }
  assert.match(readFileSync(new URL('./mouse-input.e2e.mjs', import.meta.url), 'utf8'), /waitForAnimationFrames/);
  assert.match(readFileSync(new URL('./web.e2e.mjs', import.meta.url), 'utf8'), /expectStableFor/);
});
