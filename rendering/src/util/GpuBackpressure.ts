/**
 * Whether an engine should hold frames back while the GPU is behind.
 *
 * Submitting work never blocks, so an animation-frame loop can queue far more
 * than the hardware retires: the loop reports a healthy frame rate while the
 * picture on screen is stale, and the queued backlog keeps the GPU saturated.
 * Capping frames in flight is the standard remedy — native renderers gate on
 * fences the same way, and GPU drivers expose the same idea as a limit on
 * frames rendered ahead.
 *
 * On by default. `window.__gpuBackpressure = false` restores the unpaced loop
 * for comparison; it is a diagnostic switch rather than a user setting, since
 * an unbounded queue trades latency for nothing.
 */
export function gpuBackpressureEnabled(): boolean {
  return (globalThis as typeof globalThis & { __gpuBackpressure?: boolean })
    .__gpuBackpressure !== false;
}

/** One frame executing, one queued: enough to keep the GPU busy, no more. */
export const MAX_FRAMES_IN_FLIGHT = 2;

/**
 * Rendering is never withheld for longer than this many real milliseconds.
 * This is an escape hatch for a completion signal that never arrives at all
 * (e.g. a lost context) — it must cost a little latency rather than freeze
 * the preview forever. It is deliberately generous: animation frames keep
 * firing at the display's refresh rate regardless of how long the GPU
 * actually takes, so a short bound would force frames through during
 * ordinary heavy load (large canvases, expensive passes) exactly when
 * backpressure is supposed to be holding them back.
 */
export const MAX_GPU_STALL_MS = 2000;
