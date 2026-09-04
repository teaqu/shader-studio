import { describe, it, expect, beforeEach } from "vitest";
import { FPSCalculator } from "../../util/FPSCalculator";

describe('FPSCalculator', () => {
  let fpsCalculator: FPSCalculator;

  beforeEach(() => {
    fpsCalculator = new FPSCalculator(30, 5);
  });

  it('should initialize with default values', () => {
    expect(fpsCalculator.getFPS()).toBe(0); // Initial FPS is 0, not 60
    expect(fpsCalculator.getRawFPS()).toBe(0);
  });

  it('should handle first frame correctly', () => {
    const result = fpsCalculator.updateFrame(100);
    expect(result).toBe(false);
    expect(fpsCalculator.getFPS()).toBe(60);
  });

  it('should calculate FPS from frame times', () => {
    fpsCalculator.updateFrame(0);

    // Simulate 60 FPS (16.67ms per frame)
    for (let i = 1; i <= 10; i++) {
      fpsCalculator.updateFrame(i * 16.67);
    }

    expect(fpsCalculator.getFPS()).toBeCloseTo(60, 0);
  });

  it('should calculate FPS for different frame rates', () => {
    fpsCalculator.updateFrame(0);

    // Simulate 30 FPS (33.33ms per frame)
    for (let i = 1; i <= 10; i++) {
      fpsCalculator.updateFrame(i * 33.33);
    }

    expect(fpsCalculator.getFPS()).toBeCloseTo(30, 0);
  });

  it('should ignore only degenerate (zero or negative) frame times', () => {
    fpsCalculator.updateFrame(0);

    // Add enough valid frames to reach minimum
    for (let i = 1; i <= 6; i++) {
      fpsCalculator.updateFrame(i * 16.67);
    }

    const fpsBeforeInvalid = fpsCalculator.getFPS();

    // A duplicate timestamp (zero delta) is degenerate, not a real frame.
    fpsCalculator.updateFrame(6 * 16.67);
    expect(fpsCalculator.getFPS()).toBe(fpsBeforeInvalid); // FPS should not change

    // Add another valid frame
    fpsCalculator.updateFrame(6 * 16.67 + 16.67);
    // FPS should still be reasonable
    expect(fpsCalculator.getFPS()).toBeGreaterThan(0);
  });

  it('reflects a sustained slow (sub-10fps) frame rate rather than freezing at the last fast reading', () => {
    // A shader on a huge canvas can legitimately take hundreds of ms per
    // frame. That must show up as a low fps, not get silently discarded as
    // "invalid" and leave the display stuck reporting a healthy rate.
    fpsCalculator.updateFrame(0);

    // A brief fast run first, so there is a "before" reading to diverge from.
    for (let i = 1; i <= 10; i++) {
      fpsCalculator.updateFrame(i * 16.67);
    }
    expect(fpsCalculator.getFPS()).toBeCloseTo(60, 0);

    // Then a sustained slowdown: real ~5fps (200ms/frame), well past the
    // old 100ms cutoff, for enough frames to fill the averaging window.
    let time = 10 * 16.67;
    for (let i = 1; i <= 30; i++) {
      time += 200;
      fpsCalculator.updateFrame(time);
    }

    expect(fpsCalculator.getFPS()).toBeCloseTo(5, 0);
  });

  it('should reset correctly', () => {
    fpsCalculator.updateFrame(0);
    for (let i = 1; i <= 10; i++) {
      fpsCalculator.updateFrame(i * 16.67);
    }

    expect(fpsCalculator.getFPS()).toBeCloseTo(60, 0);

    fpsCalculator.reset();

    expect(fpsCalculator.getFPS()).toBe(60);
  });

  it('should return rounded vs raw FPS correctly', () => {
    fpsCalculator.updateFrame(0);

    // Simulate slightly irregular timing that would result in non-integer FPS
    const frameTimes = [16.1, 16.8, 16.5, 16.9, 16.3];
    let time = 0;

    frameTimes.forEach(frameTime => {
      time += frameTime;
      fpsCalculator.updateFrame(time);
    });

    const rawFPS = fpsCalculator.getRawFPS();
    const roundedFPS = fpsCalculator.getFPS(true);
    const unroundedFPS = fpsCalculator.getFPS(false);

    expect(roundedFPS).toBe(Math.round(rawFPS));
    expect(unroundedFPS).toBe(rawFPS);
  });

  it('should handle high frame rates', () => {
    fpsCalculator.updateFrame(0);

    // Simulate 120 FPS (8.33ms per frame)
    for (let i = 1; i <= 10; i++) {
      fpsCalculator.updateFrame(i * 8.33);
    }

    expect(fpsCalculator.getFPS()).toBeCloseTo(120, 0);
  });

  it('should maintain isolation between multiple instances', () => {
    // This test ensures our FPSCalculator doesn't have the global state issue
    // that piWebUtils FPS counter has

    const calculator1 = new FPSCalculator(30, 5);
    const calculator2 = new FPSCalculator(30, 5);

    calculator1.updateFrame(0);
    calculator2.updateFrame(0);

    let time1 = 0;
    for (let i = 1; i <= 10; i++) {
      time1 += 16.67; // 60 FPS
      calculator1.updateFrame(time1);
    }

    let time2 = 0;
    for (let i = 1; i <= 10; i++) {
      time2 += 33.33; // 30 FPS
      calculator2.updateFrame(time2);
    }

    expect(calculator1.getFPS()).toBeCloseTo(60, 0);
    expect(calculator2.getFPS()).toBeCloseTo(30, 0);

    calculator1.reset();

    expect(calculator1.getFPS()).toBe(60); // Reset to default

    expect(calculator2.getFPS()).toBeCloseTo(30, 0);
  });
});
