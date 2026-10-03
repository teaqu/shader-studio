import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const defaultTimingsPath = fileURLToPath(new URL('../../e2e-timings.jsonl', import.meta.url));

export function e2eTimingsPath(environment = process.env) {
  return environment.SHADER_STUDIO_E2E_TIMINGS_FILE || defaultTimingsPath;
}

export function recordE2eSample(details, environment = process.env) {
  const path = e2eTimingsPath(environment);
  appendFileSync(path, `${JSON.stringify({
    ...details,
    timestamp: new Date().toISOString(),
    runId: environment.GITHUB_RUN_ID ?? environment.SHADER_STUDIO_E2E_RUN_ID ?? 'local',
    runAttempt: environment.GITHUB_RUN_ATTEMPT ?? '1',
    revision: environment.GITHUB_SHA ?? environment.SHADER_STUDIO_E2E_REVISION ?? null,
    pid: process.pid,
  })}\n`);
}

/** Record every completed E2E phase, including local runs without configuration. */
export function recordE2ePhase(phase, startedAt, details = {}, environment = process.env) {
  const durationMs = Math.round(performance.now() - startedAt);
  recordE2eSample({
    phase,
    durationMs,
    startedAt: new Date(Date.now() - durationMs).toISOString(),
    ...details,
  }, environment);
}

/** Measure an asynchronous phase and retain an operation failure over a sink failure. */
export async function withE2ePhase(phase, operation, details = {}, environment = process.env) {
  const startedAt = performance.now();
  let value;
  try {
    value = await operation();
  } catch (error) {
    try {
      recordE2ePhase(phase, startedAt, { ...details, outcome: 'rejected', error: error.message }, environment);
    } catch (recordingError) {
      error.timingError ??= recordingError;
    }
    throw error;
  }
  recordE2ePhase(phase, startedAt, { ...details, outcome: 'completed' }, environment);
  return value;
}
