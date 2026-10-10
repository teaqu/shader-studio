import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveMp4Capture } from "../../lib/recording/LiveMp4Capture";

const mocks = vi.hoisted(() => {
  const outputs: Array<{ target: { buffer?: ArrayBuffer }; start: ReturnType<typeof vi.fn>; addVideoTrack: ReturnType<typeof vi.fn>; finalize: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }> = [];
  const sources: Array<{ add: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }> = [];
  class BufferTarget {
    buffer?: ArrayBuffer;
  }
  class Mp4OutputFormat {
  }
  class CanvasSource {
    add = vi.fn().mockResolvedValue(undefined);
    close = vi.fn();
    constructor(canvas: HTMLCanvasElement, config: unknown) {
      mocks.canvases.push(canvas);
      mocks.configs.push(config);
      sources.push(this);
    }
  }
  class Output {
    start = vi.fn(async () => {
      if (mocks.startError) {
        throw mocks.startError;
      }
    });
    addVideoTrack = vi.fn();
    finalize = vi.fn(async () => {
      await mocks.finalizePending;
      this.target.buffer = new Uint8Array([1, 2, 3]).buffer;
    });
    cancel = vi.fn().mockResolvedValue(undefined);
    target: BufferTarget;
    constructor(options: { target: BufferTarget }) {
      this.target = options.target;
      outputs.push(this);
    }
  }
  return { BufferTarget, Mp4OutputFormat, CanvasSource, Output, outputs, sources, canvases: [] as HTMLCanvasElement[], configs: [] as unknown[], startError: undefined as Error | undefined, finalizePending: undefined as Promise<void> | undefined };
});
vi.mock("mediabunny", () => mocks);

function canvas(width = 640, height = 360): HTMLCanvasElement {
  return { width, height } as HTMLCanvasElement;
}

describe("Live MP4 fallback capture", () => {
  let callbacks: FrameRequestCallback[];
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.outputs.length = 0;
    mocks.sources.length = 0;
    mocks.canvases.length = 0;
    mocks.configs.length = 0;
    mocks.startError = undefined;
    mocks.finalizePending = undefined;
    callbacks = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses plain AVC at 8 Mbps and real animation-frame timestamps", async () => {
    const capture = await createLiveMp4Capture(canvas(), new AbortController().signal);
    expect(mocks.configs[0]).toEqual({ codec: "avc", bitrate: 8_000_000 });
    callbacks[0]?.(1000);
    await Promise.resolve();
    await Promise.resolve();
    callbacks[1]?.(1016);
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.sources[0]?.add).toHaveBeenNthCalledWith(1, 0);
    expect(mocks.sources[0]?.add).toHaveBeenNthCalledWith(2, 0.016);

    capture.stop();
    await expect(capture.result).resolves.toMatchObject({ type: "video/mp4", size: 3 });
  });

  it("skips frames while the previous encode is pending", async () => {
    let done!: () => void;
    const capture = await createLiveMp4Capture(canvas(), new AbortController().signal);
    mocks.sources[0]!.add.mockImplementationOnce(() => new Promise<void>(resolve => {
      done = resolve;
    }));
    callbacks[0]?.(10);
    callbacks[1]?.(20);
    expect(mocks.sources[0]?.add).toHaveBeenCalledOnce();
    done();
    await Promise.resolve();
    await Promise.resolve();
    callbacks[2]?.(30);
    expect(mocks.sources[0]?.add).toHaveBeenCalledTimes(2);
    capture.stop();
    await capture.result;
  });

  it("cancels the encoder when recording is aborted", async () => {
    const controller = new AbortController();
    const capture = await createLiveMp4Capture(canvas(), controller.signal);
    controller.abort(new Error("cancelled"));
    await expect(capture.result).rejects.toThrow("cancelled");
    expect(mocks.outputs[0]?.cancel).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
  });

  it("rejects if it is stopped before a frame was encoded", async () => {
    const capture = await createLiveMp4Capture(canvas(), new AbortController().signal);
    capture.stop();
    await expect(capture.result).rejects.toThrow("captured no frames");
  });

  it("releases the output if setup fails", async () => {
    mocks.startError = new Error("setup failed");
    await expect(createLiveMp4Capture(canvas(), new AbortController().signal)).rejects.toThrow("setup failed");
    expect(mocks.outputs[0]?.cancel).toHaveBeenCalledOnce();
  });

  it("cancels after an encoding error", async () => {
    const capture = await createLiveMp4Capture(canvas(), new AbortController().signal);
    mocks.sources[0]!.add.mockRejectedValueOnce(new Error("encode failed"));
    callbacks[0]?.(10);
    await expect(capture.result).rejects.toThrow("encode failed");
    expect(mocks.outputs[0]?.cancel).toHaveBeenCalledOnce();
  });

  it("stops once when called repeatedly", async () => {
    const capture = await createLiveMp4Capture(canvas(), new AbortController().signal);
    callbacks[0]?.(0);
    await Promise.resolve();
    await Promise.resolve();
    capture.stop();
    capture.stop();
    await capture.result;
    expect(mocks.outputs[0]?.finalize).toHaveBeenCalledOnce();
  });

  it("pads odd canvas dimensions before encoding", async () => {
    const drawImage = vi.fn();
    vi.spyOn(document, "createElement").mockReturnValue({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
    } as unknown as HTMLCanvasElement);
    const capture = await createLiveMp4Capture(canvas(641, 361), new AbortController().signal);
    expect(mocks.canvases[0]).toMatchObject({ width: 642, height: 362 });
    callbacks[0]?.(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0);
    capture.stop();
    await capture.result;
  });

  it("rejects if an odd canvas cannot create a 2D capture context", async () => {
    vi.spyOn(document, "createElement").mockReturnValue({
      getContext: () => null,
    } as unknown as HTMLCanvasElement);
    await expect(createLiveMp4Capture(canvas(641, 361), new AbortController().signal)).rejects.toThrow("could not create a capture canvas");
  });

  it("cancels if adding a frame throws synchronously", async () => {
    const capture = await createLiveMp4Capture(canvas(), new AbortController().signal);
    mocks.sources[0]!.add.mockImplementationOnce(() => {
      throw new Error("sync encode failed");
    });
    callbacks[0]?.(0);
    await expect(capture.result).rejects.toThrow("sync encode failed");
    expect(mocks.outputs[0]?.cancel).toHaveBeenCalledOnce();
  });

  it("cancels an in-progress finalization when the recording is aborted", async () => {
    let finishFinalize!: () => void;
    mocks.finalizePending = new Promise<void>(resolve => {
      finishFinalize = resolve;
    });
    const controller = new AbortController();
    const capture = await createLiveMp4Capture(canvas(), controller.signal);
    callbacks[0]?.(0);
    await Promise.resolve();
    await Promise.resolve();
    capture.stop();
    await Promise.resolve();
    controller.abort(new Error("cancelled while finalizing"));
    await expect(capture.result).rejects.toThrow("cancelled while finalizing");
    expect(mocks.outputs[0]?.cancel).toHaveBeenCalledOnce();
    finishFinalize();
  });
});
