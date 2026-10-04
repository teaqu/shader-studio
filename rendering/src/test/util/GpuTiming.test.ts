import { describe, expect, it, vi } from "vitest";
import {
  compileTimingLine,
  countQueueCallsOutsideRender,
  drainTimingLine,
  SLOW_DRAIN_MS,
  watchQueueDrain,
  readbackTimingLine,
  resolveLabel,
  SLOW_COMPILE_MS,
  SLOW_READBACK_MS,
  splitWait,
  type ReadbackTiming,
} from "../e2e/gpuTiming";

function readback(overrides: Partial<ReadbackTiming> = {}): ReadbackTiming {
  return {
    label: "wgsl/video.wgsl",
    language: "wgsl",
    requestId: 173,
    canvas: "64x64",
    renderMs: 2.4,
    untilMappingMs: 0.6,
    mappingMs: 4.2,
    totalMs: 7.2,
    finalStage: "completed",
    ...overrides,
  };
}

function parse(line: string | null): Record<string, unknown> {
  expect(line).toMatch(/^\[gpu-timing\] /);
  return JSON.parse(line!.slice("[gpu-timing] ".length)) as Record<string, unknown>;
}

describe("splitWait", () => {
  it("splits the wait at the moment the request entered mapping", () => {
    expect(splitWait(100, 130, null, 1130)).toEqual({ untilMappingMs: 30, mappingMs: 1000 });
  });

  it("reports both halves as unknown when mapping was never observed", () => {
    expect(splitWait(100, null, null, 5100)).toEqual({ untilMappingMs: null, mappingMs: null });
  });

  it("counts a request already mapping when render returned as zero wait before mapping", () => {
    expect(splitWait(100, 100, null, 150)).toEqual({ untilMappingMs: 0, mappingMs: 50 });
  });

  it("times a failed mapping only until it left the mapping stage", () => {
    expect(splitWait(100, 101, 104, 5100)).toEqual({ untilMappingMs: 1, mappingMs: 3 });
  });
});

describe("readbackTimingLine", () => {
  it("stays quiet for a healthy readback", () => {
    expect(readbackTimingLine(readback())).toBeNull();
  });

  it("stays quiet just under the threshold", () => {
    expect(readbackTimingLine(readback({ totalMs: SLOW_READBACK_MS - 0.1 }))).toBeNull();
  });

  it("reports a readback at the threshold with every phase, rounded", () => {
    expect(parse(readbackTimingLine(readback({
      renderMs: 12.6,
      untilMappingMs: 0.4,
      mappingMs: 987.5,
      totalMs: SLOW_READBACK_MS,
    })))).toEqual({
      kind: "readback",
      label: "wgsl/video.wgsl",
      language: "wgsl",
      requestId: 173,
      canvas: "64x64",
      renderMs: 13,
      untilMappingMs: 0,
      mappingMs: 988,
      totalMs: 1000,
      finalStage: "completed",
    });
  });

  it("reports a readback that never completed, however short", () => {
    const fields = parse(readbackTimingLine(readback({
      untilMappingMs: null,
      mappingMs: null,
      totalMs: 3,
      finalStage: "queued",
    })));
    expect(fields).toMatchObject({ finalStage: "queued", untilMappingMs: null, mappingMs: null, totalMs: 3 });
  });

  it("honours a custom threshold", () => {
    expect(readbackTimingLine(readback({ totalMs: 50 }), 40)).not.toBeNull();
    expect(readbackTimingLine(readback({ totalMs: 50 }), 60)).toBeNull();
  });
});

