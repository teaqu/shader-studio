export interface FrameTimeStats {
  /** Typical frame time across the sampled window. */
  p50: number;
  /** The slow tail: what a stutter shows up in first. */
  p95: number;
  worst: number;
  /** Frames that overran the display's refresh by a whole interval or more. */
  lateFrames: number;
  latePercent: number;
}

const EMPTY: FrameTimeStats = { p50: 0, p95: 0, worst: 0, lateFrames: 0, latePercent: 0 };

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}

/**
 * Summarises a window of frame times.
 *
 * An average frame rate stays healthy while frames arrive unevenly, which is
 * what a viewer perceives as stuttering — so the tail and the count of late
 * frames say more about smoothness than the mean the graph already draws.
 *
 * Lateness is measured against the window's own median rather than against a
 * target rate: a shader running steadily at 30fps is smooth, however far below
 * the refresh rate it sits, while the same shader dropping the occasional
 * frame is not. A frame counts as late once it overruns that median by a whole
 * refresh interval, meaning the previous image was held on screen an extra
 * refresh. Without a detected refresh rate, half the median stands in for it.
 */
export function computeFrameTimeStats(samples: number[], refreshMs = 0): FrameTimeStats {
  if (samples.length === 0) {
    return EMPTY;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const p50 = percentile(sorted, 0.5);
  const overrun = refreshMs > 0 ? refreshMs : p50 * 0.5;
  const lateThreshold = p50 + overrun;
  const lateFrames = sorted.filter((sample) => sample > lateThreshold).length;

  return {
    p50,
    p95: percentile(sorted, 0.95),
    worst: sorted[sorted.length - 1]!,
    lateFrames,
    latePercent: (lateFrames / sorted.length) * 100,
  };
}
