/**
 * Temporary variable-capture diagnostics. Tracks live GPU resources, pending
 * readbacks, pipeline-cache size, capture-loop tick rate, and phase timings to
 * pin down the "inspector gets slower over time / blocks the UI" report.
 *
 * Toggle at runtime from the devtools console:
 *   window.__captureDiag = true   // enable
 *   window.__captureDiag = false  // disable
 * Disabled by default to keep normal inspector polling out of the console.
 *
 * REMOVE once the root cause is found.
 */

interface DiagWindow {
  __captureDiag?: boolean;
}

export function captureDiagEnabled(): boolean {
  // Keep test output clean — never log under the test runner.
  const proc = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process;
  if (proc?.env?.VITEST || proc?.env?.NODE_ENV === 'test') {
    return false;
  }
  const w = globalThis as unknown as DiagWindow;
  return w.__captureDiag === true;
}

/** Monotonic counters. Live totals reveal leaks; a value that only climbs = leak. */
export const captureCounters = {
  gpuBuffersCreated: 0,
  gpuBuffersDestroyed: 0,
  gpuTexturesCreated: 0,
  gpuTexturesDestroyed: 0,
  pipelineCompiles: 0,
  capturesIssued: 0,
  readbacksResolved: 0,
  loopTicks: 0,
  issueCalls: 0,
  decodeCalls: 0,
};

export function resetCaptureCounters(): void {
  for (const key of Object.keys(captureCounters) as Array<keyof typeof captureCounters>) {
    captureCounters[key] = 0;
  }
}

// Independent throttle per source so manager.loop and capturer.issue don't
// starve each other (they'd otherwise share one gate and drop each other).
const lastLogAt = new Map<string, number>();
const LOG_INTERVAL_MS = 1000;
let ratesResetAt = 0;

/**
 * Throttled summary log (once per second per source). The leak-critical
 * numbers go in the message STRING (not a nested object) so the console can't
 * collapse them behind a "…". Pass live gauges specific to the call site.
 */
export function captureDiagTick(source: string, gauges: Record<string, number>): void {
  if (!captureDiagEnabled()) {
    return;
  }
  const now = performance.now();
  if (now - (lastLogAt.get(source) ?? 0) < LOG_INTERVAL_MS) {
    return;
  }
  lastLogAt.set(source, now);

  const c = captureCounters;
  const liveBuffers = c.gpuBuffersCreated - c.gpuBuffersDestroyed;
  const liveTextures = c.gpuTexturesCreated - c.gpuTexturesDestroyed;
  const gaugeStr = Object.entries(gauges).map(([k, v]) => `${k}=${v}`).join(' ');


  console.log(
    `[CaptureDiag] ${source} | LIVE buf=${liveBuffers} tex=${liveTextures} | ` +
    `rates loop/s=${c.loopTicks} issue/s=${c.issueCalls} decode/s=${c.decodeCalls} | ` +
    `cum compiles=${c.pipelineCompiles} issued=${c.capturesIssued} resolved=${c.readbacksResolved} | ${gaugeStr}`,
  );

  // Reset per-second rate counters once per interval (shared clock so both
  // sources report the same window).
  if (now - ratesResetAt >= LOG_INTERVAL_MS) {
    ratesResetAt = now;
    c.loopTicks = 0;
    c.issueCalls = 0;
    c.decodeCalls = 0;
  }
}

/** One-off event log (not throttled) — for rare events like loop (re)starts. */
export function captureDiagEvent(message: string, data?: Record<string, unknown>): void {
  if (!captureDiagEnabled()) {
    return;
  }

  console.log(`[CaptureDiag] ${message}`, data ?? {});
}
