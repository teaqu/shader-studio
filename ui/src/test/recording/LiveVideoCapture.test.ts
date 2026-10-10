import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createLiveVideoCapture } from "../../lib/recording/LiveVideoCapture";

const mocks = vi.hoisted(() => ({
  addTrack: vi.fn(), start: vi.fn(), finalize: vi.fn(), cancel: vi.fn(), close: vi.fn(), add: vi.fn(), stopTrack: vi.fn(), canEncode: vi.fn(), bridge: vi.fn(),
  config: null as Record<string, unknown> | null,
  target: { buffer: new ArrayBuffer(4) as ArrayBuffer | null },
  error: (_error: unknown) => {},
}));
vi.mock("../../lib/recording/LivePreviewCanvas", () => ({ createLivePreviewCanvas: mocks.bridge }));
vi.mock("mediabunny", () => ({
  Quality: class {
    constructor(readonly options: unknown) {}
  },
  Mp4OutputFormat: class {}, WebMOutputFormat: class {},
  BufferTarget: class {
    constructor() {
      return mocks.target;
    }
  },
  Output: class {
    start = mocks.start; finalize = mocks.finalize; cancel = mocks.cancel;
    addVideoTrack = mocks.addTrack;
  },
  MediaStreamVideoTrackSource: class {
    close = mocks.close;
    errorPromise = new Promise<void>((_resolve, reject) => {
      mocks.error = reject;
    });
    constructor(_track: unknown, config: Record<string, unknown>) {
      mocks.config = config;
    }
  },
  CanvasSource: class {
    close = mocks.close;
    add = mocks.add;
    constructor(_canvas: unknown, config: Record<string, unknown>) {
      mocks.config = config;
    }
  },
  canEncodeVideo: mocks.canEncode,
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.target.buffer = new ArrayBuffer(4);
  mocks.start.mockResolvedValue(undefined);
  mocks.finalize.mockImplementation(async () => {
    (mocks.config?.onEncodedPacket as () => void)();
  });
  mocks.cancel.mockResolvedValue(undefined);
  mocks.add.mockResolvedValue(undefined);
  mocks.canEncode.mockResolvedValue(true);
});
afterEach(() => vi.useRealTimers());
function canvas() {
  const track = { stop: mocks.stopTrack };
  return { width: 815, height: 459, captureStream: vi.fn(() => ({ getVideoTracks: () => [track], getTracks: () => [track] })) } as unknown as HTMLCanvasElement;
}
it("feeds WebM directly so the browser stream cannot force realtime quality", async () => {
  const preview = canvas();
  const capture = await createLiveVideoCapture(preview, 60, "webm", new AbortController().signal);
  expect(preview.captureStream).not.toHaveBeenCalled();
  expect(mocks.add).toHaveBeenCalledExactlyOnceWith(0, 1 / 60);
  expect(mocks.config?.latencyMode).toBe("quality");
  expect(mocks.addTrack).toHaveBeenCalledExactlyOnceWith(expect.anything());
  capture.stop();
  await capture.result;
});
it("keeps the requested cadence without adding encoding time to every frame", async () => {
  vi.useFakeTimers();
  mocks.add.mockImplementation(() => new Promise<void>(resolve => setTimeout(resolve, 8)));
  const capture = await createLiveVideoCapture(canvas(), 60, "mp4", new AbortController().signal);
  await vi.advanceTimersByTimeAsync(1000);
  expect(mocks.add.mock.calls.length).toBeGreaterThanOrEqual(60);
  expect(mocks.add.mock.calls.length).toBeLessThanOrEqual(61);
  capture.stop();
  await vi.advanceTimersByTimeAsync(20);
  await capture.result;
});
it("feeds MP4 directly with elapsed timestamps and one pending sample", async () => {
  vi.useFakeTimers();
  let complete!: () => void;
  mocks.add.mockImplementationOnce(() => new Promise<void>(resolve => {
    complete = resolve;
  }));
  const preview = canvas();
  const capture = await createLiveVideoCapture(preview, 60, "mp4", new AbortController().signal);
  expect(preview.captureStream).not.toHaveBeenCalled();
  expect(mocks.add).toHaveBeenCalledExactlyOnceWith(0, 1 / 60);
  expect(mocks.config?.latencyMode).toBe("quality");
  await vi.advanceTimersByTimeAsync(500);
  expect(mocks.add).toHaveBeenCalledOnce();
  complete();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.add).toHaveBeenCalledTimes(2);
  expect(mocks.add.mock.calls[1][0]).toBeGreaterThanOrEqual(.5);
  capture.stop();
  await capture.result;
  await vi.advanceTimersByTimeAsync(1000);
  expect(mocks.add).toHaveBeenCalledTimes(2);
});
it("waits for an in-flight MP4 sample before closing and finalizing", async () => {
  let complete!: () => void;
  mocks.add.mockImplementationOnce(() => new Promise<void>(resolve => {
    complete = resolve;
  }));
  const capture = await createLiveVideoCapture(canvas(), 30, "mp4", new AbortController().signal);
  capture.stop();
  await Promise.resolve();
  expect(mocks.close).not.toHaveBeenCalled();
  expect(mocks.finalize).not.toHaveBeenCalled();
  complete();
  await capture.result;
  expect(mocks.close).toHaveBeenCalledOnce();
  expect(mocks.finalize).toHaveBeenCalledOnce();
});
it("cancels an in-flight MP4 sample without finalizing late completion", async () => {
  vi.useFakeTimers();
  let complete!: () => void;
  mocks.add.mockImplementationOnce(() => new Promise<void>(resolve => {
    complete = resolve;
  }));
  const controller = new AbortController();
  const capture = await createLiveVideoCapture(canvas(), 30, "mp4", controller.signal);
  capture.stop();
  controller.abort(new Error("cancelled during sample"));
  await expect(capture.result).rejects.toThrow("cancelled during sample");
  complete();
  await vi.advanceTimersByTimeAsync(1000);
  expect(mocks.finalize).not.toHaveBeenCalled();
  expect(mocks.add).toHaveBeenCalledOnce();
});
it("propagates a direct MP4 sample failure and cancels once", async () => {
  mocks.add.mockRejectedValueOnce(new Error("sample rejected"));
  const capture = await createLiveVideoCapture(canvas(), 30, "mp4", new AbortController().signal);
  await expect(capture.result).rejects.toThrow("sample rejected");
  capture.stop();
  expect(mocks.cancel).toHaveBeenCalledOnce();
  expect(mocks.finalize).not.toHaveBeenCalled();
});
it("uses stable GPU frames and disposes the bridge after finalization", async () => {
  const stableCanvas = canvas();
  const dispose = vi.fn();
  const captureFrame = vi.fn();
  mocks.bridge.mockResolvedValue({ canvas: stableCanvas, dispose, error: new Promise(() => {}) });
  const capture = await createLiveVideoCapture(canvas(), 60, "webm", new AbortController().signal, captureFrame);
  expect(mocks.bridge).toHaveBeenCalledWith(expect.anything(), captureFrame, expect.any(AbortSignal));
  expect(stableCanvas.captureStream).not.toHaveBeenCalled();
  capture.stop();
  await capture.result;
  expect(dispose).toHaveBeenCalledOnce();
});
it("disposes the stable MP4 canvas after direct samples finish", async () => {
  const stableCanvas = canvas();
  const dispose = vi.fn();
  mocks.bridge.mockResolvedValue({ canvas: stableCanvas, dispose, error: new Promise(() => {}) });
  const capture = await createLiveVideoCapture(canvas(), 60, "mp4", new AbortController().signal, vi.fn());
  expect(stableCanvas.captureStream).not.toHaveBeenCalled();
  capture.stop();
  await capture.result;
  expect(dispose).toHaveBeenCalledOnce();
});
it("disposes stable GPU capture when encoder initialization fails", async () => {
  const dispose = vi.fn();
  mocks.bridge.mockResolvedValue({ canvas: canvas(), dispose, update: vi.fn() });
  mocks.start.mockRejectedValueOnce(new Error("startup failed"));
  await expect(createLiveVideoCapture(canvas(), 60, "webm", new AbortController().signal, vi.fn())).rejects.toThrow("startup failed");
  expect(dispose).toHaveBeenCalledOnce();
});
it("propagates a later stable frame readback failure and releases the encoder", async () => {
  vi.useFakeTimers();
  const dispose = vi.fn();
  mocks.bridge.mockResolvedValue({ canvas: canvas(), dispose, update: vi.fn().mockRejectedValue(new Error("GPU lost")) });
  const capture = await createLiveVideoCapture(canvas(), 60, "webm", new AbortController().signal, vi.fn());
  const rejected = expect(capture.result).rejects.toThrow("GPU lost");
  await vi.advanceTimersByTimeAsync(17);
  await rejected;
  expect(dispose).toHaveBeenCalledOnce();
  expect(mocks.cancel).toHaveBeenCalledOnce();
});
it.each(["mp4", "webm"] as const)("encodes %s at explicit quality and releases the track on stop", async format => {
  const capture = await createLiveVideoCapture(canvas(), 60, format, new AbortController().signal);
  expect(mocks.config?.codec).toBe(format === "mp4" ? "avc" : "vp9");
  expect(mocks.config?.quality).toMatchObject({ options: { quantizer: 12 } });
  expect(mocks.config?.hardwareAcceleration).toBeUndefined();
  expect(mocks.config?.transform).toEqual({ width: format === "mp4" ? 816 : 815, height: format === "mp4" ? 460 : 459, fit: "fill" });
  capture.stop(); capture.stop();
  expect((await capture.result).type).toBe(`video/${format}`);
  expect(mocks.finalize).toHaveBeenCalledOnce();
  expect(mocks.stopTrack).not.toHaveBeenCalled();
});
it("retains the original MP4 pixel preprocessing at even preview dimensions", async () => {
  const preview = canvas();
  preview.width = 816;
  preview.height = 458;
  const capture = await createLiveVideoCapture(preview, 60, "mp4", new AbortController().signal);
  expect(mocks.config?.transform).toEqual({ width: 816, height: 458, fit: "fill" });
  expect(mocks.config?.quality).toMatchObject({ options: { quantizer: 12 } });
  expect(mocks.config?.hardwareAcceleration).toBeUndefined();
  capture.stop();
  await capture.result;
});

