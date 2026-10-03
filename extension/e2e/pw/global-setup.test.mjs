import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureE2eRunId } from './global-setup.mjs';

test('assigns a unique local run id only when CI and local ids are absent', () => {
  const environment = {};
  assert.equal(ensureE2eRunId(environment, () => 'unique'), 'local-unique');
  assert.equal(environment.SHADER_STUDIO_E2E_RUN_ID, 'local-unique');
  assert.equal(ensureE2eRunId(environment, () => 'other'), 'local-unique');
});

test('preserves supplied local and CI run identities', () => {
  assert.equal(ensureE2eRunId({ SHADER_STUDIO_E2E_RUN_ID: 'local-existing' }), 'local-existing');
  assert.equal(ensureE2eRunId({ GITHUB_RUN_ID: 'ci-run', SHADER_STUDIO_E2E_RUN_ID: 'local-existing' }), 'ci-run');
});
