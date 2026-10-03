import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { parseProcessTable, updateOwnedProcesses, processRole, monitorProcessTree, closeOwnedProcessTree, readProcessTable } from './process-tree.mjs';

const row = (pid, ppid, started = 'birth', command = '', state = 'R') => ({ pid, ppid, started, command, state, rssKiB: 10 });

test('parse ps identities and commands with spaces; ignore malformed lines', () => {
  const rows = parseProcessTable(' 12 1 2048 Sat Oct  3 10:23:45 2026 S /A path/Electron --type=gpu-process\ninvalid\n');
  assert.deepEqual(rows, [{ pid: 12, ppid: 1, rssKiB: 2048, started: 'Sat Oct  3 10:23:45 2026', state: 'S', command: '/A path/Electron --type=gpu-process' }]);
  assert.equal(processRole(rows[0], 11), 'gpu');
  assert.equal(processRole(rows[0], 12), 'electron-main');
  assert.equal(processRole(row(2, 1, 'birth', '--type=renderer'), 1), 'renderer');
  assert.equal(processRole(row(2, 1, 'birth', '--utility-sub-type=node.mojom.NodeService'), 1), 'node-service');
});

test('track grandchildren out of order, retain orphans, exclude unrelated and recycled PIDs', () => {
  const owned = new Map([[1, row(1, 0)]]);
  assert.deepEqual(updateOwnedProcesses(owned, [row(3, 2), row(2, 1), row(1, 0), row(9, 0)], 1).map(r => r.pid), [3, 2, 1]);
  assert.deepEqual(updateOwnedProcesses(owned, [row(3, 0), row(2, 0, 'recycled'), row(9, 0)], 1).map(r => r.pid), [3]);
  assert.deepEqual(updateOwnedProcesses(owned, [row(3, 0, 'birth', '', 'Z')], 1), []);
});

function fakeTree({ survives = false } = {}) {
  let live = true;
  const signals = [];
  let stopped = false;
  return {
    inspect: async () => live ? [row(1, 0)] : [],
    terminate: async name => {
      signals.push(name);
      if (!survives && name === 'SIGKILL') {
        live = false;
      }
    },
    summary: () => ({ peakRssKiB: 10 }),
    stop: async () => {
      stopped = true;
    },
    exit: () => {
      live = false;
    },
    get signals() {
      return signals;
    },
    get stopped() {
      return stopped;
    },
  };
}
const limits = { gracefulMs: 5, terminateMs: 0, killMs: 0 };

test('graceful close cancels its timer and never signals exited processes', async () => {
  const tree = fakeTree();
  const result = await closeOwnedProcessTree(async () => tree.exit(), tree, limits);
  assert.equal(result.graceful, true);
  assert.equal(result.forced, false);
  assert.deepEqual(tree.signals, []);
  assert.equal(tree.stopped, true);
});

test('wedged close and rejected close both receive bounded owned-tree fallback', async () => {
  for (const close of [() => new Promise(() => {}), () => {
    throw new Error('original close failure');
  }]) {
    const tree = fakeTree();
    const result = await closeOwnedProcessTree(close, tree, limits);
    assert.equal(result.graceful, false);
    assert.equal(result.forced, true);
    assert.deepEqual(tree.signals, ['SIGTERM', 'SIGKILL']);
    assert.equal(tree.stopped, true);
  }
});

test('survivors are an actionable failure and stop sampling', async () => {
  const tree = fakeTree({ survives: true });
  await assert.rejects(closeOwnedProcessTree(() => new Promise(() => {}), tree, limits), /Owned process tree did not exit.*pid/);
  assert.equal(tree.stopped, true);
});

test('monitor refuses to signal a PID whose start identity changed', async () => {
  let rows = [row(1, 0), row(2, 1)];
  const signals = [];
  const tree = await monitorProcessTree(1, { read: async () => rows, signal: (...args) => signals.push(args) });
  rows = [row(1, 0), row(2, 1, 'recycled')];
  await tree.terminate('SIGTERM');
  assert.deepEqual(signals, [[1, 'SIGTERM']]);
  await tree.stop();
});

test('termination orders grandchildren before parents regardless of process-table order', async () => {
  const signals = [];
  const tree = await monitorProcessTree(1, {
    read: async () => [row(3, 2), row(1, 0), row(2, 1)],
    signal: pid => signals.push(pid),
  });
  await tree.terminate('SIGTERM');
  assert.deepEqual(signals, [3, 2, 1]);
  await tree.stop();
});

test('an inspection failure is reported without poisoning a fresh cleanup inspection', async () => {
  let fail = false;
  const tree = await monitorProcessTree(1, { read: async () => {
    if (fail) {
      fail = false;
      throw new Error('process inventory unavailable');
    }
    return [row(1, 0)];
  } });
  fail = true;
  await assert.rejects(tree.inspect(), /inventory unavailable/);
  assert.equal((await tree.inspect()).length, 1);
  await tree.stop();
});

