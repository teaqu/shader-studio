import { describe, expect, it } from "vitest";
import { DEFAULT_GPU_BACKPRESSURE, isPositiveInteger, resolveGpuBackpressure } from "./GpuBackpressure";
import type { MessageEvent } from "./MessageTypes";

describe("GPU backpressure settings", () => {
  it("exposes the live settings message in the public message contract", () => {
    const message: MessageEvent = { type: "gpuBackpressureSettings", defaults: { framesInFlight: 3, stallTimeoutMs: 500 } };
    expect(resolveGpuBackpressure(message.defaults)).toEqual({ framesInFlight: 3, stallTimeoutMs: 500 });
  });
  it("inherits each field independently without mutating defaults", () => {
    expect(resolveGpuBackpressure()).toEqual({ framesInFlight: 2, stallTimeoutMs: 2000 });
    expect(resolveGpuBackpressure({ framesInFlight: 4, stallTimeoutMs: 500 }, { framesInFlight: 1 }))
      .toEqual({ framesInFlight: 1, stallTimeoutMs: 500 });
    expect(resolveGpuBackpressure({ framesInFlight: 4 }, { stallTimeoutMs: 100 }))
      .toEqual({ framesInFlight: 4, stallTimeoutMs: 100 });
    expect(DEFAULT_GPU_BACKPRESSURE.framesInFlight).toBe(2);
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "2", null, undefined])("rejects invalid value %s and falls back", (value) => {
    expect(isPositiveInteger(value)).toBe(false);
    const invalid = { framesInFlight: value, stallTimeoutMs: value } as unknown as Parameters<typeof resolveGpuBackpressure>[0];
    expect(resolveGpuBackpressure(invalid, invalid)).toEqual(DEFAULT_GPU_BACKPRESSURE);
    expect(resolveGpuBackpressure({ framesInFlight: 3 }, invalid).framesInFlight).toBe(3);
  });
});
