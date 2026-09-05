import { afterEach, describe, expect, it, vi } from "vitest";
import { WebGPURenderingEngine } from "../../webgpu/WebGPURenderingEngine";
import { MAX_GPU_STALL_MS } from "../../util/GpuBackpressure";

/**
 * `queue.submit()` returns immediately, so an animation-frame loop can queue
 * far more work than the GPU retires — the loop reports a healthy rate while
 * the picture on screen is stale. Holding frames back bounds that, but must
 * never withhold a frame someone explicitly asked for, and must not turn a
 * delayed completion callback into a frozen preview.
 */
type PerfGlobal = typeof globalThis & { __gpuBackpressure?: boolean };

function engineWithQueue() {
  const engine = new WebGPURenderingEngine({ scriptUrl: "", wasmUrl: "" });
  const releases: Array<() => void> = [];
  const device = {
    queue: {
      onSubmittedWorkDone: vi.fn(() => new Promise<void>((resolve) => {
        releases.push(resolve);
      })),
    },
  };
   
  (engine as any).device = device;
   
  (engine as any).running = true;
  return {
    engine,
     
    submit: () => (engine as any).trackFrameInFlight(),

    shouldWait: (time = 0) => (engine as any).shouldWaitForGpu(time) as boolean,
    async completeOne() {
      releases.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

afterEach(() => {
  delete (globalThis as PerfGlobal).__gpuBackpressure;
});

describe("WebGPURenderingEngine GPU backpressure", () => {
  it("never withholds a frame while it is switched off", () => {
    (globalThis as PerfGlobal).__gpuBackpressure = false;
    const { submit, shouldWait } = engineWithQueue();

    submit();
    submit();
    submit();

    expect(shouldWait()).toBe(false);
  });

  it("keeps the GPU pipelined rather than serialised", () => {
    (globalThis as PerfGlobal).__gpuBackpressure = true;
    const { submit, shouldWait } = engineWithQueue();

    expect(shouldWait()).toBe(false);
    submit();
    // One frame outstanding still leaves room to queue the next.
    expect(shouldWait()).toBe(false);
  });

  it("holds frames back once the GPU is behind", () => {
    (globalThis as PerfGlobal).__gpuBackpressure = true;
    const { submit, shouldWait } = engineWithQueue();

    submit();
    submit();

    expect(shouldWait()).toBe(true);
  });

  it("resumes as soon as the GPU retires a frame", async () => {
    (globalThis as PerfGlobal).__gpuBackpressure = true;
    const { submit, shouldWait, completeOne } = engineWithQueue();

    submit();
    submit();
    expect(shouldWait()).toBe(true);

    await completeOne();

    expect(shouldWait()).toBe(false);
  });

  it("renders anyway once a completion that never arrives has cost enough real time", () => {
    (globalThis as PerfGlobal).__gpuBackpressure = true;
    const { submit, shouldWait } = engineWithQueue();

    submit();
    submit();

    // A delayed callback costs latency, not a frozen preview — but only
    // after real time, not just tick count, has actually passed.
    expect(shouldWait(0)).toBe(true);
    expect(shouldWait(MAX_GPU_STALL_MS - 1)).toBe(true);
    expect(shouldWait(MAX_GPU_STALL_MS)).toBe(false);
  });

  it("keeps holding a genuinely slow (not stuck) GPU back across many ticks, so measured fps reflects it", () => {
    // Animation frames fire at the display's refresh rate regardless of how
    // long the GPU actually takes to retire work, since queue.submit()
    // never blocks. A large canvas can legitimately take far longer than a
    // single frame to finish — that must still be paced, not forced through
    // just because many rAF ticks went by while it was still working.
    (globalThis as PerfGlobal).__gpuBackpressure = true;
    const { submit, shouldWait } = engineWithQueue();

    submit();
    submit();

    const tickIntervalMs = 16;
    const ticksWithinStallBudget = Math.floor(MAX_GPU_STALL_MS / tickIntervalMs) - 1;
    for (let i = 1; i <= ticksWithinStallBudget; i++) {
      expect(shouldWait(i * tickIntervalMs)).toBe(true);
    }
  });

  it("paces only the engine's own loop, never an explicit render", () => {
    (globalThis as PerfGlobal).__gpuBackpressure = true;
    const { engine, submit, shouldWait } = engineWithQueue();
    submit();
    submit();
     
    (engine as any).running = false;

    expect(shouldWait()).toBe(false);
  });

  it("counts nothing while switched off, so enabling it starts clean", () => {
    (globalThis as PerfGlobal).__gpuBackpressure = false;
    const { engine, submit } = engineWithQueue();

    submit();
    submit();


    expect((engine as any).framesInFlight).toBe(0);
  });

  it("does not leak a counted frame when the completion signal throws synchronously", () => {
    // A lost device can make onSubmittedWorkDone() throw instead of
    // rejecting. That must not permanently inflate framesInFlight and wedge
    // the loop into pacing forever.
    (globalThis as PerfGlobal).__gpuBackpressure = true;
    const engine = new WebGPURenderingEngine({ scriptUrl: "", wasmUrl: "" });
    const device = {
      queue: {
        onSubmittedWorkDone: vi.fn(() => {
          throw new Error("device lost");
        }),
      },
    };

    (engine as any).device = device;

    (engine as any).running = true;


    (engine as any).trackFrameInFlight();

    (engine as any).trackFrameInFlight();


    expect((engine as any).framesInFlight).toBe(0);

    expect((engine as any).shouldWaitForGpu(0)).toBe(false);
  });
});
