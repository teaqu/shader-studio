/**
 * Playwright worker count for the VS Code E2E suite: two by default, or the
 * positive integer in SHADER_STUDIO_E2E_WORKERS. A malformed value throws
 * rather than silently falling back, so a CI typo cannot change the run.
 */
export function workerCount(value) {
  if (value === undefined || value === '') {
    return 2;
  }
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`SHADER_STUDIO_E2E_WORKERS must be a positive integer, got ${JSON.stringify(value)}`);
  }
  return count;
}
