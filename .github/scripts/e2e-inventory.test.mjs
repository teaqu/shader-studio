import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inventory, assertPartition, assertExpectedEnvironments, discover } from './e2e-inventory.mjs';

test('inventory preserves nested titles, source references, backend tags and project repetitions', () => {
  const cases = inventory({ suites: [{ title: 'file', suites: [{ title: 'language', specs: [{
    id: 'case', title: 'reload', file: 'shared.mjs', line: 12, tags: ['gpu'],
    tests: [{ projectName: 'chromium', expectedStatus: 'passed' }, { projectName: 'firefox', expectedStatus: 'passed' }],
  }] }] }] });
  assert.equal(cases.length, 2);
  assert.deepEqual(cases[0], { id: 'case:chromium', title: 'file › language › reload', file: 'shared.mjs', line: 12, project: 'chromium', tags: ['gpu'], expectedStatus: 'passed' });
  assert.equal(cases[1].id, 'case:firefox');
});

test('failed or empty discovery cannot silently become a valid inventory', () => {
  assert.throws(() => inventory({ errors: [{ message: 'missing built package' }] }), /missing built package/);
  assert.throws(() => inventory({ suites: [] }), /no cases/);
});

test('partition rejects missing, extra and repeated cases, including repeats within one selection', () => {
  const a = { id: 'a' };
  const b = { id: 'b' };
  assertPartition([a, b], [[a], [b]]);
  for (const selections of [[[a]], [[a], [a, b]], [[a, a], [b]], [[a], [b, { id: 'c' }]]]) {
    assert.throws(() => assertPartition([a, b], selections), /exactly once/);
  }
  assert.throws(() => assertPartition([a, a], [[a]]), /exactly once/);
});

test('discovery clears inherited grep and JSON output file settings before applying its own selection', () => {
  const prior = { ...process.env };
  try {
    process.env.SHADER_STUDIO_E2E_GREP = 'stale';
    process.env.SHADER_STUDIO_E2E_GREP_INVERT = 'stale';
    process.env.PLAYWRIGHT_JSON_OUTPUT_NAME = 'stale.json';
    discover('config.mjs', { SHADER_STUDIO_E2E_GREP: '@gpu' }, (_bin, args, options) => {
      assert.ok(args.includes('--list'));
      assert.equal(options.env.SHADER_STUDIO_E2E_GREP, '@gpu');
      assert.equal(options.env.SHADER_STUDIO_E2E_GREP_INVERT, undefined);
      assert.equal(options.env.PLAYWRIGHT_JSON_OUTPUT_NAME, undefined);
      return JSON.stringify({ specs: [{ id: 'a', title: 'case', tests: [{}] }] });
    });
  } finally {
    for (const key of ['SHADER_STUDIO_E2E_GREP', 'SHADER_STUDIO_E2E_GREP_INVERT', 'PLAYWRIGHT_JSON_OUTPUT_NAME']) {
      if (prior[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prior[key];
      }
    }
  }
});

test('the reviewed environment manifest catches a lost GPU tag even if the partition is complete', () => {
  const gpu = { id: 'a', title: 'real GPU capture', tags: ['gpu'] };
  const expected = [{ id: 'a', title: 'real GPU capture', environment: 'gpu' }];
  assertExpectedEnvironments([gpu], expected);
  assertPartition([{ ...gpu, tags: [] }], [[], [{ ...gpu, tags: [] }]]);
  assert.throws(() => assertExpectedEnvironments([{ ...gpu, tags: [] }], expected), /missing or moved/);
  assert.throws(() => assertExpectedEnvironments([], expected), /inventory changed/);
  assert.throws(() => assertExpectedEnvironments([gpu], [...expected, ...expected]), /inventory changed/);
  assert.throws(() => assertExpectedEnvironments([{ ...gpu, id: 'replacement' }], expected), /missing or moved/);
});
