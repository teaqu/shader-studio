import { describe, expect, it } from "vitest";
import { createRenderTimeline, MAX_CAPTURE_START_TIME, type RenderTimeline } from "../../lib/recording/renderTimeline";

const preparation = (timeline: RenderTimeline) =>
  Array.from({ length: timeline.preparationCount }, (_, index) => timeline.preparationStep(index));

describe("createRenderTimeline", () => {
  it("starts at frame zero without preparation or an invented delta", () => {
    const timeline = createRenderTimeline(0, 10);

    expect(preparation(timeline)).toEqual([]);
    expect(timeline.outputStep(0)).toEqual({ time: 0, frame: 0, delta: 0 });
    expect(timeline.outputStep(1)).toEqual({ time: 0.1, frame: 1, delta: 0.1 });
  });

  it("prepares exact-grid frames without rendering the capture boundary twice", () => {
    const timeline = createRenderTimeline(0.2, 10);

    expect(preparation(timeline)).toEqual([
      { time: 0, frame: 0, delta: 0 },
      { time: 0.1, frame: 1, delta: 0.1 },
    ]);
    expect(timeline.outputStep(0)).toEqual({ time: 0.2, frame: 2, delta: 0.1 });
  });

  it("uses a shorter final delta for an off-grid start", () => {
    const timeline = createRenderTimeline(0.25, 10);

    expect(preparation(timeline)).toEqual([
      { time: 0, frame: 0, delta: 0 },
      { time: 0.1, frame: 1, delta: 0.1 },
      { time: 0.2, frame: 2, delta: 0.1 },
    ]);
    expect(timeline.outputStep(0).time).toBe(0.25);
    expect(timeline.outputStep(0).frame).toBe(3);
    expect(timeline.outputStep(0).delta).toBeCloseTo(0.05);
    expect(timeline.outputStep(1)).toEqual({ time: 0.35, frame: 4, delta: 0.1 });
  });

  it("does not add an extra preparation frame for floating-point grid noise", () => {
    const timeline = createRenderTimeline(0.3, 10);

    expect(timeline.preparationCount).toBe(3);
    expect(timeline.outputStep(0).frame).toBe(3);
  });

  it.each([
    [-1, 30, "start time"],
    [Number.NaN, 30, "start time"],
    [0, 0, "frame rate"],
    [0, Number.POSITIVE_INFINITY, "frame rate"],
  ])("rejects invalid timeline input (%s, %s)", (startTime, fps, message) => {
    expect(() => createRenderTimeline(startTime as number, fps as number)).toThrow(message);
  });

  it("rejects invalid output indices", () => {
    const timeline = createRenderTimeline(0, 30);

    expect(() => timeline.outputStep(-1)).toThrow("frame index");
    expect(() => timeline.outputStep(0.5)).toThrow("frame index");
  });

  it("generates preparation steps on demand and rejects out-of-range indices", () => {
    const timeline = createRenderTimeline(600, 60);

    expect(timeline.preparationCount).toBe(36_000);
    expect(timeline.preparationStep(35_999)).toEqual({ time: 35_999 / 60, frame: 35_999, delta: 1 / 60 });
    expect(() => timeline.preparationStep(36_000)).toThrow("out of range");
  });

  it("rejects start times beyond the supported preparation limit", () => {
    expect(() => createRenderTimeline(MAX_CAPTURE_START_TIME + 1, 30)).toThrow(`${MAX_CAPTURE_START_TIME} s or less`);
  });
});
