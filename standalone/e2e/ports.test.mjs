import assert from 'node:assert/strict';
import test from 'node:test';
import { standaloneE2eEndpoints } from './ports.mjs';

test('uses stable local defaults when no per-run ports are supplied', () => {
  assert.deepEqual(standaloneE2eEndpoints({}), {
    productionPort: 4174,
    developmentPort: 4175,
    productionOrigin: 'http://127.0.0.1:4174',
    developmentOrigin: 'http://127.0.0.1:4175',
  });
});

test('builds both origins from isolated per-run ports', () => {
  assert.deepEqual(standaloneE2eEndpoints({
    STANDALONE_E2E_PORT: '23456',
    STANDALONE_E2E_DEV_PORT: '33456',
  }), {
    productionPort: 23456,
    developmentPort: 33456,
    productionOrigin: 'http://127.0.0.1:23456',
    developmentOrigin: 'http://127.0.0.1:33456',
  });
});

test('rejects invalid, unsafe, and duplicate ports', () => {
  for (const value of ['0', '65536', '1.5', 'not-a-port']) {
    assert.throws(() => standaloneE2eEndpoints({ STANDALONE_E2E_PORT: value }), /STANDALONE_E2E_PORT/);
  }
  assert.throws(() => standaloneE2eEndpoints({
    STANDALONE_E2E_PORT: '25000',
    STANDALONE_E2E_DEV_PORT: '25000',
  }), /must differ/);
});
