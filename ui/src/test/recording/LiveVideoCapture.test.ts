import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveVideoCapture } from "../../lib/recording/LiveVideoCapture";

const mocks = vi.hoisted(() => ({ bridge: vi.fn(), mimeType: vi.fn<(format: "mp4" | "webm") => string | null>() }));
vi.mock("../../lib/recording/LivePreviewCanvas", () => ({ createLivePreviewCanvas: mocks.bridge }));
vi.mock("../../lib/recording/liveVideoFormats", () => ({ liveVideoMimeType: mocks.mimeType }));

type NativeRecorder = {
  options: MediaRecorderOptions; state: RecordingState; mimeType: string;
  start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>;
  ondataavailable: ((event: BlobEvent) => void) | null; onstop: (() => void) | null; onerror: ((event: Event) => void) | null;
};

function installMediaRecorder(options: { startError?: Error; chunk?: Blob; stopImmediately?: boolean } = {}) {
  const tracks = [{ stop: vi.fn() }];
  const stream = { getTracks: () => tracks } as unknown as MediaStream;
  const recorders: NativeRecorder[] = [];
  class MockMediaRecorder {
    static isTypeSupported = vi.fn(() => true);
    state: RecordingState = "inactive";
    mimeType = "";
    ondataavailable: ((event: BlobEvent) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    start = vi.fn(() => {
      if (options.startError) {
        throw options.startError;
      }
      this.state = "recording";
    });
    stop = vi.fn(() => {
      this.state = "inactive";
      if (options.stopImmediately !== false) {
        this.ondataavailable?.({ data: options.chunk ?? new Blob(["video"]) } as BlobEvent);
        this.onstop?.();
      }
    });
    constructor(_stream: MediaStream, public options: MediaRecorderOptions) {
      this.mimeType = options.mimeType ?? "";
      recorders.push(this);
    }
  }
  vi.stubGlobal("MediaRecorder", MockMediaRecorder);
  return { stream, tracks, recorders };
}

function canvas(stream: MediaStream) {
  return { width: 948, height: 534, captureStream: vi.fn(() => stream) } as unknown as HTMLCanvasElement;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.mimeType.mockImplementation(format => `video/${format};codecs=test`);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("native Live video capture", () => {
  it.each(["mp4", "webm"] as const)("starts native %s at the fixed 8 Mbps budget", async format => {
    const native = installMediaRecorder();
    const preview = canvas(native.stream);
    const capture = await createLiveVideoCapture(preview, format, new AbortController().signal);
    expect(preview.captureStream).toHaveBeenCalledExactlyOnceWith();
    expect(native.recorders[0]?.options).toEqual({ mimeType: `video/${format};codecs=test`, audioBitsPerSecond: 0, videoBitsPerSecond: 8_000_000 });
    expect(native.recorders[0]?.start).toHaveBeenCalledOnce();
    capture.stop();
    await expect(capture.result).resolves.toMatchObject({ type: `video/${format};codecs=test` });
  });

  it("rejects an unsupported native format before opening a stream", async () => {
    mocks.mimeType.mockReturnValue(null);
    const native = installMediaRecorder();
    const preview = canvas(native.stream);
    await expect(createLiveVideoCapture(preview, "webm", new AbortController().signal)).rejects.toThrow("WEBM Live recording is not supported");
    expect(preview.captureStream).not.toHaveBeenCalled();
  });

  it("releases the stream when the native recorder start fails", async () => {
    const native = installMediaRecorder({ startError: new Error("start failed") });
    await expect(createLiveVideoCapture(canvas(native.stream), "mp4", new AbortController().signal)).rejects.toThrow("start failed");
    expect(native.tracks[0]?.stop).toHaveBeenCalledOnce();
  });

  it("rejects empty native output and releases its tracks", async () => {
    const native = installMediaRecorder({ chunk: new Blob([]) });
    const capture = await createLiveVideoCapture(canvas(native.stream), "webm", new AbortController().signal);
    capture.stop();
    await expect(capture.result).rejects.toThrow("captured no frames");
    expect(native.tracks[0]?.stop).toHaveBeenCalledOnce();
  });

  it("propagates a native encoder error and releases its tracks", async () => {
    const native = installMediaRecorder({ stopImmediately: false });
    const capture = await createLiveVideoCapture(canvas(native.stream), "webm", new AbortController().signal);
    native.recorders[0]?.onerror?.(new Event("error"));
    await expect(capture.result).rejects.toThrow("Live video encoding failed");
    expect(native.tracks[0]?.stop).toHaveBeenCalledOnce();
  });

  it("cancels an active native capture", async () => {
    const native = installMediaRecorder({ stopImmediately: false });
    const controller = new AbortController();
    const capture = await createLiveVideoCapture(canvas(native.stream), "mp4", controller.signal);
    controller.abort(new Error("cancelled"));
    await expect(capture.result).rejects.toThrow("cancelled");
    expect(native.recorders[0]?.stop).toHaveBeenCalledOnce();
    expect(native.tracks[0]?.stop).toHaveBeenCalledOnce();
  });

  it("waits for stop output before resolving and ignores a duplicate stop", async () => {
    const native = installMediaRecorder({ stopImmediately: false });
    const capture = await createLiveVideoCapture(canvas(native.stream), "webm", new AbortController().signal);
    capture.stop(); capture.stop();
    expect(native.recorders[0]?.stop).toHaveBeenCalledOnce();
    native.recorders[0]?.ondataavailable?.({ data: new Blob(["saved"]) } as BlobEvent);
    native.recorders[0]?.onstop?.();
    await expect(capture.result).resolves.toMatchObject({ size: 5 });
  });

  it("uses completed stable frames, stops its animation frame, and releases them after stop", async () => {
    const native = installMediaRecorder();
    const update = vi.fn().mockResolvedValue(undefined);
    const dispose = vi.fn();
    const stableCanvas = canvas(native.stream);
    mocks.bridge.mockResolvedValue({ canvas: stableCanvas, update, dispose });
    const request = vi.fn(() => 17);
    const cancel = vi.fn();
    vi.stubGlobal("requestAnimationFrame", request);
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const captureFrame = vi.fn();
    const capture = await createLiveVideoCapture(canvas(native.stream), "webm", new AbortController().signal, captureFrame);
    expect(mocks.bridge).toHaveBeenCalledWith(expect.anything(), captureFrame, expect.any(AbortSignal));
    expect(stableCanvas.captureStream).toHaveBeenCalledExactlyOnceWith();
    expect(request).toHaveBeenCalledOnce();
    capture.stop();
    await capture.result;
    expect(cancel).toHaveBeenCalledWith(17);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("keeps checking displayed frames while one readback is pending", async () => {
    const native = installMediaRecorder();
    let complete!: () => void;
    const update = vi.fn(() => new Promise<void>(resolve => {
      complete = resolve;
    }));
    mocks.bridge.mockResolvedValue({ canvas: canvas(native.stream), update, dispose: vi.fn() });
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback); return callbacks.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const capture = await createLiveVideoCapture(canvas(native.stream), "webm", new AbortController().signal, vi.fn());
    callbacks[0](0);
    expect(callbacks).toHaveLength(2);
    callbacks[1](16);
    expect(update).toHaveBeenCalledOnce();
    complete();
    await Promise.resolve();
    callbacks[2](32);
    expect(update).toHaveBeenCalledTimes(2);
    capture.stop();
    await capture.result;
    complete();
  });

  it("propagates a later stable frame readback failure", async () => {
    const native = installMediaRecorder({ stopImmediately: false });
    const stableCanvas = canvas(native.stream);
    const dispose = vi.fn();
    mocks.bridge.mockResolvedValue({ canvas: stableCanvas, update: vi.fn().mockRejectedValue(new Error("GPU lost")), dispose });
    let refresh!: FrameRequestCallback;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      refresh = callback;
      return 4;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const capture = await createLiveVideoCapture(canvas(native.stream), "mp4", new AbortController().signal, vi.fn());
    refresh(0);
    await expect(capture.result).rejects.toThrow("GPU lost");
    expect(dispose).toHaveBeenCalledOnce();
    expect(native.tracks[0]?.stop).toHaveBeenCalledOnce();
  });
});
