import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const { packages } = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));

test('Vitest integrations resolve the same version as their runner', () => {
  const runner = packages['node_modules/vitest'].version;
  const integrations = Object.entries(packages).filter(([path, entry]) =>
    path.includes('node_modules/@vitest/') && entry.peerDependencies?.vitest,
  );
  assert.ok(integrations.length > 0, 'The lockfile must include Vitest integrations');
  for (const [path, entry] of integrations) {
    assert.equal(entry.version, runner, `${path} must match vitest@${runner}`);
    assert.equal(entry.peerDependencies.vitest, runner, `${path} must accept the installed runner`);
  }
});
