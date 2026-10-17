import { afterEach, describe, expect, it, vi } from "vitest";
import { WebXrSession, isImmersiveVrSupported } from "../../webxr/WebXrSession";

type Listener = () => void;

class FakeSession {
  readonly inputSources: XRInputSource[] = [];
  readonly listeners = new Map<string, Listener>();
  readonly requestAnimationFrame = vi.fn((_callback: XRFrameRequestCallback) => 42);
  readonly cancelAnimationFrame = vi.fn();
  readonly updateRenderState = vi.fn();
  readonly end = vi.fn(async () => {
    this.emit("end");
  });
  readonly requestReferenceSpace = vi.fn(async (kind: string) => {
    if (kind === "local-floor" && this.failFloor) {
      throw new Error("no floor");
    }
    return { kind } as unknown as XRReferenceSpace;
  });
  failFloor = false;
  addEventListener = vi.fn((event: string, listener: Listener) => this.listeners.set(event, listener));
  removeEventListener = vi.fn((event: string) => this.listeners.delete(event));
  emit(event: string): void {
    this.listeners.get(event)?.();
  }
}

const setup = () => {
  const canvas = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const gl = { canvas, makeXRCompatible: vi.fn(async () => {}) } as unknown as WebGL2RenderingContext;
  const callbacks = { start: vi.fn(), frame: vi.fn(), end: vi.fn() };
  return { canvas, gl, callbacks };
};

const installXr = (session: FakeSession, request = vi.fn(async () => session)) => {
  vi.stubGlobal("navigator", { xr: { requestSession: request, isSessionSupported: vi.fn(async () => true) } });
  vi.stubGlobal("XRWebGLLayer", class {
    framebuffer = "framebuffer" as unknown as WebGLFramebuffer;
    getViewport = vi.fn();
    constructor(..._args: unknown[]) {}
  });
  return request;
};

afterEach(() => vi.unstubAllGlobals());