it("rounds an odd MP4 height when the width already matches", async () => {
  const preview = canvas();
  preview.width = 816;
  const capture = await createLiveVideoCapture(preview, 60, "mp4", new AbortController().signal);
  expect(mocks.config?.transform).toEqual({ width: 816, height: 460, fit: "fill" });
  capture.stop();
  await capture.result;
});

it("falls back to VP8 when VP9 encoding is unavailable", async () => {
  mocks.canEncode.mockResolvedValue(false);
  const capture = await createLiveVideoCapture(canvas(), 30, "webm", new AbortController().signal);
  expect(mocks.config?.codec).toBe("vp8");
  capture.stop(); await capture.result;
});
it("rejects a header-only recording with no encoded frames", async () => {
  mocks.finalize.mockResolvedValue(undefined);
  const capture = await createLiveVideoCapture(canvas(), 30, "mp4", new AbortController().signal);
  capture.stop();
  await expect(capture.result).rejects.toThrow("captured no frames");
  expect(mocks.close).toHaveBeenCalledOnce();
});
it("discards media and releases tracks when cancelled", async () => {
  const controller = new AbortController();
  const capture = await createLiveVideoCapture(canvas(), 30, "mp4", controller.signal);
  controller.abort(new Error("Recording cancelled"));
  await expect(capture.result).rejects.toThrow("Recording cancelled");
  expect(mocks.cancel).toHaveBeenCalledOnce();
  expect(mocks.stopTrack).not.toHaveBeenCalled();
});
it("propagates encoder errors and cleans up", async () => {
  mocks.add.mockRejectedValueOnce(new Error("encoder failed"));
  const capture = await createLiveVideoCapture(canvas(), 30, "webm", new AbortController().signal);
  await expect(capture.result).rejects.toThrow("encoder failed");
  expect(mocks.cancel).toHaveBeenCalledOnce();
});
it("cleans up when initialization fails", async () => {
  mocks.start.mockRejectedValueOnce(new Error("setup failed"));
  await expect(createLiveVideoCapture(canvas(), 30, "mp4", new AbortController().signal)).rejects.toThrow("setup failed");
  expect(mocks.cancel).toHaveBeenCalledOnce();
});
it("does not open a stream when already cancelled", async () => {
  const source = canvas();
  const controller = new AbortController(); controller.abort(new Error("cancelled"));
  await expect(createLiveVideoCapture(source, 30, "mp4", controller.signal)).rejects.toThrow("cancelled");
  expect(source.captureStream).not.toHaveBeenCalled();
});
it("propagates finalization failures", async () => {
  mocks.finalize.mockRejectedValueOnce(new Error("mux failed"));
  const capture = await createLiveVideoCapture(canvas(), 30, "mp4", new AbortController().signal);
  capture.stop();
  await expect(capture.result).rejects.toThrow("mux failed");
  expect(mocks.close).toHaveBeenCalledOnce();
});
it("rejects empty encoder output", async () => {
  mocks.target.buffer = null;
  const capture = await createLiveVideoCapture(canvas(), 30, "mp4", new AbortController().signal);
  capture.stop();
  await expect(capture.result).rejects.toThrow("captured no frames");
});
