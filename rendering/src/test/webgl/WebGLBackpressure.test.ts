import { afterEach, describe, expect, it, vi } from "vitest";
import { RenderingEngine } from "../../webgl/RenderingEngine";
import { FrameRenderer } from "../../webgl/FrameRenderer";

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

    expect(engine.shouldWaitForGpu()).toBe(false);
    submit();
    expect(engine.shouldWaitForGpu()).toBe(false);
  });

  it("holds frames back once the GPU is behind", () => {
    const { engine, submit } = engineWithGl(() => TIMEOUT_EXPIRED);

    submit();
    submit();

    expect(engine.shouldWaitForGpu()).toBe(true);
  });

  it("resumes as soon as the GPU passes a fence", () => {
    const { engine, submit } = engineWithGl(() => SIGNALED);

    submit();
    submit();

    // Both fences are already passed, so nothing is outstanding.
    expect(engine.shouldWaitForGpu()).toBe(false);
  });

  it("renders anyway rather than stalling on fences that never pass", () => {
    const { engine, submit } = engineWithGl(() => TIMEOUT_EXPIRED);

    submit();
    submit();

    expect([
      engine.shouldWaitForGpu(),
      engine.shouldWaitForGpu(),
      engine.shouldWaitForGpu(),
      engine.shouldWaitForGpu(),
      engine.shouldWaitForGpu(),
    ]).toEqual([true, true, true, true, false]);
  });

  it("never withholds a frame while it is switched off", () => {
    (globalThis as PerfGlobal).__gpuBackpressure = false;
    const { engine, gl, submit } = engineWithGl(() => TIMEOUT_EXPIRED);

    submit();
    submit();

    expect(engine.shouldWaitForGpu()).toBe(false);
    expect(gl.fenceSync).not.toHaveBeenCalled();
  });

  it("releases the fences it passed so they do not accumulate", () => {
    const { engine, gl, submit } = engineWithGl(() => SIGNALED);

    submit();
    submit();
    engine.shouldWaitForGpu();

    expect(gl.deleteSync).toHaveBeenCalledTimes(2);
  });

  it("does nothing on a context without sync objects", () => {
    const engine = new RenderingEngine();
     
    (engine as any).gl = {};

    expect(engine.shouldWaitForGpu()).toBe(false);
  });
});

describe("FrameRenderer pacing", () => {
   
  function frameRenderer() {
    const stub = {} as any;
    const renderer = new FrameRenderer(
      { updateFrame: vi.fn(), getFrame: () => 1, getDeltaTime: () => 16, isPaused: () => false } as any,
      stub, stub, stub, stub, stub, stub, stub,
      document.createElement("canvas"),
      stub,
    );
    // Simulate the loop being live; only then is a frame eligible for pacing.
    (renderer as any).running = true;
    return renderer;
  }
   

  it("skips a loop frame when the pacer asks it to", () => {
    const renderer = frameRenderer();
    const pacer = vi.fn(() => true);
    renderer.setFramePacer(pacer);

    // Returning early is the point: the stubbed collaborators would throw if
    // the frame went ahead.
    expect(() => renderer.render(16)).not.toThrow();
    expect(pacer).toHaveBeenCalled();
  });

  it("renders normally once the pacer is cleared", () => {
    const renderer = frameRenderer();
    renderer.setFramePacer(() => true);
    renderer.setFramePacer(null);

    // With no pacer the frame proceeds into the (stubbed) render path.
    expect(() => renderer.render(16)).toThrow();
  });
});
