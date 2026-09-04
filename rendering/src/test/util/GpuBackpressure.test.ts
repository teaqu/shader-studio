import { afterEach, describe, expect, it } from "vitest";
import {
  gpuBackpressureEnabled,
  MAX_CONSECUTIVE_GPU_SKIPS,
  MAX_FRAMES_IN_FLIGHT,
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
    expect(MAX_CONSECUTIVE_GPU_SKIPS).toBeGreaterThan(0);
  });
});