describe("compileTimingLine", () => {
  it("stays quiet below the threshold", () => {
    expect(compileTimingLine({ label: "slang/flow.slang", language: "slang", compileMs: SLOW_COMPILE_MS - 1 })).toBeNull();
  });

  it("reports a compile at the threshold, rounded", () => {
    expect(parse(compileTimingLine({ label: "slang/flow.slang", language: "slang", compileMs: SLOW_COMPILE_MS + 0.4 }))).toEqual({
      kind: "compile",
      label: "slang/flow.slang",
      language: "slang",
      compileMs: SLOW_COMPILE_MS,
    });
  });

  it("honours a custom threshold", () => {
    expect(compileTimingLine({ label: "x", language: "glsl", compileMs: 20 }, 10)).not.toBeNull();
  });

  it("names the timed phase when a compile is split", () => {
    expect(parse(compileTimingLine({
      label: "wgsl/gravity/gravity.wgsl",
      language: "wgsl",
      phase: "pipeline",
      compileMs: 28_054.4,
    }))).toEqual({
      kind: "compile",
      label: "wgsl/gravity/gravity.wgsl",
      language: "wgsl",
      phase: "pipeline",
      compileMs: 28_054,
    });
  });

  it("leaves the phase out when none is given", () => {
    expect(parse(compileTimingLine({ label: "x", language: "glsl", compileMs: SLOW_COMPILE_MS }))).not.toHaveProperty("phase");
  });
});

describe("resolveLabel", () => {
  it("prefers the label a test set explicitly", () => {
    expect(resolveLabel("wgsl/video.wgsl", "Shader switch e2e > recovers")).toBe("wgsl/video.wgsl");
  });

  it("falls back to the running test's name", () => {
    expect(resolveLabel(null, "Shader switch e2e > recovers")).toBe("Shader switch e2e > recovers");
  });

  it("says so when there is neither", () => {
    expect(resolveLabel(null, undefined)).toBe("(unlabelled)");
  });
});

describe("drainTimingLine", () => {
  it("stays quiet for an idle queue", () => {
    expect(drainTimingLine({ label: "x", language: "wgsl", drainMs: SLOW_DRAIN_MS - 1 })).toBeNull();
  });

  it("reports pending work at the threshold, rounded", () => {
    expect(parse(drainTimingLine({ label: "wgsl/gravity/gravity.wgsl", language: "wgsl", drainMs: 2_850.6 }))).toEqual({
      kind: "drain",
      label: "wgsl/gravity/gravity.wgsl",
      language: "wgsl",
      drainMs: 2_851,
    });
  });

  it("honours a custom threshold", () => {
    expect(drainTimingLine({ label: "x", language: "slang", drainMs: 20 }, 10)).not.toBeNull();
  });

  it("reports frames nobody requested even when the drain was fast", () => {
    expect(parse(drainTimingLine({
      label: "wgsl/intellisense_compute.wgsl",
      language: "wgsl",
      drainMs: 3,
      loopRunning: true,
      unrequestedFrames: 42,
    }))).toEqual({
      kind: "drain",
      label: "wgsl/intellisense_compute.wgsl",
      language: "wgsl",
      drainMs: 3,
      loopRunning: true,
      unrequestedFrames: 42,
    });
  });

  it("stays quiet for a fast drain with no unrequested frames", () => {
    expect(drainTimingLine({ label: "x", language: "wgsl", drainMs: 3, loopRunning: false, unrequestedFrames: 0 })).toBeNull();
  });

  it("keeps a WebGL loop state it cannot read as null", () => {
    expect(parse(drainTimingLine({ label: "x", language: "glsl", drainMs: SLOW_DRAIN_MS, loopRunning: null, unrequestedFrames: 0 })))
      .toMatchObject({ loopRunning: null, unrequestedFrames: 0 });
  });

  it("lists the queue calls made outside render", () => {
    expect(parse(drainTimingLine({
      label: "wgsl/compute-lab/channel-cover.wgsl",
      language: "wgsl",
      drainMs: 4_482,
      loopRunning: false,
      unrequestedFrames: 0,
      outsideRender: { copyExternalImageToTexture: 1, submit: 2 },
    }))).toMatchObject({ outsideRender: { copyExternalImageToTexture: 1, submit: 2 } });
  });

  it("leaves out an empty outside-render count", () => {
    expect(parse(drainTimingLine({ label: "x", language: "wgsl", drainMs: SLOW_DRAIN_MS, outsideRender: {} })))
      .not.toHaveProperty("outsideRender");
  });

  it("leaves out loop fields that were not measured", () => {
    const fields = parse(drainTimingLine({ label: "x", language: "wgsl", drainMs: SLOW_DRAIN_MS }));
    expect(fields).not.toHaveProperty("loopRunning");
    expect(fields).not.toHaveProperty("unrequestedFrames");
  });
});

