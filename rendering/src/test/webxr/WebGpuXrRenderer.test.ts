import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionState = vi.hoisted(() => ({
  callbacks: null as any,
  gl: null as unknown,
  active: false,
  created: 0,
  start: vi.fn(),
  end: vi.fn(),
  dispose: vi.fn(),
}));

const compositorState = vi.hoisted(() => ({ draw: vi.fn(), dispose: vi.fn() }));

vi.mock("../../webxr/WebXrSession", () => ({
  WebXrSession: class {
    constructor(gl: WebGL2RenderingContext, callbacks: unknown) {
      sessionState.gl = gl;
      sessionState.callbacks = callbacks;
      sessionState.created++;
    }
    get active() {
      return sessionState.active;
    }
    start = sessionState.start;
    end = sessionState.end;
    dispose = sessionState.dispose;
  },
}));

vi.mock("../../webxr/WebXrEyeCompositor", () => ({
  WebXrEyeCompositor: class {
    draw = compositorState.draw;
    dispose = compositorState.dispose;
  },
}));

vi.mock("../../webxr/WebXrFrameData", () => ({
  buildVrEyeView: vi.fn((view: any, viewport: any) => ({ viewport, rayTransform: new Float32Array(16), eye: view.eye })),
  readVrControllers: vi.fn(() => ({ positions: new Float32Array(8), directions: new Float32Array(8), buttons: new Float32Array(8), axes: new Float32Array(8), faceButtons: new Float32Array(8), touches: new Float32Array(8), faceTouches: new Float32Array(8) })),
}));

import { buildVrEyeView, readVrControllers } from "../../webxr/WebXrFrameData";
import { WebGpuXrRenderer } from "../../webxr/WebGpuXrRenderer";

const gl = () => ({
  FRAMEBUFFER: 1, SCISSOR_TEST: 2, COLOR_BUFFER_BIT: 4,
  bindFramebuffer: vi.fn(), disable: vi.fn(), clearColor: vi.fn(), clear: vi.fn(),
  isContextLost: vi.fn(() => false),
  getExtension: vi.fn(() => ({ loseContext: vi.fn() })),
});

function host(available = true, running = true) {
  return {
    vr: { available, active: false, controllers: null as unknown, resetSession: vi.fn() },
    isRunning: vi.fn(() => running),
    startRenderLoop: vi.fn(),
    stopRenderLoop: vi.fn(),
    updateFrame: vi.fn(),
    renderEye: vi.fn((_view: unknown, eye: number) => ({ image: eye }) as unknown as TexImageSource),
  };
}

function renderer(target = host(), context: () => unknown = gl) {
  return new WebGpuXrRenderer(target as never, context as () => WebGL2RenderingContext | null);
}

