import { describe, expect, it } from "vitest";
import { computeFrameTimeStats } from "../../lib/util/frameTimeStats";

/** A window of steady frames with a few late ones mixed in. */
function windowWith(steady: number, late: number, lateCount: number, total = 100): number[] {
  return Array.from({ length: total }, (_, index) => (index < lateCount ? late : steady));
}

const REFRESH_73HZ = 13.6;

describe("computeFrameTimeStats", () => {
  it("returns zeroes for an empty window", () => {
    expect(computeFrameTimeStats([])).toEqual({
      p50: 0,
      p95: 0,
      worst: 0,
      lateFrames: 0,
      latePercent: 0,
    });
  });

  it("summarises a steady window as having no late frames", () => {
    const stats = computeFrameTimeStats(windowWith(13.6, 13.6, 0), REFRESH_73HZ);

    expect(stats.p50).toBeCloseTo(13.6, 5);
    expect(stats.p95).toBeCloseTo(13.6, 5);
    expect(stats.worst).toBeCloseTo(13.6, 5);
    expect(stats.lateFrames).toBe(0);
    expect(stats.latePercent).toBe(0);
  });

  it("counts frames that overran the cadence by a whole refresh", () => {
    // 27.2ms is two refreshes at 73.5Hz: the frame missed one.
    const stats = computeFrameTimeStats(windowWith(13.6, 27.3, 12), REFRESH_73HZ);

    expect(stats.lateFrames).toBe(12);
    expect(stats.latePercent).toBeCloseTo(12, 5);
    expect(stats.worst).toBeCloseTo(27.3, 5);
  });

  it("counts nothing late in a steady window far below the refresh rate", () => {
    // A shader pinned at 30fps on a 73.5Hz display: every frame is longer than
    // a refresh, yet delivery is even and looks smooth.
    const stats = computeFrameTimeStats(windowWith(33.3, 33.3, 0), REFRESH_73HZ);

    expect(stats.lateFrames).toBe(0);
    expect(stats.latePercent).toBe(0);
  });

  it("still catches hitches in a slow but otherwise steady window", () => {
    expect(computeFrameTimeStats(windowWith(33.3, 60, 3), REFRESH_73HZ).lateFrames).toBe(3);
  });

  it("judges lateness by the window's own cadence, not by a target rate", () => {
    // The same eight hitches, at two very different frame rates.
    const fast = computeFrameTimeStats(windowWith(13.6, 30, 8), REFRESH_73HZ);
    const slow = computeFrameTimeStats(windowWith(27.2, 44, 8), REFRESH_73HZ);

    expect(fast.lateFrames).toBe(8);
    expect(slow.lateFrames).toBe(8);
  });

  it("leaves a frame just under the threshold uncounted", () => {
    expect(computeFrameTimeStats(windowWith(13.6, 27.1, 5), REFRESH_73HZ).lateFrames).toBe(0);
    expect(computeFrameTimeStats(windowWith(13.6, 27.3, 5), REFRESH_73HZ).lateFrames).toBe(5);
  });

  it("keeps the tail visible when the average looks healthy", () => {
    // 95 fast frames and 5 slow ones average out; p95 and worst do not.
    const stats = computeFrameTimeStats(windowWith(8, 100, 5), 16.6);

    expect(stats.p50).toBe(8);
    expect(stats.p95).toBe(100);
    expect(stats.worst).toBe(100);
    expect(stats.lateFrames).toBe(5);
  });

  it("falls back to half the median when no refresh rate is known", () => {
    const stats = computeFrameTimeStats(windowWith(10, 30, 4));

    expect(stats.p50).toBe(10);
    expect(stats.lateFrames).toBe(4);
  });

  it("reports no late frames when every sample is identical and unmeasured", () => {
    expect(computeFrameTimeStats([12, 12, 12]).lateFrames).toBe(0);
  });
});
