import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workerCount } from './workers.mjs';

test('defaults to two workers when the override is unset or empty', () => {
  assert.equal(workerCount(undefined), 2);
  assert.equal(workerCount(''), 2);
});

test('uses a positive integer override', () => {
  assert.equal(workerCount('1'), 1);
  assert.equal(workerCount('3'), 3);
});

for (const value of ['0', '-1', '2.5', 'three', ' ', 'NaN', 'Infinity']) {
  test(`rejects ${JSON.stringify(value)}`, () => {
    assert.throws(() => workerCount(value), /SHADER_STUDIO_E2E_WORKERS must be a positive integer/);
  });
}
