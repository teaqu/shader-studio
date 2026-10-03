import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordE2ePhase } from './e2e-timing.mjs';

test('phase telemetry is opt-in and includes the phase identity and duration', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ss-e2e-timing-'));
  try {
    const path = join(directory, 'timings.jsonl');
    recordE2ePhase('skipped', performance.now(), {}, {});
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
