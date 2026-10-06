import { afterEach, describe, expect, it, vi } from "vitest";
import type { RenderingEngine } from "../../types/RenderingEngine";
import type { PixelRegionResult } from "../../types/PixelRegion";
import { waitForPixelRegion } from "../e2e/ShaderCanvasHarness";

describe("canvas readback deadline", () => {
  afterEach(() => vi.restoreAllMocks());

  function delayedClock(): void {
    // Another task can block the main thread while the GPU completes the copy.
    // The timer resumes after the deadline, before a second collection occurs.
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(6_000);
  }

  it("collects a completed request when the event loop resumes past the deadline", async () => {
    const result: PixelRegionResult = {
      requestId: 23, centerX: 0, centerY: 0,
      width: 60, height: 60, rgba: new Uint8ClampedArray(60 * 60 * 4),
    };
    const collectPixelRegionResults = vi.fn()
      .mockReturnValueOnce([])
      .mockReturnValueOnce([result]);
    const engine = { collectPixelRegionResults } as unknown as RenderingEngine;
    delayedClock();

    await expect(waitForPixelRegion(engine, 23)).resolves.toBe(result);
    expect(collectPixelRegionResults).toHaveBeenCalledTimes(2);
  });

  it("still rejects an unfinished request immediately after the deadline", async () => {
    const collectPixelRegionResults = vi.fn().mockReturnValue([]);
    const engine = { collectPixelRegionResults } as unknown as RenderingEngine;
    delayedClock();

    await expect(waitForPixelRegion(engine, 23)).rejects.toThrow(/request 23.*after 6000ms/);
    expect(collectPixelRegionResults).toHaveBeenCalledTimes(2);
  });

  it("does not mistake another completed request for the one that timed out", async () => {
    const collectPixelRegionResults = vi.fn()
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ requestId: 24 }]);
    const engine = { collectPixelRegionResults } as unknown as RenderingEngine;
    delayedClock();

    await expect(waitForPixelRegion(engine, 23)).rejects.toThrow(/request 23.*after 6000ms/);
    expect(collectPixelRegionResults).toHaveBeenCalledTimes(2);
  });

  it("returns an already collected result without waiting for the deadline", async () => {
    const result = { requestId: 23 };
    const collectPixelRegionResults = vi.fn().mockReturnValue([result]);
    const engine = { collectPixelRegionResults } as unknown as RenderingEngine;
    delayedClock();

    await expect(waitForPixelRegion(engine, 23)).resolves.toBe(result);
    expect(collectPixelRegionResults).toHaveBeenCalledOnce();
  });

  it("preserves a readback error from the final collection", async () => {
    const error = new Error("driver readback failed");
    const collectPixelRegionResults = vi.fn()
      .mockReturnValueOnce([])
      .mockImplementationOnce(() => {
        throw error;
      });
    const engine = { collectPixelRegionResults } as unknown as RenderingEngine;
    delayedClock();

    await expect(waitForPixelRegion(engine, 23)).rejects.toBe(error);
    expect(collectPixelRegionResults).toHaveBeenCalledTimes(2);
  });
});