describe("WebXrSession", () => {
  it("reports WebXR support and treats unavailable or rejected probes as false", async () => {
    vi.stubGlobal("navigator", { xr: { isSessionSupported: vi.fn(async () => true) } });
    await expect(isImmersiveVrSupported()).resolves.toBe(true);
    vi.stubGlobal("navigator", { xr: { isSessionSupported: vi.fn(async () => {
      throw new Error("blocked");
    }) } });
    await expect(isImmersiveVrSupported()).resolves.toBe(false);
    vi.stubGlobal("navigator", {});
    await expect(isImmersiveVrSupported()).resolves.toBe(false);
  });

  it("starts before yielding, falls back to local space, and schedules frames", async () => {
    const fake = new FakeSession();
    fake.failFloor = true;
    const request = installXr(fake);
    const { gl, callbacks, canvas } = setup();
    const manager = new WebXrSession(gl, callbacks);
    const pending = manager.start();
    expect(request).toHaveBeenCalledWith("immersive-vr", { optionalFeatures: ["local-floor"] });
    await pending;
    expect(manager.active).toBe(true);
    expect(fake.requestReferenceSpace).toHaveBeenNthCalledWith(1, "local-floor");
    expect(fake.requestReferenceSpace).toHaveBeenNthCalledWith(2, "local");
    expect(fake.updateRenderState).toHaveBeenCalledTimes(1);
    expect(callbacks.start).toHaveBeenCalledOnce();
    expect(canvas.addEventListener).toHaveBeenCalledWith("webglcontextlost", expect.any(Function));
    expect(fake.requestAnimationFrame).toHaveBeenCalledOnce();
  });

  it("forwards viewer frames, reschedules them, and ends cleanly", async () => {
    const fake = new FakeSession();
    installXr(fake);
    const { gl, callbacks, canvas } = setup();
    const manager = new WebXrSession(gl, callbacks);
    await manager.start();
    const frame = { session: fake, getViewerPose: vi.fn(() => ({ views: [] })) } as unknown as XRFrame;
    const callback = fake.requestAnimationFrame.mock.calls[0]![0] as unknown as (time: number, value: XRFrame) => void;
    callback(123, frame);
    expect(callbacks.frame).toHaveBeenCalledWith(123, expect.objectContaining({ frame, pose: { views: [] } }));
    expect(fake.requestAnimationFrame).toHaveBeenCalledTimes(2);
    await manager.end();
    expect(manager.active).toBe(false);
    expect(fake.cancelAnimationFrame).toHaveBeenCalledWith(42);
    expect(callbacks.end).toHaveBeenCalledWith(undefined);
    expect(canvas.removeEventListener).toHaveBeenCalledWith("webglcontextlost", expect.any(Function));
  });

  it("ignores frames from another session and converts frame failures into a session end", async () => {
    const fake = new FakeSession();
    installXr(fake);
    const { gl, callbacks } = setup();
    const manager = new WebXrSession(gl, callbacks);
    await manager.start();
    const callback = fake.requestAnimationFrame.mock.calls[0]![0] as unknown as (time: number, value: XRFrame) => void;
    callback(1, { session: {} } as XRFrame);
    expect(callbacks.frame).not.toHaveBeenCalled();
    callbacks.frame.mockImplementationOnce(() => {
      throw new Error("render failed");
    });
    callback(2, { session: fake, getViewerPose: vi.fn(() => undefined) } as unknown as XRFrame);
    await vi.waitFor(() => expect(manager.active).toBe(false));
    expect(callbacks.end).toHaveBeenCalledWith("render failed");
  });

  it("ends after context loss and records end errors without throwing", async () => {
    const fake = new FakeSession();
    fake.end.mockRejectedValueOnce(new Error("end failed"));
    installXr(fake);
    const { gl, callbacks, canvas } = setup();
    const manager = new WebXrSession(gl, callbacks);
    await manager.start();
    const contextLost = canvas.addEventListener.mock.calls[0][1] as () => void;
    contextLost();
    await vi.waitFor(() => expect(manager.active).toBe(false));
    expect(callbacks.end).toHaveBeenCalledWith("WebGL context lost during VR");
  });

  it("rejects unavailable, duplicate, and disposed starts", async () => {
    vi.stubGlobal("navigator", {});
    const { gl, callbacks } = setup();
    const manager = new WebXrSession(gl, callbacks);
    await expect(manager.start()).rejects.toThrow("WebXR is unavailable");
    const fake = new FakeSession();
    installXr(fake, vi.fn(() => new Promise(() => {})));
    const other = new WebXrSession(gl, callbacks);
    void other.start();
    await expect(other.start()).rejects.toThrow("already starting");
    other.dispose();
    await expect(other.start()).rejects.toThrow("already starting");
  });

  it("closes a session resolved after disposal", async () => {
    const fake = new FakeSession();
    let resolve: ((value: FakeSession) => void) | undefined;
    const request = vi.fn(() => new Promise<FakeSession>((done) => {
      resolve = done;
    }));
    installXr(fake, request);
    const { gl, callbacks } = setup();
    const manager = new WebXrSession(gl, callbacks);
    const starting = manager.start();
    manager.dispose();
    resolve!(fake);
    await expect(starting).rejects.toThrow("disposed during startup");
    expect(fake.end).toHaveBeenCalledOnce();
  });

  it("does not let an old ending session tear down a replacement session", async () => {
    const oldSession = new FakeSession();
    const replacement = new FakeSession();
    let resolveOldEnd: (() => void) | undefined;
    oldSession.end.mockImplementationOnce(() => {
      oldSession.emit("end");
      return new Promise<void>((resolve) => {
        resolveOldEnd = resolve;
      });
    });
    installXr(oldSession, vi.fn().mockResolvedValueOnce(oldSession).mockResolvedValueOnce(replacement));
    const { gl, callbacks } = setup();
    const manager = new WebXrSession(gl, callbacks);
    await manager.start();
    const ending = manager.end();
    await manager.start();
    resolveOldEnd!();
    await ending;
    expect(manager.active).toBe(true);
    expect(replacement.requestAnimationFrame).toHaveBeenCalledOnce();
    expect(callbacks.end).toHaveBeenCalledTimes(1);
  });

  it("does not attach an old end error to a replacement session", async () => {
    const oldSession = new FakeSession();
    const replacement = new FakeSession();
    let rejectOldEnd: ((reason: Error) => void) | undefined;
    oldSession.end.mockImplementationOnce(() => {
      oldSession.emit("end");
      return new Promise<void>((_resolve, reject) => {
        rejectOldEnd = reject;
      });
    });
    installXr(oldSession, vi.fn().mockResolvedValueOnce(oldSession).mockResolvedValueOnce(replacement));
    const { gl, callbacks } = setup();
    const manager = new WebXrSession(gl, callbacks);
    await manager.start();
    const ending = manager.end();
    await manager.start();
    rejectOldEnd!(new Error("old session failed"));
    await ending;
    expect(manager.active).toBe(true);
    await manager.end();
    expect(callbacks.end).toHaveBeenCalledTimes(2);
    expect(callbacks.end).toHaveBeenLastCalledWith(undefined);
  });
  it("reports a non-Error session-end rejection", async () => {
    const fake = new FakeSession();
    fake.end.mockRejectedValueOnce("session end failed");
    installXr(fake);
    const { gl, callbacks } = setup();
    const manager = new WebXrSession(gl, callbacks);
    await manager.start();
    await manager.end();
    expect(callbacks.end).toHaveBeenCalledWith("session end failed");
    expect(manager.active).toBe(false);
  });

  it("rejects startup if the session ends while making the context compatible", async () => {
    const fake = new FakeSession();
    installXr(fake);
    const { gl, callbacks } = setup();
    let compatible!: () => void;
    vi.mocked(gl.makeXRCompatible).mockImplementationOnce(() => new Promise<void>(resolve => {
      compatible = resolve;
    }));
    const manager = new WebXrSession(gl, callbacks);
    const starting = manager.start();
    await Promise.resolve();
    fake.emit("end");
    compatible();
    await expect(starting).rejects.toThrow("ended during startup");
    expect(callbacks.start).not.toHaveBeenCalled();
  });

});
