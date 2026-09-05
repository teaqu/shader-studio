import { afterEach, describe, expect, it, vi } from "vitest";
import { RenderingEngine } from "../../webgl/RenderingEngine";
import { FrameRenderer } from "../../webgl/FrameRenderer";
import { MAX_GPU_STALL_MS } from "../../util/GpuBackpressure";

/**
 * The driver blocks once swap-chain buffers run out, but that ceiling sits
 * several frames deep and belongs to the platform. Capping frames in flight
 * bounds how stale the picture can be, without ever withholding a frame
 * something asked for explicitly.
 */
const SIGNALED = 0x911a;
const TIMEOUT_EXPIRED = 0x911b;

type PerfGlobal = typeof globalThis & { __gpuBackpressure?: boolean };

function engineWithGl(clientWaitSync: () => number) {
  const engine = new RenderingEngine();
  const gl = {
    ALREADY_SIGNALED: SIGNALED,
    CONDITION_SATISFIED: 0x911c,
    WAIT_FAILED: 0x911d,
    SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
    fenceSync: vi.fn(() => ({}) as WebGLSync),
    clientWaitSync: vi.fn(clientWaitSync),
    deleteSync: vi.fn(),
    flush: vi.fn(),
  };
   
  (engine as any).gl = gl;
  return {
    engine,
    gl,
     
    submit: () => (engine as any).trackFrameInFlight(),
  };
}

afterEach(() => {
  delete (globalThis as PerfGlobal).__gpuBackpressure;
});

describe("RenderingEngine GPU backpressure", () => {
  it("keeps the GPU pipelined rather than serialised", () => {
    const { engine, submit } = engineWithGl(() => TIMEOUT_EXPIRED);

    expect(engine.shouldWaitForGpu(0)).toBe(false);
    submit();
    expect(engine.shouldWaitForGpu(0)).toBe(false);
  });

  it("holds frames back once the GPU is behind", () => {
    const { engine, submit } = engineWithGl(() => TIMEOUT_EXPIRED);

    submit();
    submit();

    expect(engine.shouldWaitForGpu(0)).toBe(true);
  });

  it("resumes as soon as the GPU passes a fence", () => {
    const { engine, submit } = engineWithGl(() => SIGNALED);

    submit();
    submit();

    // Both fences are already passed, so nothing is outstanding.
    expect(engine.shouldWaitForGpu(0)).toBe(false);
  });

  it("renders anyway once fences that never pass have cost enough real time", () => {
    const { engine, submit } = engineWithGl(() => TIMEOUT_EXPIRED);

    submit();
    submit();

    expect(engine.shouldWaitForGpu(0)).toBe(true);
    expect(engine.shouldWaitForGpu(MAX_GPU_STALL_MS - 1)).toBe(true);
    expect(engine.shouldWaitForGpu(MAX_GPU_STALL_MS)).toBe(false);
  });

  it("keeps holding a genuinely slow (not stuck) GPU back across many ticks", () => {
    // requestAnimationFrame fires at the display's refresh rate no matter
    // how long the GPU actually takes to pass a fence, so a large canvas
    // legitimately taking far longer than one frame must still be paced,
    // not forced through just because many ticks went by.
    const { engine, submit } = engineWithGl(() => TIMEOUT_EXPIRED);

    submit();
    submit();

    const tickIntervalMs = 16;
    const ticksWithinStallBudget = Math.floor(MAX_GPU_STALL_MS / tickIntervalMs) - 1;
    for (let i = 0; i <= ticksWithinStallBudget; i++) {
      expect(engine.shouldWaitForGpu(i * tickIntervalMs)).toBe(true);
    }
  });

  it("never withholds a frame while it is switched off", () => {
    (globalThis as PerfGlobal).__gpuBackpressure = false;
    const { engine, gl, submit } = engineWithGl(() => TIMEOUT_EXPIRED);

    submit();
    submit();

    expect(engine.shouldWaitForGpu(0)).toBe(false);
    expect(gl.fenceSync).not.toHaveBeenCalled();
  });

  it("releases the fences it passed so they do not accumulate", () => {
    const { engine, gl, submit } = engineWithGl(() => SIGNALED);

    submit();
    submit();
    engine.shouldWaitForGpu(0);

    expect(gl.deleteSync).toHaveBeenCalledTimes(2);
  });

  it("does nothing on a context without sync objects", () => {
    const engine = new RenderingEngine();

    (engine as any).gl = {};

    expect(engine.shouldWaitForGpu(0)).toBe(false);
  });

  it("does not track a frame when the driver fails to create a fence", () => {
    // fenceSync can return null (e.g. a context under pressure) instead of
    // throwing. That must not push a phantom fence that never releases.
    const { engine, gl, submit } = engineWithGl(() => TIMEOUT_EXPIRED);
    gl.fenceSync.mockReturnValue(null as unknown as WebGLSync);

    submit();
    submit();

    expect(gl.flush).not.toHaveBeenCalled();

    expect((engine as any).inFlightFences).toEqual([]);
    expect(engine.shouldWaitForGpu(0)).toBe(false);
  });
});

describe("FrameRenderer pacing", () => {
   
  function frameRenderer() {
    const stub = {} as any;
    return new FrameRenderer(
      { updateFrame: vi.fn(), getFrame: () => 1, getDeltaTime: () => 16, isPaused: () => false } as any,
      stub, stub, stub, stub, stub, stub, stub,
      document.createElement("canvas"),
      stub,
    );
  }
   

  it("asks the pacer before each loop frame", () => {
    const renderer = frameRenderer();
    const pacer = vi.fn(() => true);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });

    renderer.setFramePacer(pacer);
    renderer.startRenderLoop();
    // Withholding the frame is the point: the stubbed collaborators would
    // throw if it went ahead.
    expect(() => frames[0]!(16)).not.toThrow();
    expect(pacer).toHaveBeenCalled();

    renderer.stopRenderLoop();
    vi.unstubAllGlobals();
  });

  it("never withholds an explicit render, whatever the pacer says", () => {
    const renderer = frameRenderer();
    renderer.setFramePacer(() => true);
     
    (renderer as any).running = true;

    // A capture or readback must produce its frame, so this reaches the
    // (stubbed) render path rather than being paced away.
    expect(() => renderer.render(16)).toThrow();
  });
});
