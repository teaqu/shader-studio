import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import bridge from './extension.js';

async function request(port, { token, body, headers = {} } = {}) {
  return fetch(`http://127.0.0.1:${port}/`, {
    method: 'POST',
    headers: {
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...headers,
    },
    body,
  });
}

async function withBridge(run) {
  const directory = mkdtempSync(join(tmpdir(), 'shader-studio-bridge-test-'));
  const portFile = join(directory, 'bridge-port');
  const token = 't'.repeat(64);
  const calls = [];
  const server = bridge.createBridgeServer({
    vscode: { marker: 'vscode' },
    token,
    portFile,
    invoke: async (_vscode, source, args) => {
      calls.push({ source, args });
      return 'ok';
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const publication = bridge.publishPortFile({ portFile, port, owner: 'test-owner' });
  try {
    await run({ calls, port, portFile, server, token });
  } finally {
    await bridge.closeBridgeServer({ server, portFile, publication });
  }
}

test('bridge rejects requests without its per-run authorization token', async () => {
  await withBridge(async ({ calls, port }) => {
    const response = await request(port, { body: JSON.stringify({ source: '() => true' }) });

    assert.equal(response.status, 401);
    assert.equal(calls.length, 0);
  });
});

test('bridge rejects an incorrect authorization token', async () => {
  await withBridge(async ({ calls, port }) => {
    const response = await request(port, {
      token: 'x'.repeat(64),
      body: JSON.stringify({ source: '() => true' }),
    });

    assert.equal(response.status, 401);
    assert.equal(calls.length, 0);
  });
});

test('bridge rejects malformed payloads before evaluating them', async () => {
  await withBridge(async ({ calls, port, token }) => {
    const response = await request(port, { token, body: '{not json' });

    assert.equal(response.status, 400);
    assert.equal(calls.length, 0);
  });
});

test('bridge rejects a structurally invalid payload before evaluating it', async () => {
  await withBridge(async ({ calls, port, token }) => {
    const response = await request(port, { token, body: JSON.stringify({ source: '() => true', args: {} }) });

    assert.equal(response.status, 400);
    assert.equal(calls.length, 0);
  });
});

test('bridge returns invocation errors without exposing stack traces', async () => {
  const server = bridge.createBridgeServer({
    vscode: {},
    token: 't'.repeat(64),
    invoke: () => {
      throw new Error('test invocation failed');
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await request(server.address().port, {
      token: 't'.repeat(64),
      body: JSON.stringify({ source: '() => true' }),
    });
    const payload = await response.json();
    assert.deepEqual(payload, { ok: false, error: 'test invocation failed' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('bridge removes its own port publication when it shuts down', async () => {
  let portFile;
  await withBridge(async (bridge) => {
    portFile = bridge.portFile;
    assert.equal(existsSync(portFile), true);
  });
  assert.equal(existsSync(portFile), false);
});

test('bridge shutdown leaves a newer bridge port publication intact', async () => {
  let portFile;
  const replacement = JSON.stringify({ owner: 'newer-bridge', port: 12345 });
  await withBridge(async (bridge) => {
    portFile = bridge.portFile;
    writeFileSync(portFile, replacement, 'utf8');
  });
  assert.equal(readFileSync(portFile, 'utf8'), replacement);
  rmSync(portFile, { force: true });
});

test('the bridge directory is excluded from extension packages', () => {
  const ignoreFile = new URL('../../../.vscodeignore', import.meta.url);
  assert.match(readFileSync(ignoreFile, 'utf8'), /^e2e\/\*\*$/m);
});
