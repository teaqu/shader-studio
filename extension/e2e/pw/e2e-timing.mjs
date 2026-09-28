import { appendFileSync } from 'node:fs';

/** Record a completed E2E phase without affecting runs that did not opt in. */
export function recordE2ePhase(phase, startedAt, details = {}, environment = process.env) {
  const path = environment.SHADER_STUDIO_E2E_TIMINGS_FILE;
  if (!path) {
    return;
  }
  appendFileSync(path, `${JSON.stringify({
    phase,
    durationMs: Math.round(performance.now() - startedAt),
    pid: process.pid,
    ...details,
  })}\n`);
}
