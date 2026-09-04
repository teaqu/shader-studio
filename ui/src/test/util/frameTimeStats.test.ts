import { describe, expect, it } from "vitest";
import { computeFrameTimeStats } from "../../lib/util/frameTimeStats";

/** A window of steady frames with a few late ones mixed in. */
function windowWith(steady: number, late: number, lateCount: number, total = 100): number[] {
  return Array.from({ length: total }, (_, index) => (index < lateCount ? late : steady));
}

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
    const stats = computeFrameTimeStats(windowWith(13.6, 13.6, 0), 13.6);

    expect(stats.p50).toBeCloseTo(13.6, 5);
    expect(stats.p95).toBeCloseTo(13.6, 5);
    expect(stats.worst).toBeCloseTo(13.6, 5);
    expect(stats.lateFrames).toBe(0);
    expect(stats.latePercent).toBe(0);
  });

  it("counts frames that overran the refresh interval by half again", () => {
    // 27.2ms is two refreshes at 73.5Hz: the frame missed one.
    const stats = computeFrameTimeStats(windowWith(13.6, 27.2, 12), 13.6);

    expect(stats.lateFrames).toBe(12);
    expect(stats.latePercent).toBeCloseTo(12, 5);
    expect(stats.worst).toBeCloseTo(27.2, 5);
  });

  it("leaves a frame just under the threshold uncounted", () => {
    expect(computeFrameTimeStats(windowWith(13.6, 20.3, 5), 13.6).lateFrames).toBe(0);
    expect(computeFrameTimeStats(windowWith(13.6, 20.5, 5), 13.6).lateFrames).toBe(5);
  });

  it("keeps the tail visible when the average looks healthy", () => {
    // 95 fast frames and 5 slow ones average out; p95 and worst do not.
    const stats = computeFrameTimeStats(windowWith(8, 100, 5), 16.6);

    expect(stats.p50).toBe(8);
    expect(stats.p95).toBe(100);
    expect(stats.worst).toBe(100);
    expect(stats.lateFrames).toBe(5);
  });

  it("falls back to the window's median when no refresh rate is known", () => {
    const stats = computeFrameTimeStats(windowWith(10, 30, 4));

    expect(stats.p50).toBe(10);
    expect(stats.lateFrames).toBe(4);
  });

  it("reports no late frames when every sample is identical and unmeasured", () => {
    expect(computeFrameTimeStats([12, 12, 12]).lateFrames).toBe(0);
  });
});
