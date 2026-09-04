import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeCanvas,
  FramePerfTracker,
  framePerfEnabled,
  logFramePerfInit,
} from "../../util/FramePerf";

type PerfGlobal = typeof globalThis & { __shaderPerf?: boolean };

function enable(): void {
  (globalThis as PerfGlobal).__shaderPerf = true;
}

/** The logger serializes its payload, so tests read it back out of the line. */
function parsePayload([line]: [string]): Record<string, number> {
  return JSON.parse(line.slice(line.indexOf("{"))) as Record<string, number>;
}

function record(tracker: FramePerfTracker, frames: number, frameMs = 5): void {
  for (let frame = 0; frame < frames; frame += 1) {
    tracker.record(frameMs, () => ({ fpsLimit: 60 }));
  }
}

describe("FramePerf", () => {
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    log.mockRestore();
    delete (globalThis as PerfGlobal).__shaderPerf;
  });

  it("stays silent until the flag is set", () => {
    expect(framePerfEnabled()).toBe(false);
    logFramePerfInit("webgl", { renderer: "test" });
    record(new FramePerfTracker("webgl"), 500);

    expect(log).not.toHaveBeenCalled();
  });

  it("logs initialization details once enabled", () => {
    enable();
    logFramePerfInit("webgpu", { isFallbackAdapter: true });

    expect(log).toHaveBeenCalledWith('[ShaderPerf] webgpu init {"isFallbackAdapter":true}');
  });

  it("reports once per window rather than once per frame", () => {
    enable();
    const tracker = new FramePerfTracker("webgl");

    record(tracker, 119);
    expect(log).not.toHaveBeenCalled();

    record(tracker, 1);
    expect(log).toHaveBeenCalledTimes(1);

    record(tracker, 120);
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("reports frame pacing so judder is visible behind a healthy average", () => {
    enable();
    const tracker = new FramePerfTracker("webgpu");
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);

    for (let frame = 0; frame < 120; frame += 1) {
      // Every tenth frame arrives late: the average frame rate stays high
      // while the motion visibly stutters.
      clock += frame % 10 === 0 ? 40 : 8;
      tracker.record(0.1, () => ({}));
    }

    const payload = parsePayload(log.mock.calls[0] as [string]);
    expect(payload.gapMsP50).toBe(8);
    expect(payload.gapMsMax).toBe(40);
    expect(payload.hitches).toBeGreaterThan(10);
    vi.mocked(performance.now).mockRestore();
  });

  it("counts no hitches when frames arrive evenly", () => {
    enable();
    const tracker = new FramePerfTracker("webgl");
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);

    for (let frame = 0; frame < 120; frame += 1) {
      clock += 8;
      tracker.record(0.1, () => ({}));
    }

    const payload = parsePayload(log.mock.calls[0] as [string]);
    expect(payload.hitches).toBe(0);
    expect(payload.gapMsP95).toBe(8);
    vi.mocked(performance.now).mockRestore();
  });

  it("includes heap size when the host exposes it", () => {
    enable();
    const memory = (performance as Performance & { memory?: unknown }).memory;
    Object.defineProperty(performance, "memory", {
      configurable: true,
      value: { usedJSHeapSize: 256 * 1024 * 1024 },
    });

    record(new FramePerfTracker("webgpu"), 120);

    expect(parsePayload(log.mock.calls[0] as [string]).heapMB).toBe(256);
    if (memory === undefined) {
      delete (performance as Performance & { memory?: unknown }).memory;
    } else {
      Object.defineProperty(performance, "memory", { configurable: true, value: memory });
    }
  });

  it("reports a null heap where the host does not expose one", () => {
    enable();
    record(new FramePerfTracker("webgl"), 120);

    expect(parsePayload(log.mock.calls[0] as [string]).heapMB).toBeNull();
  });

  it("summarises frame cost and includes caller context", () => {
    enable();
    const tracker = new FramePerfTracker("webgpu");

    for (let frame = 0; frame < 120; frame += 1) {
      tracker.record(frame === 119 ? 40 : 10, () => ({ fpsLimit: 30 }));
    }

    const payload = parsePayload(log.mock.calls[0] as [string]);
    expect(payload.cpuMsMax).toBe(40);
    expect(payload.cpuMsP50).toBe(10);
    expect(payload.cpuMsAvg).toBeCloseTo(10.25, 2);
    expect(payload.fps).toBeGreaterThan(0);
    expect(payload.fpsLimit).toBe(30);
  });

  it("numbers each engine instance so two live previews are distinguishable", () => {
    enable();
    const first = new FramePerfTracker("webgpu");
    const second = new FramePerfTracker("webgpu");

    record(first, 120);
    record(second, 120);

    const firstPayload = parsePayload(log.mock.calls[0] as [string]);
    const secondPayload = parsePayload(log.mock.calls[1] as [string]);
    expect(secondPayload.instance).toBe(firstPayload.instance! + 1);
  });

  it("drops buffered samples when the flag is turned off mid-run", () => {
    enable();
    const tracker = new FramePerfTracker("webgl");
    record(tracker, 119);

    delete (globalThis as PerfGlobal).__shaderPerf;
    record(tracker, 1);
    enable();
    record(tracker, 119);

    expect(log).not.toHaveBeenCalled();
  });

  it("describes the canvas backing store against its CSS size", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1920;
    canvas.height = 1080;

    expect(describeCanvas(canvas)).toMatchObject({
      backingWidth: 1920,
      backingHeight: 1080,
      backingPixels: 1920 * 1080,
    });
    expect(describeCanvas(null)).toEqual({ canvas: null });
  });
});
