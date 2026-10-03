import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachCleanupFailure, cleanupFixture } from './fixture-cleanup.mjs';

function fixture({ tree = {}, closeTree, removeProfile, displayClose, appClose } = {}) {
  const calls = [];
  return {
    calls,
    options: {
      app: { close: appClose ?? (async () => calls.push('app.close')) },
      processTree: tree,
      processPid: 123,
      userDataDir: '/tmp/profile',
      windowDisplay: { close: async () => {
        calls.push('display.close');
        await displayClose?.();
      } },
      closeTree: closeTree ?? (async () => {
        calls.push('tree.close');
        return { forced: false, closeError: undefined, samplingErrors: [] };
      }),
      removeProfile: removeProfile ?? (path => calls.push(`profile.remove:${path}`)),
      gracefulCloseMs: 10,
    },
  };
}

test('removes the profile only after verified owned-tree exit and closes the display', async () => {
  const value = fixture({ tree: {} });
  const result = await cleanupFixture(value.options);
  assert.equal(result.forced, false);
  assert.deepEqual(value.calls, ['tree.close', 'profile.remove:/tmp/profile', 'display.close']);
});

test('forwards cleanup phase telemetry to the owned-tree closer', async () => {
  const phases = [];
  const value = fixture({ tree: {}, closeTree: async (_close, _tree, options) => {
    options.phase({ phase: 'graceful-close', durationMs: 12 });
    return { forced: false, closeError: undefined, samplingErrors: [] };
  } });
  await cleanupFixture({ ...value.options, phase: phase => phases.push(phase) });
  assert.deepEqual(phases, [{ phase: 'graceful-close', durationMs: 12 }]);
});

test('missing inventory retains profile and still closes app and display', async () => {
  const value = fixture({ tree: null });
  await assert.rejects(cleanupFixture(value.options), /Cannot verify owned Electron process exit \(PID 123\).*profile retained/);
  assert.deepEqual(value.calls, ['app.close', 'display.close']);
});

test('survivor or inspection failure retains profile, retries graceful close, and closes display', async () => {
  const value = fixture({ tree: {}, closeTree: async () => {
    value.calls.push('tree.close');
    throw new Error('Owned process tree did not exit: survivors');
  } });
  await assert.rejects(cleanupFixture(value.options), /Cannot verify owned Electron process exit.*profile retained.*Owned process tree did not exit: survivors/);
  assert.deepEqual(value.calls, ['tree.close', 'app.close', 'display.close']);
});

test('a rejected or timed-out fallback close still closes the display and retains profile', async () => {
  const rejectedClose = async () => {
    throw new Error('window is gone');
  };
  for (const appClose of [rejectedClose, () => new Promise(() => {})]) {
    const value = fixture({ tree: null, appClose });
    await assert.rejects(cleanupFixture(value.options), /profile retained.*graceful close (failed|timed out)/);
    assert.deepEqual(value.calls, ['display.close']);
  }
});

test('profile removal failure retains the profile and still closes the display after verified exit', async () => {
  const value = fixture({ tree: {}, removeProfile: () => {
    value.calls.push('profile.remove:/tmp/profile');
    throw new Error('disk unavailable');
  } });
  await assert.rejects(cleanupFixture(value.options), /exit was verified, but profile removal failed.*disk unavailable/);
  assert.deepEqual(value.calls, ['tree.close', 'profile.remove:/tmp/profile', 'display.close']);
});

test('preserves a prior primary-error cause while attaching cleanup diagnostics', () => {
  const primary = new Error('test failed', { cause: new Error('setup failure') });
  const cleanup = new Error('profile retained');
  assert.equal(attachCleanupFailure(primary, cleanup), primary);
  assert.equal(primary.cause.message, 'setup failure');
  assert.equal(primary.cleanupError, cleanup);
});

test('display cleanup failure is reported without deleting an unverified profile', async () => {
  const value = fixture({ tree: null, displayClose: async () => {
    throw new Error('Xvfb did not stop');
  } });
  await assert.rejects(cleanupFixture(value.options), /profile retained.*private display cleanup failed: Xvfb did not stop/);
  assert.deepEqual(value.calls, ['app.close', 'display.close']);
});

test('does not repeat graceful close after the verified-tree closer already attempted it', async () => {
  const value = fixture({ closeTree: async close => {
    await close();
    throw new Error('Owned process tree did not exit: survivors');
  } });
  await assert.rejects(cleanupFixture(value.options), /survivors/);
  assert.deepEqual(value.calls, ['app.close', 'display.close']);
});
