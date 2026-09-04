import { afterEach, describe, expect, it, vi } from "vitest";
import { WebGPURenderingEngine } from "../../webgpu/WebGPURenderingEngine";

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
     
    shouldWait: () => (engine as any).shouldWaitForGpu() as boolean,
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

  it("renders anyway rather than stalling on a completion that never arrives", () => {
    (globalThis as PerfGlobal).__gpuBackpressure = true;
    const { submit, shouldWait } = engineWithQueue();

    submit();
    submit();

    // A delayed callback costs latency, not a frozen preview.
    const skips = [shouldWait(), shouldWait(), shouldWait(), shouldWait()];
    expect(skips).toEqual([true, true, true, true]);
    expect(shouldWait()).toBe(false);
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
});
