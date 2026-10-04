import { beforeEach, expect, it, vi } from "vitest";
import { createLiveVideoCapture } from "../../lib/recording/LiveVideoCapture";

const mocks = vi.hoisted(() => ({
  start: vi.fn(), finalize: vi.fn(), cancel: vi.fn(), close: vi.fn(), stopTrack: vi.fn(), canEncode: vi.fn(),
  config: null as Record<string, unknown> | null,
  target: { buffer: new ArrayBuffer(4) as ArrayBuffer | null },
  error: (_error: unknown) => {},
}));
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
    addVideoTrack() {}
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
  mocks.canEncode.mockResolvedValue(true);
});
function canvas() {
  const track = { stop: mocks.stopTrack };
  return { width: 815, height: 459, captureStream: vi.fn(() => ({ getVideoTracks: () => [track], getTracks: () => [track] })) } as unknown as HTMLCanvasElement;
}
it.each(["mp4", "webm"] as const)("encodes %s at explicit quality and releases the track on stop", async format => {
  const capture = await createLiveVideoCapture(canvas(), 60, format, new AbortController().signal);
  expect(mocks.config?.codec).toBe(format === "mp4" ? "avc" : "vp9");
  expect(mocks.config?.quality).toMatchObject({ options: { quantizer: 12 } });
  expect(mocks.config?.hardwareAcceleration).toBeUndefined();
  expect(mocks.config?.transform).toEqual({ width: format === "mp4" ? 816 : 815, height: format === "mp4" ? 460 : 459, fit: "fill" });
  capture.stop(); capture.stop();
  expect((await capture.result).type).toBe(`video/${format}`);
  expect(mocks.finalize).toHaveBeenCalledOnce();
  expect(mocks.stopTrack).toHaveBeenCalledOnce();
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
  expect(mocks.stopTrack).toHaveBeenCalledOnce();
});
it("discards media and releases tracks when cancelled", async () => {
  const controller = new AbortController();
  const capture = await createLiveVideoCapture(canvas(), 30, "mp4", controller.signal);
  controller.abort(new Error("Recording cancelled"));
  await expect(capture.result).rejects.toThrow("Recording cancelled");
  expect(mocks.cancel).toHaveBeenCalledOnce();
  expect(mocks.stopTrack).toHaveBeenCalledOnce();
});
it("propagates encoder errors and cleans up", async () => {
  const capture = await createLiveVideoCapture(canvas(), 30, "webm", new AbortController().signal);
  mocks.error(new Error("encoder failed"));
  await expect(capture.result).rejects.toThrow("encoder failed");
  expect(mocks.stopTrack).toHaveBeenCalledOnce();
});
it("cleans up when initialization fails", async () => {
  mocks.start.mockRejectedValueOnce(new Error("setup failed"));
  await expect(createLiveVideoCapture(canvas(), 30, "mp4", new AbortController().signal)).rejects.toThrow("setup failed");
  expect(mocks.stopTrack).toHaveBeenCalledOnce();
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
  expect(mocks.stopTrack).toHaveBeenCalledOnce();
});
it("rejects empty encoder output", async () => {
  mocks.target.buffer = null;
  const capture = await createLiveVideoCapture(canvas(), 30, "mp4", new AbortController().signal);
  capture.stop();
  await expect(capture.result).rejects.toThrow("captured no frames");
});