describe("watchQueueDrain", () => {
  function clock(...times: number[]): () => number {
    return () => times.shift() ?? Number.NaN;
  }

  it("reports how long the queue took to finish, without the caller waiting", async () => {
    let finish!: () => void;
    const queue = {
      onSubmittedWorkDone: () => new Promise<void>((resolve) => {
        finish = resolve;
      }),
    };
    const report = vi.fn();
    watchQueueDrain(queue, report, clock(100, 2_600));
    expect(report).not.toHaveBeenCalled();
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(report).toHaveBeenCalledWith(2_500);
  });

  it("calls onSubmittedWorkDone on the queue itself", async () => {
    const queue = {
      done: false,
      onSubmittedWorkDone(this: { done: boolean }) {
        this.done = true;
        return Promise.resolve();
      },
    };
    watchQueueDrain(queue, () => {}, clock(0, 1));
    expect(queue.done).toBe(true);
  });

  it("reports nothing without a queue or without onSubmittedWorkDone", () => {
    const report = vi.fn();
    watchQueueDrain(null, report);
    watchQueueDrain(undefined, report);
    watchQueueDrain({}, report);
    expect(report).not.toHaveBeenCalled();
  });

  it("reports nothing when the drain rejects or throws", async () => {
    const report = vi.fn();
    watchQueueDrain({ onSubmittedWorkDone: () => Promise.reject(new Error("device lost")) }, report, clock(0, 1));
    watchQueueDrain({ onSubmittedWorkDone: () => {
      throw new Error("destroyed");
    } }, report, clock(0, 1));
    await Promise.resolve();
    await Promise.resolve();
    expect(report).not.toHaveBeenCalled();
  });
});

describe("countQueueCallsOutsideRender", () => {
  function fakeQueue() {
    const calls: unknown[][] = [];
    const queue: Record<string, unknown> = {
      tag: "queue",
      submit(this: { tag: string }, ...args: unknown[]) {
        calls.push([this.tag, "submit", ...args]);
        return "submitted";
      },
      writeBuffer(this: { tag: string }, ...args: unknown[]) {
        calls.push([this.tag, "writeBuffer", ...args]);
      },
      onSubmittedWorkDone: () => Promise.resolve(),
    };
    return { queue, calls };
  }

  it("counts calls made outside render and forwards every call unchanged", () => {
    const { queue, calls } = fakeQueue();
    let inRender = false;
    const counter = countQueueCallsOutsideRender(queue, () => inRender);
    expect((queue.submit as (...a: unknown[]) => unknown)(["cmd"])).toBe("submitted");
    (queue.writeBuffer as (...a: unknown[]) => unknown)("buf", 0);
    inRender = true;
    (queue.submit as (...a: unknown[]) => unknown)(["frame"]);
    expect(counter.take()).toEqual({ submit: 1, writeBuffer: 1 });
    expect(calls).toEqual([
      ["queue", "submit", ["cmd"]],
      ["queue", "writeBuffer", "buf", 0],
      ["queue", "submit", ["frame"]],
    ]);
  });

  it("resets the counts on every take", () => {
    const { queue } = fakeQueue();
    const counter = countQueueCallsOutsideRender(queue, () => false);
    (queue.submit as () => unknown)();
    expect(counter.take()).toEqual({ submit: 1 });
    expect(counter.take()).toEqual({});
  });

  it("leaves methods the queue does not have alone", () => {
    const { queue } = fakeQueue();
    countQueueCallsOutsideRender(queue, () => false);
    expect(queue).not.toHaveProperty("writeTexture");
    expect(queue).not.toHaveProperty("copyExternalImageToTexture");
  });
});
