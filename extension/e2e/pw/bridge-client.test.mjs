import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateBridgeCall } from './bridge-client.mjs';

test('waits for a replacement bridge publication during extension-host restart', async () => {
  let reads = 0;
  const requestedPorts = [];

  const value = await evaluateBridgeCall({
    portFile: 'bridge-port',
    token: 'test-token',
    source: '() => true',
    args: [],
    timeout: 100,
    interval: 0,
    readPort: () => {
      reads += 1;
      if (reads === 1) {
        const error = new Error('bridge publication is temporarily absent');
        error.code = 'ENOENT';
        throw error;
      }
      return 43210;
    },
    fetchImpl: async (url) => {
      requestedPorts.push(new URL(url).port);
      return { json: async () => ({ ok: true, value: 'ready' }) };
    },
    sleep: async () => {},
  });

  assert.equal(value, 'ready');
  assert.deepEqual(requestedPorts, ['43210']);
  assert.equal(reads, 2);
});

test('re-reads the bridge publication after a stale port refuses the connection', async () => {
  const ports = [41000, 42000];

  const value = await evaluateBridgeCall({
    portFile: 'bridge-port',
    token: 'test-token',
    source: '() => true',
    args: [],
    timeout: 100,
    interval: 0,
    readPort: () => ports.shift(),
    fetchImpl: async (url) => {
      if (new URL(url).port === '41000') {
        throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
      }
      return { json: async () => ({ ok: true, value: 'replacement' }) };
    },
    sleep: async () => {},
  });

  assert.equal(value, 'replacement');
});

test('does not retry extension-host evaluation failures', async () => {
  let requests = 0;

  await assert.rejects(() => evaluateBridgeCall({
    portFile: 'bridge-port',
    token: 'test-token',
    source: '() => true',
    args: [],
    timeout: 100,
    interval: 0,
    readPort: () => 43210,
    fetchImpl: async () => {
      requests += 1;
      return { json: async () => ({ ok: false, error: 'real failure' }) };
    },
    sleep: async () => {},
  }), /extension host: real failure/);

  assert.equal(requests, 1);
});
