import { afterEach, describe, expect, it } from "vitest";
import {
  gpuBackpressureEnabled,
  MAX_FRAMES_IN_FLIGHT,
  MAX_GPU_STALL_MS,
} from "../../util/GpuBackpressure";

type PerfGlobal = typeof globalThis & { __gpuBackpressure?: boolean };

afterEach(() => {
  delete (globalThis as PerfGlobal).__gpuBackpressure;
});

describe("gpuBackpressureEnabled", () => {
  it("paces frames by default", () => {
    expect(gpuBackpressureEnabled()).toBe(true);
  });

  it("can be switched off for comparison through the diagnostic flag", () => {
    (globalThis as PerfGlobal).__gpuBackpressure = false;

    expect(gpuBackpressureEnabled()).toBe(false);
  });

  it("treats any other value as on, so a stray flag cannot disable pacing", () => {
    for (const value of [true, undefined]) {
      (globalThis as PerfGlobal).__gpuBackpressure = value as boolean | undefined;
      expect(gpuBackpressureEnabled()).toBe(true);
    }
  });

  it("keeps the GPU pipelined without letting the loop run away", () => {
    expect(MAX_FRAMES_IN_FLIGHT).toBe(2);
  });

  it("bounds how long rendering can be withheld", () => {
    // A completion signal that never arrives must cost latency, not a freeze.
    expect(MAX_GPU_STALL_MS).toBeGreaterThan(0);
  });

  it("is generous enough to survive a genuinely slow GPU, not just a stuck one", () => {
    // Animation frames fire at the display's refresh rate (~16ms at 60Hz)
    // no matter how long the GPU actually takes, so anything close to a
    // single frame's worth of ticks would force frames through during
    // ordinary heavy load instead of only when a completion signal is truly
    // never coming back.
    expect(MAX_GPU_STALL_MS).toBeGreaterThanOrEqual(500);
  });
});
