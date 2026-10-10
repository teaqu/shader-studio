import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionState = vi.hoisted(() => ({
  callbacks: null as any,
  active: false,
  start: vi.fn(),
  end: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock("../../webxr/WebXrSession", () => ({
  WebXrSession: class {
    constructor(_gl: WebGL2RenderingContext, callbacks: unknown) {
      sessionState.callbacks = callbacks;
    }
    get active() {
      return sessionState.active;
    }
    start = sessionState.start;
    end = sessionState.end;
    dispose = sessionState.dispose;
  },
}));

vi.mock("../../webxr/WebXrFrameData", () => ({
  buildVrEyeView: vi.fn((view: any, viewport: any) => ({ viewport, rayTransform: new Float32Array(16), eye: view.eye })),
  readVrControllers: vi.fn(() => ({ positions: new Float32Array(8), directions: new Float32Array(8), buttons: new Float32Array(8), axes: new Float32Array(8) })),
}));

import { buildVrEyeView, readVrControllers } from "../../webxr/WebXrFrameData";
import { WebXrRenderer } from "../../webxr/WebXrRenderer";

const gl = () => ({
  FRAMEBUFFER: 1, SCISSOR_TEST: 2, COLOR_BUFFER_BIT: 4,
  canvas: { width: 800, height: 600 },
  bindFramebuffer: vi.fn(), disable: vi.fn(), clearColor: vi.fn(), clear: vi.fn(), viewport: vi.fn(),
  isContextLost: vi.fn(() => false),
});

const passRenderer = (available = true) => ({
  vrPreview: { available },
  xr: { active: false, controllers: null as unknown, reset: vi.fn() },
});

const frameRenderer = (running = true) => ({
  isRunning: vi.fn(() => running), stopRenderLoop: vi.fn(), startRenderLoop: vi.fn(), renderVrView: vi.fn(),
});

describe("WebXrRenderer", () => {
  beforeEach(() => {
    sessionState.callbacks = null;
    sessionState.active = false;
    sessionState.start.mockReset();
    sessionState.end.mockReset();
    sessionState.dispose.mockReset();
    vi.mocked(buildVrEyeView).mockClear();
    vi.mocked(readVrControllers).mockClear();
  });

  it("only starts a session for a compiled mainVR image and stops the desktop loop", async () => {
    const xr = new WebXrRenderer(gl() as unknown as WebGL2RenderingContext, frameRenderer() as never, passRenderer(false) as never, vi.fn());
    await expect(xr.start()).rejects.toThrow("must define mainVR");
    expect(sessionState.start).not.toHaveBeenCalled();

    const frames = frameRenderer();
    const passes = passRenderer();
    sessionState.start.mockImplementationOnce(async () => sessionState.callbacks.start());
    const renderer = new WebXrRenderer(gl() as unknown as WebGL2RenderingContext, frames as never, passes as never, vi.fn());
    await renderer.start();
    expect(frames.stopRenderLoop).toHaveBeenCalledOnce();
    expect(passes.xr.active).toBe(true);
  });

  it("rejects a second enter while the first session request is pending", async () => {
    let resolveStart: (() => void) | undefined;
    sessionState.start.mockImplementationOnce(() => new Promise<void>(resolve => {
      resolveStart = resolve;
    }));
    const renderer = new WebXrRenderer(gl() as unknown as WebGL2RenderingContext, frameRenderer() as never, passRenderer() as never, vi.fn());
    const first = renderer.start();
    await expect(renderer.start()).rejects.toThrow("VR is already active");
    resolveStart!();
    await first;
  });

  it("updates the desktop frame once and draws every valid eye into the XR framebuffer", () => {
    const target = gl();
    const frames = frameRenderer();
    const passes = passRenderer();
    const update = vi.fn();
    new WebXrRenderer(target as unknown as WebGL2RenderingContext, frames as never, passes as never, update);
    const left = { eye: "left" };
    const right = { eye: "right" };
    const layer = { framebuffer: "xr-framebuffer", getViewport: vi.fn((view: any) => view === left ? { x: 0, y: 0, width: 100, height: 50 } : { x: 100, y: 0, width: 100, height: 50 }) };
    sessionState.callbacks.frame(12, { frame: { tag: "frame" }, reference: { tag: "reference" }, pose: { views: [left, right] }, layer });
    expect(update).toHaveBeenCalledOnce();
    expect(readVrControllers).toHaveBeenCalledWith({ tag: "frame" }, { tag: "reference" });
    expect(frames.renderVrView).toHaveBeenCalledTimes(2);
    expect(frames.renderVrView).toHaveBeenNthCalledWith(1, "xr-framebuffer", expect.objectContaining({ viewport: { x: 0, y: 0, width: 100, height: 50 } }));
    expect(buildVrEyeView).toHaveBeenCalledTimes(2);
    expect(target.bindFramebuffer).toHaveBeenNthCalledWith(1, 1, "xr-framebuffer");
    expect(target.bindFramebuffer).toHaveBeenLastCalledWith(1, null);
  });

  it("ends on a shader change and restores the prior loop exactly once", () => {
    const target = gl();
    const frames = frameRenderer(true);
    const passes = passRenderer();
    const ended = vi.fn();
    const renderer = new WebXrRenderer(target as unknown as WebGL2RenderingContext, frames as never, passes as never, vi.fn());
    sessionState.callbacks.start();
    renderer.start(ended);
    passes.vrPreview.available = false;
    sessionState.callbacks.frame(1, { frame: {}, reference: {}, pose: null, layer: {} });
    expect(sessionState.end).toHaveBeenCalledOnce();
    sessionState.callbacks.end("shader changed");
    expect(passes.xr.reset).toHaveBeenCalledOnce();
    expect(frames.startRenderLoop).toHaveBeenCalledOnce();
    expect(ended).toHaveBeenCalledWith("shader changed");
  });

  it("skips null, missing, and zero-sized XR views without drawing", () => {
    const frames = frameRenderer(false);
    const target = gl();
    new WebXrRenderer(target as unknown as WebGL2RenderingContext, frames as never, passRenderer() as never, vi.fn());
    const missing = { eye: "left" };
    const zero = { eye: "right" };
    const layer = { framebuffer: {}, getViewport: vi.fn((view: unknown) => view === zero ? { x: 0, y: 0, width: 0, height: 10 } : undefined) };
    sessionState.callbacks.frame(1, { frame: {}, reference: {}, pose: null, layer });
    sessionState.callbacks.frame(2, { frame: {}, reference: {}, pose: { views: [missing, zero] }, layer });
    expect(frames.renderVrView).not.toHaveBeenCalled();
    expect(buildVrEyeView).not.toHaveBeenCalled();
    expect(target.bindFramebuffer).toHaveBeenLastCalledWith(1, null);
  });

  it("restores the desktop framebuffer and viewport when an eye draw fails", () => {
    const target = gl();
    const frames = frameRenderer();
    frames.renderVrView.mockImplementationOnce(() => {
      throw new Error("eye failed");
    });
    new WebXrRenderer(target as unknown as WebGL2RenderingContext, frames as never, passRenderer() as never, vi.fn());
    const view = { eye: "left" };
    const layer = { framebuffer: "xr", getViewport: vi.fn(() => ({ x: 0, y: 0, width: 1, height: 1 })) };
    expect(() => sessionState.callbacks.frame(1, { frame: {}, reference: {}, pose: { views: [view] }, layer })).toThrow("eye failed");
    expect(target.bindFramebuffer).toHaveBeenLastCalledWith(1, null);
    expect(target.viewport).toHaveBeenCalledWith(0, 0, 800, 600);
  });

  it("does not restore a stopped loop or a lost WebGL context", () => {
    const stopped = frameRenderer(false);
    const target = gl();
    const renderer = new WebXrRenderer(target as unknown as WebGL2RenderingContext, stopped as never, passRenderer() as never, vi.fn());
    sessionState.callbacks.start();
    sessionState.callbacks.end();
    expect(stopped.startRenderLoop).not.toHaveBeenCalled();

    const running = frameRenderer(true);
    const lost = gl();
    lost.isContextLost.mockReturnValue(true);
    new WebXrRenderer(lost as unknown as WebGL2RenderingContext, running as never, passRenderer() as never, vi.fn());
    sessionState.callbacks.start();
    sessionState.callbacks.end("lost");
    expect(running.startRenderLoop).not.toHaveBeenCalled();
    void renderer;
  });

  it("clears an end callback when session startup fails", async () => {
    const failed = new Error("denied");
    sessionState.start.mockRejectedValueOnce(failed);
    const ended = vi.fn();
    const renderer = new WebXrRenderer(gl() as unknown as WebGL2RenderingContext, frameRenderer() as never, passRenderer() as never, vi.fn());
    await expect(renderer.start(ended)).rejects.toBe(failed);
    sessionState.callbacks.end("late end");
    expect(ended).not.toHaveBeenCalled();
    await renderer.end();
    expect(sessionState.end).toHaveBeenCalledOnce();
  });

  it("rejects a start callback when the pipeline loses mainVR during startup", () => {
    const passes = passRenderer(false);
    new WebXrRenderer(gl() as unknown as WebGL2RenderingContext, frameRenderer() as never, passes as never, vi.fn());
    expect(() => sessionState.callbacks.start()).toThrow("must define mainVR");
  });

  it("does not restore a desktop loop after disposal", () => {
    const frames = frameRenderer(true);
    const passes = passRenderer();
    const renderer = new WebXrRenderer(gl() as unknown as WebGL2RenderingContext, frames as never, passes as never, vi.fn());
    sessionState.callbacks.start();
    renderer.dispose();
    sessionState.callbacks.end();
    expect(sessionState.dispose).toHaveBeenCalledOnce();
    expect(frames.startRenderLoop).not.toHaveBeenCalled();
  });
});