describe("WebGpuXrRenderer", () => {
  beforeEach(() => {
    sessionState.callbacks = null;
    sessionState.gl = null;
    sessionState.active = false;
    sessionState.created = 0;
    sessionState.start.mockReset();
    sessionState.end.mockReset();
    sessionState.dispose.mockReset();
    compositorState.draw.mockReset();
    compositorState.dispose.mockReset();
    vi.mocked(buildVrEyeView).mockClear();
    vi.mocked(readVrControllers).mockClear();
  });

  it("requires a mainVR shader before creating a WebGL context", async () => {
    const context = vi.fn(gl);
    await expect(renderer(host(false), context).start()).rejects.toThrow("must define mainVR");
    expect(context).not.toHaveBeenCalled();
    expect(sessionState.start).not.toHaveBeenCalled();
  });

  it("creates an XR-compatible WebGL2 context on an offscreen canvas by default", async () => {
    const context = gl();
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never);
    try {
      await new WebGpuXrRenderer(host() as never).start();
      expect(getContext).toHaveBeenCalledWith("webgl2", expect.objectContaining({ xrCompatible: true, alpha: false }));
      expect(sessionState.gl).toBe(context);
    } finally {
      getContext.mockRestore();
    }
  });

  it("reports a missing WebGL2 context", async () => {
    await expect(renderer(host(), () => null).start()).rejects.toThrow("requires WebGL2");
  });

  it("stops the desktop loop and marks the session active on start", async () => {
    const target = host();
    sessionState.start.mockImplementationOnce(async () => sessionState.callbacks.start());
    const xr = renderer(target);
    await xr.start();
    expect(target.stopRenderLoop).toHaveBeenCalledOnce();
    expect(target.vr.active).toBe(true);
  });

  it("reflects the session's active state", () => {
    const xr = renderer();
    expect(xr.active).toBe(false);
    void xr.start();
    sessionState.active = true;
    expect(xr.active).toBe(true);
  });

  it("rejects a second enter while the first is pending and reuses the session afterwards", async () => {
    let resolveStart: (() => void) | undefined;
    sessionState.start.mockImplementationOnce(() => new Promise<void>(resolve => {
      resolveStart = resolve;
    }));
    const xr = renderer();
    const first = xr.start();
    await expect(xr.start()).rejects.toThrow("VR is already active");
    resolveStart!();
    await first;
    await xr.start();
    expect(sessionState.created).toBe(1);
  });

  it("recreates the context after it is lost", async () => {
    const lost = gl();
    const contexts = [lost, gl()];
    const xr = renderer(host(), () => contexts.shift());
    await xr.start();
    lost.isContextLost.mockReturnValue(true);
    await xr.start();
    expect(sessionState.created).toBe(2);
    expect(sessionState.dispose).toHaveBeenCalledOnce();
    expect(compositorState.dispose).toHaveBeenCalledOnce();
  });

  it("updates once per frame and composites every valid eye rendered at a zero origin", async () => {
    const target = host();
    const xr = renderer(target);
    await xr.start();
    const context = sessionState.gl as ReturnType<typeof gl>;
    const left = { eye: "left" };
    const right = { eye: "right" };
    const layer = { framebuffer: "xr-framebuffer", getViewport: vi.fn((view: unknown) => view === left ? { x: 0, y: 0, width: 100, height: 50 } : { x: 100, y: 0, width: 100, height: 50 }) };
    sessionState.callbacks.frame(12, { frame: { tag: "frame" }, reference: { tag: "reference" }, pose: { views: [left, right] }, layer });
    expect(readVrControllers).toHaveBeenCalledWith({ tag: "frame" }, { tag: "reference" });
    expect(target.vr.controllers).toEqual(expect.objectContaining({ positions: expect.any(Float32Array) }));
    expect(target.updateFrame).toHaveBeenCalledOnce();
    expect(target.updateFrame).toHaveBeenCalledWith(12);
    expect(target.renderEye).toHaveBeenCalledTimes(2);
    expect(target.renderEye).toHaveBeenNthCalledWith(2, expect.objectContaining({ viewport: { x: 0, y: 0, width: 100, height: 50 } }), 1);
    expect(compositorState.draw).toHaveBeenNthCalledWith(1, "xr-framebuffer", { x: 0, y: 0, width: 100, height: 50 }, { image: 0 });
    expect(compositorState.draw).toHaveBeenNthCalledWith(2, "xr-framebuffer", { x: 100, y: 0, width: 100, height: 50 }, { image: 1 });
    expect(context.clear).toHaveBeenCalledWith(4);
    expect(context.bindFramebuffer).toHaveBeenNthCalledWith(1, 1, "xr-framebuffer");
    expect(context.bindFramebuffer).toHaveBeenLastCalledWith(1, null);
  });

  it("leaves an eye cleared when WebGPU could not render it", async () => {
    const target = host();
    target.renderEye.mockReturnValue(null as never);
    const xr = renderer(target);
    await xr.start();
    const layer = { framebuffer: "xr", getViewport: vi.fn(() => ({ x: 0, y: 0, width: 4, height: 4 })) };
    sessionState.callbacks.frame(1, { frame: {}, reference: {}, pose: { views: [{}] }, layer });
    expect(compositorState.draw).not.toHaveBeenCalled();
  });

  it("skips null, missing, and zero-sized views", async () => {
    const target = host();
    const xr = renderer(target);
    await xr.start();
    const missing = { eye: "left" };
    const zero = { eye: "right" };
    const layer = { framebuffer: {}, getViewport: vi.fn((view: unknown) => view === zero ? { x: 0, y: 0, width: 10, height: 0 } : undefined) };
    sessionState.callbacks.frame(1, { frame: {}, reference: {}, pose: null, layer });
    sessionState.callbacks.frame(2, { frame: {}, reference: {}, pose: { views: [missing, zero] }, layer });
    expect(target.renderEye).not.toHaveBeenCalled();
    expect(buildVrEyeView).not.toHaveBeenCalled();
  });

  it("restores the default framebuffer when an eye fails", async () => {
    const target = host();
    target.renderEye.mockImplementationOnce(() => {
      throw new Error("eye failed");
    });
    const xr = renderer(target);
    await xr.start();
    const context = sessionState.gl as ReturnType<typeof gl>;
    const layer = { framebuffer: "xr", getViewport: vi.fn(() => ({ x: 0, y: 0, width: 1, height: 1 })) };
    expect(() => sessionState.callbacks.frame(1, { frame: {}, reference: {}, pose: { views: [{}] }, layer })).toThrow("eye failed");
    expect(context.bindFramebuffer).toHaveBeenLastCalledWith(1, null);
  });

  it("ends when mainVR disappears and restores a running loop exactly once", async () => {
    const target = host(true, true);
    const ended = vi.fn();
    const xr = renderer(target);
    await xr.start(ended);
    sessionState.callbacks.start();
    target.vr.available = false;
    sessionState.callbacks.frame(1, { frame: {}, reference: {}, pose: null, layer: {} });
    expect(sessionState.end).toHaveBeenCalledOnce();
    expect(target.updateFrame).not.toHaveBeenCalled();
    sessionState.callbacks.end("shader changed");
    expect(target.vr.resetSession).toHaveBeenCalledOnce();
    expect(target.startRenderLoop).toHaveBeenCalledOnce();
    expect(ended).toHaveBeenCalledWith("shader changed");
    sessionState.callbacks.end();
    expect(ended).toHaveBeenCalledOnce();
  });

  it("does not restore a loop that was stopped before entering", async () => {
    const target = host(true, false);
    await renderer(target).start();
    sessionState.callbacks.start();
    sessionState.callbacks.end();
    expect(target.startRenderLoop).not.toHaveBeenCalled();
  });

  it("rejects the start callback if mainVR vanished during startup", async () => {
    const target = host();
    await renderer(target).start();
    target.vr.available = false;
    expect(() => sessionState.callbacks.start()).toThrow("must define mainVR");
  });

  it("clears the end callback when startup fails", async () => {
    const failed = new Error("denied");
    sessionState.start.mockRejectedValueOnce(failed);
    const ended = vi.fn();
    const xr = renderer();
    await expect(xr.start(ended)).rejects.toBe(failed);
    sessionState.callbacks.end("late end");
    expect(ended).not.toHaveBeenCalled();
  });

  it("ends through the session, and resolves without one", async () => {
    const xr = renderer();
    await expect(xr.end()).resolves.toBeUndefined();
    await xr.start();
    await xr.end();
    expect(sessionState.end).toHaveBeenCalledOnce();
  });

  it("forwards navigation settings to locomotion", async () => {
    const xr = renderer();
    const configure = vi.spyOn((xr as unknown as { locomotion: { configure(settings: unknown): void } }).locomotion, "configure");
    const settings = { movement: true, movementSpeed: 3, turning: "smooth" as const, snapAngle: 45, turnSpeed: 120 };
    xr.setNavigationSettings(settings);
    expect(configure).toHaveBeenCalledWith(settings);
  });

  it("releases WebGL resources on dispose and never restarts the loop afterwards", async () => {
    const target = host(true, true);
    const context = gl();
    const loseContext = vi.fn();
    context.getExtension.mockReturnValue({ loseContext });
    const xr = renderer(target, () => context);
    await xr.start();
    sessionState.callbacks.start();
    const end = sessionState.callbacks.end;
    xr.dispose();
    end();
    expect(sessionState.dispose).toHaveBeenCalledOnce();
    expect(compositorState.dispose).toHaveBeenCalledOnce();
    expect(loseContext).toHaveBeenCalledOnce();
    expect(target.startRenderLoop).not.toHaveBeenCalled();
    await expect(xr.start()).rejects.toThrow("disposed");
    xr.dispose();
  });
});
