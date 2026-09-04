import { describe, expect, it, vi } from "vitest";
import { WebGPURenderingEngine } from "../../webgpu/WebGPURenderingEngine";

/**
 * The render loop never waits for the GPU, so a backend that queues frames
 * faster than the hardware retires them still reports a healthy frame rate
 * while the picture falls behind. Submit-to-completion latency is what shows
 * that, and it is sampled one frame at a time so the measurement itself never
 * adds to the queue.
 */
function engineWithQueue(onSubmittedWorkDone: () => Promise<void>) {
  const engine = new WebGPURenderingEngine({ scriptUrl: "", wasmUrl: "" });
  const device = { queue: { onSubmittedWorkDone: vi.fn(onSubmittedWorkDone) } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reaching past the device bootstrap
  (engine as any).device = device;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- private probe under test
  return { engine, device, probe: () => (engine as any).probeGpuFrameTime() };
}

describe("WebGPURenderingEngine GPU frame time", () => {
  it("reports nothing before a frame has been submitted", () => {
    const { engine } = engineWithQueue(() => Promise.resolve());

    expect(engine.getGpuFrameTimeMs()).toBeNull();
  });

  it("records how long the GPU took to retire the submitted work", async () => {
    let resolveWork: () => void = () => {};
    const { engine, probe } = engineWithQueue(() => new Promise<void>((resolve) => {
      resolveWork = resolve;
    }));
    const now = vi.spyOn(performance, "now");
    now.mockReturnValue(1000);

    probe();
    now.mockReturnValue(1450);
    resolveWork();
    await Promise.resolve();
    await Promise.resolve();

    expect(engine.getGpuFrameTimeMs()).toBeCloseTo(450, 5);
    now.mockRestore();
  });

  it("keeps only one measurement in flight", () => {
    const { device, probe } = engineWithQueue(() => new Promise<void>(() => {}));

    probe();
    probe();
    probe();

    expect(device.queue.onSubmittedWorkDone).toHaveBeenCalledTimes(1);
  });

  it("samples again once the previous measurement completes", async () => {
    let resolveWork: () => void = () => {};
    const { device, probe } = engineWithQueue(() => new Promise<void>((resolve) => {
      resolveWork = resolve;
    }));

    probe();
    resolveWork();
    await Promise.resolve();
    await Promise.resolve();
    probe();

    expect(device.queue.onSubmittedWorkDone).toHaveBeenCalledTimes(2);
  });

  it("survives a backend that cannot report completion", () => {
    const engine = new WebGPURenderingEngine({ scriptUrl: "", wasmUrl: "" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- device without the capability
    (engine as any).device = { queue: {} };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- private probe under test
    expect(() => (engine as any).probeGpuFrameTime()).not.toThrow();
    expect(engine.getGpuFrameTimeMs()).toBeNull();
  });
});
