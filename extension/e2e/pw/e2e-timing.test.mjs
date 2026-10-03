import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { e2eTimingsPath, recordE2ePhase, withE2ePhase } from './e2e-timing.mjs';

test('phase telemetry includes the phase identity and duration', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ss-e2e-timing-'));
  try {
    const path = join(directory, 'timings.jsonl');
    recordE2ePhase('vscode-startup', performance.now() - 5, { vscodeKey: 'sample' }, {
      SHADER_STUDIO_E2E_TIMINGS_FILE: path,
      GITHUB_RUN_ID: 'run-123',
      GITHUB_RUN_ATTEMPT: '2',
      GITHUB_SHA: 'revision',
    });
    const [event] = readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(event.phase, 'vscode-startup');
    assert.equal(event.vscodeKey, 'sample');
    assert.ok(event.durationMs >= 5);
    assert.equal(event.pid, process.pid);
    assert.equal(event.runId, 'run-123');
    assert.equal(event.runAttempt, '2');
    assert.equal(event.revision, 'revision');
    assert.ok(Number.isFinite(Date.parse(event.timestamp)));
    assert.ok(Date.parse(event.timestamp) >= Date.parse(event.startedAt));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('every run has a stable default measurement destination without an opt-in', () => {
  const path = e2eTimingsPath({});
  assert.ok(path.endsWith('/extension/e2e-timings.jsonl'));
  assert.equal(e2eTimingsPath({ SHADER_STUDIO_E2E_TIMINGS_FILE: '' }), path);
  assert.equal(e2eTimingsPath({ SHADER_STUDIO_E2E_TIMINGS_FILE: '/tmp/custom.jsonl' }), '/tmp/custom.jsonl');
});

test('async phase wrapper records completed and rejected operations', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ss-e2e-timing-'));
  try {
    const path = join(directory, 'timings.jsonl');
    const environment = { SHADER_STUDIO_E2E_TIMINGS_FILE: path };
    assert.equal(await withE2ePhase('ready', async () => 'value', { worker: 1 }, environment), 'value');
    await assert.rejects(
      withE2ePhase('broken', async () => {
        throw new Error('operation failed');
      }, {}, environment),
      /operation failed/,
    );
    const events = readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(events.map(event => [event.phase, event.outcome]), [['ready', 'completed'], ['broken', 'rejected']]);
    assert.equal(events[0].worker, 1);
    assert.equal(events[1].error, 'operation failed');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('async phase wrapper preserves operation errors when recording also fails', async () => {
  const operationError = new Error('operation failed');
  await assert.rejects(
    withE2ePhase('broken', async () => {
      throw operationError;
    }, {}, { SHADER_STUDIO_E2E_TIMINGS_FILE: '/missing/timings.jsonl' }),
    error => error === operationError && error.timingError?.code === 'ENOENT',
  );
});

test('reports a recording failure after a successful operation without executing the operation again', async () => {
  let operations = 0;
  await assert.rejects(withE2ePhase('ready', async () => {
    operations++;
  }, {}, { SHADER_STUDIO_E2E_TIMINGS_FILE: '/missing/timings.jsonl' }), error => error.code === 'ENOENT');
  assert.equal(operations, 1);
});
