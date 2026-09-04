import { describe, expect, it, vi } from "vitest";
import { RenderingEngine } from "../../webgl/RenderingEngine";

/**
 * The render loop never waits for the GPU, so submit-to-completion latency is
 * what exposes work queueing up behind it. WebGL2 reports that through a
 * fence polled with a zero timeout, which must never stall the frame it is
 * measuring.
 */
const SIGNALED = 0x911a;
const TIMEOUT_EXPIRED = 0x911b;
const WAIT_FAILED = 0x911d;

function engineWithGl(clientWaitSync: () => number) {
  const engine = new RenderingEngine();
  const gl = {
    ALREADY_SIGNALED: SIGNALED,
    CONDITION_SATISFIED: 0x911c,
    WAIT_FAILED,
    SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
    fenceSync: vi.fn(() => ({}) as WebGLSync),
    clientWaitSync: vi.fn(clientWaitSync),
    deleteSync: vi.fn(),
    flush: vi.fn(),
  };
   
  (engine as any).gl = gl;
  engine.setGpuTimingEnabled(true);
   
  return { engine, gl, probe: () => (engine as any).probeGpuFrameTime() };
}

describe("RenderingEngine GPU frame time", () => {
  it("reports nothing before a frame has been fenced", () => {
    const { engine } = engineWithGl(() => SIGNALED);

    expect(engine.getGpuFrameTimeMs()).toBeNull();
  });

  it("records the wait once the GPU reaches the fence", () => {
    const { engine, probe } = engineWithGl(() => SIGNALED);
    const now = vi.spyOn(performance, "now");

    now.mockReturnValue(1000);
    probe();
    now.mockReturnValue(1120);
    probe();

    expect(engine.getGpuFrameTimeMs()).toBeCloseTo(120, 5);
    now.mockRestore();
  });

  it("polls without blocking", () => {
    const { gl, probe } = engineWithGl(() => SIGNALED);

    probe();
    probe();

    // A zero timeout only asks whether the GPU has arrived.
    expect(gl.clientWaitSync).toHaveBeenCalledWith(expect.anything(), 0, 0);
  });

  it("keeps waiting on a frame the GPU has not finished", () => {
    const { engine, gl, probe } = engineWithGl(() => TIMEOUT_EXPIRED);

    probe();
    probe();
    probe();

    expect(engine.getGpuFrameTimeMs()).toBeNull();
    // One fence in flight: a slow frame is measured in full, not re-fenced.
    expect(gl.fenceSync).toHaveBeenCalledTimes(1);
  });

  it("submits the fence so the wait can complete", () => {
    const { gl, probe } = engineWithGl(() => SIGNALED);

    probe();

    expect(gl.flush).toHaveBeenCalled();
  });

  it("recovers from a failed wait by fencing again", () => {
    const { gl, probe } = engineWithGl(() => WAIT_FAILED);

    probe();
    probe();

    expect(gl.deleteSync).toHaveBeenCalled();
    expect(gl.fenceSync).toHaveBeenCalledTimes(2);
  });

  it("issues no fences while timing is off", () => {
    const { engine, gl, probe } = engineWithGl(() => SIGNALED);
    engine.setGpuTimingEnabled(false);

    probe();

    expect(gl.fenceSync).not.toHaveBeenCalled();
    expect(engine.getGpuFrameTimeMs()).toBeNull();
  });

  it("releases a fence still in flight when timing is turned off", () => {
    const { engine, gl, probe } = engineWithGl(() => TIMEOUT_EXPIRED);

    probe();
    engine.setGpuTimingEnabled(false);

    expect(gl.deleteSync).toHaveBeenCalled();
  });

  it("survives a context without sync objects", () => {
    const engine = new RenderingEngine();
     
    (engine as any).gl = {};
    engine.setGpuTimingEnabled(true);

     
    expect(() => (engine as any).probeGpuFrameTime()).not.toThrow();
    expect(engine.getGpuFrameTimeMs()).toBeNull();
  });
});
