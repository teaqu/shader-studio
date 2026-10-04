import { automaticVideoBitrate } from "./VideoEncoder";

export interface LiveVideoCapture {
  result: Promise<Blob>;
  stop(): void;
}

/** Encode the existing preview track with explicit quality instead of MediaRecorder's rate control. */
export async function createLiveVideoCapture(canvas: HTMLCanvasElement, fps: number, format: "mp4" | "webm", signal: AbortSignal): Promise<LiveVideoCapture> {
  const { Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, MediaStreamVideoTrackSource, Quality, canEncodeVideo } = await import("mediabunny");
  signal.throwIfAborted();
  const width = canvas.width + (format === "mp4" ? canvas.width % 2 : 0);
  const height = canvas.height + (format === "mp4" ? canvas.height % 2 : 0);
  // Keep WebM's previously validated encoder settings while MP4 quality is tuned.
  const bitrate = automaticVideoBitrate({ width, height, fps });
  const quality = new Quality({ quantizer: format === "webm" ? 12 : 0, bitrate });
  const codec = format === "mp4" ? "avc" : await canEncodeVideo("vp9", { width, height, quality, frameRate: fps }) ? "vp9" : "vp8";
  signal.throwIfAborted();
  const stream = canvas.captureStream(fps);
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
  const release = () => {
    signal.removeEventListener("abort", abort);
    for (const track of stream.getTracks()) {
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
  try {
    const track = stream.getVideoTracks()[0];
    if (!track) {
      throw new Error("Live recording captured no video track");
    }
    const source = new MediaStreamVideoTrackSource(track, {
      codec,
      quality,
      latencyMode: "quality",
      ...(format === "mp4" ? { hardwareAcceleration: "prefer-software" as const } : {}),
      contentHint: "detail",
      onEncodedPacket: () => {
        packetCount++;
      },
      transform: { width, height, fit: "fill" },
    }, { frameRate: fps, timestampBase: "zero" });
    output.addVideoTrack(source, { frameRate: fps });
    void source.errorPromise.catch(error => fail(error));
    await output.start();
    signal.throwIfAborted();
    return {
      result,
      stop() {
        if (settled || stopping) {
          return;
        }
        stopping = true;
        source.close();
        void (async () => {
          try {
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
