import { appendFileSync } from 'node:fs';

export function recordE2eSample(details, environment = process.env) {
  const path = environment.SHADER_STUDIO_E2E_TIMINGS_FILE;
  if (path) {
    appendFileSync(path, `${JSON.stringify({
      ...details,
      timestamp: new Date().toISOString(),
      runId: environment.GITHUB_RUN_ID ?? environment.SHADER_STUDIO_E2E_RUN_ID ?? 'local',
      runAttempt: environment.GITHUB_RUN_ATTEMPT ?? '1',
      revision: environment.GITHUB_SHA ?? environment.SHADER_STUDIO_E2E_REVISION ?? null,
      pid: process.pid,
    })}\n`);
  }
}

/** Record a completed E2E phase without affecting runs that did not opt in. */
export function recordE2ePhase(phase, startedAt, details = {}, environment = process.env) {
  const path = environment.SHADER_STUDIO_E2E_TIMINGS_FILE;
  if (!path) {
    return;
  }
  const durationMs = Math.round(performance.now() - startedAt);
  recordE2eSample({
    phase,
    durationMs,
    startedAt: new Date(Date.now() - durationMs).toISOString(),
    ...details,
  }, environment);
}