test('a missing launch PID cannot silently count as verified exit', async () => {
  await assert.rejects(monitorProcessTree(1, { read: async () => [] }), /PID 1 was not found/);
});

test('real wedged tree exits without terminating an unrelated process', { skip: process.platform === 'win32' }, async () => {
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  const script = `const {spawn}=require('node:child_process'); process.on('SIGTERM',()=>{}); const c=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)"],{stdio:'ignore'}); console.log(c.pid); setInterval(()=>{},1000);`;
  const parent = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
  let childPid;
  let tree;
  try {
    const [data] = await once(parent.stdout, 'data');
    childPid = Number(data.toString().trim());
    tree = await monitorProcessTree(parent.pid, { intervalMs: 50 });
    assert.ok((await tree.inspect()).some(r => r.pid === childPid));
    const result = await closeOwnedProcessTree(() => new Promise(() => {}), tree, { gracefulMs: 20, terminateMs: 100, killMs: 1000 });
    assert.equal(result.forced, true);
    assert.equal((await readProcessTable()).filter(r => [parent.pid, childPid].includes(r.pid) && !r.state.startsWith('Z')).length, 0);
    assert.equal(unrelated.exitCode, null);
  } finally {
    await tree?.stop().catch(() => {});
    for (const pid of [childPid, parent.pid, unrelated.pid].filter(Boolean)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch { /* already exited */ }
    }
  }
});

test('slow periodic inventories do not queue stale reads ahead of cleanup', async () => {
  let reads = 0;
  let release;
  let started;
  const blocked = new Promise(resolve => {
    started = resolve;
  });
  const tree = await monitorProcessTree(1, {
    intervalMs: 2,
    read: async () => {
      reads++;
      if (reads === 3) {
        started();
        await new Promise(resolve => {
          release = resolve;
        });
      }
      return [row(1, 0)];
    },
  });
  try {
    await blocked;
    await new Promise(resolve => setTimeout(resolve, 30));
    // Cleanup must request a fresh read, but must not inherit queued ticks.
    const inspection = tree.inspect();
    release();
    await inspection;
    await tree.stop();
    assert.equal(reads, 4);
    assert.ok(tree.summary().inventory.skippedPeriodicSamples > 0);
  } finally {
    release?.();
    await tree.stop();
  }
});

test('shutdown records graceful close separately from verification and escalation', async () => {
  const tree = fakeTree();
  const phases = [];
  const result = await closeOwnedProcessTree(async () => tree.exit(), tree, {
    ...limits, phase: details => phases.push(details),
  });
  assert.deepEqual(phases.map(details => details.phase), ['pre-close-inventory', 'graceful-close', 'post-close-verification']);
  assert.equal(phases[1].outcome, 'completed');
  assert.equal(phases[2].exited, true);
  assert.ok(phases.every(details => details.durationMs >= 0));
  assert.equal(result.graceful, true);
});

test('failed shutdown retains phase evidence and stops the sampler', async () => {
  const tree = fakeTree({ survives: true });
  const phases = [];
  await assert.rejects(closeOwnedProcessTree(() => {
    throw new Error('close rejected');
  }, tree, {
    ...limits, phase: details => phases.push(details),
  }), /Owned process tree did not exit/);
  assert.deepEqual(phases.map(details => details.phase), [
    'pre-close-inventory', 'graceful-close', 'post-close-verification', 'owned-sigterm', 'owned-sigkill',
  ]);
  assert.equal(phases[1].outcome, 'rejected');
  assert.equal(phases[1].closeError, 'close rejected');
  assert.equal(phases.at(-1).exited, false);
  assert.equal(tree.stopped, true);
});

test('timing observer failure cannot prevent verified owned-tree cleanup', async () => {
  const tree = fakeTree();
  const result = await closeOwnedProcessTree(async () => tree.exit(), tree, {
    ...limits, phase: () => {
      throw new Error('disk full');
    },
  });
  assert.equal(result.forced, false);
  assert.equal(tree.stopped, true);
  assert.deepEqual(result.measurementErrors, ['disk full', 'disk full', 'disk full']);
});

test('process telemetry failure leaves authoritative inventory and shutdown usable', async () => {
  let live = true;
  let fail = false;
  const tree = await monitorProcessTree(1, {
    read: async () => live ? [row(1, 0)] : [],
    sample: () => {
      if (fail) {
        throw new Error('sample sink unavailable');
      }
    },
  });
  try {
    fail = true;
    assert.equal((await tree.inspect()).length, 1);
    const result = await closeOwnedProcessTree(async () => {
      live = false;
    }, tree, limits);
    assert.equal(result.forced, false);
    assert.ok(result.samplingErrors.includes('sample sink unavailable'));
  } finally {
    await tree.stop();
  }
});
