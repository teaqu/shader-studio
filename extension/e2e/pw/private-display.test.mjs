import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { hasXvfb, openWindowDisplay, shouldUsePrivateDisplay, startPrivateDisplay } from './private-display.mjs';

function fakeXvfb() {
  const server = new EventEmitter();
  server.stdio = [null, null, new PassThrough(), new PassThrough()];
  server.exitCode = null;
  server.signalCode = null;
  server.killed = 0;
  server.kill = () => {
    server.killed += 1;
    server.signalCode = 'SIGTERM';
    setImmediate(() => server.emit('exit', null, 'SIGTERM'));
  };
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    return server;
  };
  return { server, spawn, calls };
}

test('a private display is used on Linux when Xvfb is installed', () => {
  assert.equal(shouldUsePrivateDisplay({ platform: 'linux', env: {}, hasXvfb: true }), true);
});

test('no private display off Linux, without Xvfb, or when the shared display is requested', () => {
  assert.equal(shouldUsePrivateDisplay({ platform: 'darwin', env: {}, hasXvfb: true }), false);
  assert.equal(shouldUsePrivateDisplay({ platform: 'win32', env: {}, hasXvfb: true }), false);
  assert.equal(shouldUsePrivateDisplay({ platform: 'linux', env: {}, hasXvfb: false }), false);
  assert.equal(shouldUsePrivateDisplay({
    platform: 'linux', env: { SHADER_STUDIO_E2E_SHARED_DISPLAY: '1' }, hasXvfb: true,
  }), false);
});

test('hasXvfb reports whether the binary could be spawned', () => {
  assert.equal(hasXvfb(() => ({ status: 1 })), true);
  assert.equal(hasXvfb(() => ({ error: new Error('ENOENT') })), false);
});

test('startPrivateDisplay asks Xvfb for a free display and resolves with the reported number', async () => {
  const { server, spawn, calls } = fakeXvfb();
  const started = startPrivateDisplay({ spawn, screen: '800x600x24' });
  server.stdio[3].write('4');
  server.stdio[3].write('2\n');
  const display = await started;

  assert.equal(display.display, ':42');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'Xvfb');
  assert.deepEqual(calls[0].args, ['-displayfd', '3', '-screen', '0', '800x600x24', '-nolisten', 'tcp']);
  assert.deepEqual(calls[0].options.stdio, ['ignore', 'ignore', 'pipe', 'pipe']);

  await display.close();
  assert.equal(server.killed, 1);
  // Closing again after the server exited does not signal it a second time.
  await display.close();
  assert.equal(server.killed, 1);
});

test('startPrivateDisplay rejects with stderr when Xvfb exits before reporting a display', async () => {
  const { server, spawn } = fakeXvfb();
  const started = startPrivateDisplay({ spawn });
  server.stdio[2].write('Fatal server error: no screens');
  await new Promise((resolve) => setImmediate(resolve));
  server.emit('exit', 1, null);

  await assert.rejects(started, /exited before reporting a display \(1\)\nFatal server error: no screens/);
});

test('startPrivateDisplay rejects when Xvfb cannot be spawned', async () => {
  const { server, spawn } = fakeXvfb();
  const started = startPrivateDisplay({ spawn });
  server.emit('error', new Error('spawn Xvfb ENOENT'));

  await assert.rejects(started, /Xvfb failed to start: spawn Xvfb ENOENT/);
});

test('startPrivateDisplay rejects and stops Xvfb when no display is reported in time', async () => {
  const { server, spawn } = fakeXvfb();
  await assert.rejects(startPrivateDisplay({ spawn, timeout: 10 }), /did not report a display within 10ms/);
  assert.equal(server.killed, 1);
});

test('startPrivateDisplay rejects a malformed display report', async () => {
  const { server, spawn } = fakeXvfb();
  const started = startPrivateDisplay({ spawn });
  server.stdio[3].write('nope\n');

  await assert.rejects(started, /invalid display: "nope"/);
  assert.equal(server.killed, 1);
});

test('openWindowDisplay starts a private display and points DISPLAY at it', async () => {
  let closed = 0;
  const display = await openWindowDisplay({
    platform: 'linux',
    env: {},
    xvfb: () => true,
    start: async () => ({ display: ':7', close: async () => {
      closed += 1; 
    } }),
  });

  assert.equal(display.private, true);
  assert.deepEqual(display.env, { DISPLAY: ':7' });
  await display.close();
  assert.equal(closed, 1);
});

test('openWindowDisplay inherits the display, starting nothing, when the policy does not apply', async () => {
  const start = () => assert.fail('no display should start');
  for (const options of [
    { platform: 'darwin', env: {}, xvfb: () => true },
    { platform: 'linux', env: {}, xvfb: () => false },
    { platform: 'linux', env: { SHADER_STUDIO_E2E_SHARED_DISPLAY: '1' }, xvfb: () => true },
  ]) {
    const display = await openWindowDisplay({ ...options, start });
    assert.equal(display.private, false);
    assert.deepEqual(display.env, {});
    await display.close();
  }
});

test('openWindowDisplay surfaces a display that fails to start', async () => {
  await assert.rejects(openWindowDisplay({
    platform: 'linux',
    env: {},
    xvfb: () => true,
    start: async () => {
      throw new Error('Xvfb exited'); 
    },
  }), /Xvfb exited/);
});

test('startPrivateDisplay starts a real display when Xvfb is installed', { skip: !hasXvfb() }, async () => {
  const { display, close } = await startPrivateDisplay({ screen: '320x240x24' });
  assert.match(display, /^:\d+$/);
  await close();
});
