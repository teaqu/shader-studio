import { automaticVideoBitrate } from "./VideoEncoder";
import { createLivePreviewCanvas } from "./LivePreviewCanvas";
import type { VideoEncodingConfig } from "mediabunny";

export interface LiveVideoCapture {
  result: Promise<Blob>;
  stop(): void;
}

/** Encode the existing preview with explicit quality instead of MediaRecorder's rate control. */
export async function createLiveVideoCapture(canvas: HTMLCanvasElement, fps: number, format: "mp4" | "webm", signal: AbortSignal, captureFrame?: () => Promise<ImageData>): Promise<LiveVideoCapture> {
  const { Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource, MediaStreamVideoTrackSource, Quality, canEncodeVideo } = await import("mediabunny");
  signal.throwIfAborted();
  const width = canvas.width + (format === "mp4" ? canvas.width % 2 : 0);
  const height = canvas.height + (format === "mp4" ? canvas.height % 2 : 0);
  const quality = new Quality({ quantizer: 12, bitrate: automaticVideoBitrate({ width, height, fps }) });
  const codec = format === "mp4" ? "avc" : await canEncodeVideo("vp9", { width, height, quality, frameRate: fps }) ? "vp9" : "vp8";
  signal.throwIfAborted();
  const stable = captureFrame ? await createLivePreviewCanvas(canvas, captureFrame, fps, signal) : undefined;
  let stream: MediaStream | undefined;
  try {
    if (format === "webm") {
      stream = (stable?.canvas ?? canvas).captureStream(fps);
    }
  } catch (error) {
    stable?.dispose();
    throw error;
  }
  const target = new BufferTarget();
  const output = new Output({ target, format: format === "mp4" ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat() });
  let resolve!: (blob: Blob) => void;
  let reject!: (reason: unknown) => void;
  const result = new Promise<Blob>((res, rej) => {
    resolve = res; reject = rej;
  });
  // Setup can fail before the caller receives result.
  void result.catch(() => {});
  let settled = false;
  let stopping = false;
  let packetCount = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> = Promise.resolve();
  const release = () => {
    clearTimeout(timer);
    stable?.dispose();
    signal.removeEventListener("abort", abort);
    for (const track of stream?.getTracks() ?? []) {
      track.stop();
    }
  };
  const fail = async (error: unknown) => {
    if (settled) {
      return;
    }
    settled = true;
    release();
    try {
      if (output.state !== "finalized") {
        await output.cancel();
      }
    } catch { /* Preserve the original capture error. */ }
    reject(error);
  };
  const abort = () => {
    void fail(signal.reason);
  };
  signal.addEventListener("abort", abort, { once: true });
  void stable?.error.catch(error => fail(error));
  try {
    const track = stream?.getVideoTracks()[0];
    if (stream && !track) {
      throw new Error("Live recording captured no video track");
    }
    const encoding: VideoEncodingConfig = {
      codec,
      quality,
      latencyMode: "quality",
      contentHint: "detail",
      onEncodedPacket: () => {
        packetCount++;
      },
      transform: { width, height, fit: "fill" as const },
    };
    // A browser video track first converts RGB to YUV and forces realtime
    // latency. Direct canvas samples retain the requested quality latency.
    const source = stream
      ? new MediaStreamVideoTrackSource(track!, encoding, { frameRate: fps, timestampBase: "zero" })
      : new CanvasSource(stable?.canvas ?? canvas, encoding);
    output.addVideoTrack(source, { frameRate: fps });
    if (source instanceof MediaStreamVideoTrackSource) {
      void source.errorPromise.catch(error => fail(error));
    }
    await output.start();
    signal.throwIfAborted();
    if (source instanceof CanvasSource) {
      const began = performance.now();
      const add = () => {
        // Await each sample before scheduling another: encoder backpressure
        // cannot accumulate a queue or overlap additions.
        pending = source.add((performance.now() - began) / 1000, 1 / fps);
        void pending.then(() => {
          if (!settled && !stopping) {
            timer = setTimeout(add, 1000 / fps);
          }
        }, error => fail(error));
      };
      add();
    }
    return {
      result,
      stop() {
        if (settled || stopping) {
          return;
        }
        stopping = true;
        clearTimeout(timer);
        void (async () => {
          try {
            await pending;
            if (settled) {
              return;
            }
            source.close();
            await output.finalize();
            signal.throwIfAborted();
            if (!packetCount || !target.buffer?.byteLength) {
              throw new Error("Live recording captured no frames from the preview");
            }
            settled = true;
            release();
            resolve(new Blob([target.buffer], { type: `video/${format}` }));
          } catch (error) {
            await fail(error);
          }
        })();
      },
    };
  } catch (error) {
    await fail(error);
    throw error;
  }
}
