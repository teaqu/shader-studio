import { automaticVideoBitrate } from "./VideoEncoder";
import { createLivePreviewCanvas } from "./LivePreviewCanvas";
import type { VideoEncodingConfig } from "mediabunny";

export interface LiveVideoCapture {
  result: Promise<Blob>;
  stop(): void;
}

/** Encode the existing preview with explicit quality instead of MediaRecorder's rate control. */
export async function createLiveVideoCapture(canvas: HTMLCanvasElement, fps: number, format: "mp4" | "webm", signal: AbortSignal, captureFrame?: () => Promise<ImageData>): Promise<LiveVideoCapture> {
  const { Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource, Quality, canEncodeVideo } = await import("mediabunny");
  signal.throwIfAborted();
  const width = canvas.width + (format === "mp4" ? canvas.width % 2 : 0);
  const height = canvas.height + (format === "mp4" ? canvas.height % 2 : 0);
  const quality = new Quality({ quantizer: 12, bitrate: automaticVideoBitrate({ width, height, fps }) });
  const codec = format === "mp4" ? "avc" : await canEncodeVideo("vp9", { width, height, quality, frameRate: fps }) ? "vp9" : "vp8";
  signal.throwIfAborted();
  const stable = captureFrame ? await createLivePreviewCanvas(canvas, captureFrame, signal) : undefined;
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
    // Direct samples keep quality latency and avoid browser-stream RGB-to-YUV conversion.
    const source = new CanvasSource(stable?.canvas ?? canvas, encoding);
    // Live samples use real elapsed time; a fixed frameRate would snap timestamps.
    output.addVideoTrack(source);
    await output.start();
    signal.throwIfAborted();
    const began = performance.now();
    let first = true;
    let nextFrame = 0;
    const add = () => {
      // Stay on the requested clock, skipping missed slots when capture is slow.
      nextFrame = Math.max(nextFrame + 1, Math.floor((performance.now() - began) * fps / 1000) + 1);
      const deadline = began + nextFrame * 1000 / fps;
      pending = (async () => {
        if (!first) {
          await stable?.update();
        }
        const timestamp = first ? 0 : (performance.now() - began) / 1000;
        first = false;
        if (settled) {
          return;
        }
        await source.add(timestamp, 1 / fps);
      })();
      void pending.then(() => {
        if (!settled && !stopping) {
          // Readback and encoding are part of the frame budget, not extra delay.
          timer = setTimeout(add, Math.max(0, deadline - performance.now()));
        }
      }, error => fail(error));
    };
    add();
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
