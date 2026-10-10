import { createLivePreviewCanvas } from "./LivePreviewCanvas";
import { liveVideoMimeType } from "./liveVideoFormats";

export interface LiveVideoCapture {
  result: Promise<Blob>;
  stop(): void;
}

/** Browser-native Live recording, with Shadertoy's 8 Mbps bitrate request. */
export async function createLiveVideoCapture(canvas: HTMLCanvasElement, format: "mp4" | "webm", signal: AbortSignal, captureFrame?: () => Promise<ImageData>): Promise<LiveVideoCapture> {
  signal.throwIfAborted();
  const mimeType = liveVideoMimeType(format);
  if (!mimeType) {
    throw new Error(`${format.toUpperCase()} Live recording is not supported by this host`);
  }
  const stable = captureFrame ? await createLivePreviewCanvas(canvas, captureFrame, signal) : undefined;
  let stream: MediaStream | undefined;
  let recorder: MediaRecorder | undefined;
  let frame: number | undefined;
  let settled = false;
  let stopping = false;
  let resolve!: (blob: Blob) => void;
  let reject!: (error: unknown) => void;
  const result = new Promise<Blob>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  void result.catch(() => {});
  const release = () => {
    if (frame !== undefined) {
      cancelAnimationFrame(frame);
    }
    stable?.dispose();
    signal.removeEventListener("abort", abort);
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
    }
    for (const track of stream?.getTracks() ?? []) {
      track.stop();
    }
  };
  const fail = (error: unknown) => {
    if (settled) {
      return;
    }
    settled = true;
    release();
    try {
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
    } catch { /* Preserve the original capture error. */ }
    reject(error);
  };
  const abort = () => fail(signal.reason);
  try {
    signal.throwIfAborted();
    stream = (stable?.canvas ?? canvas).captureStream();
    recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 0, videoBitsPerSecond: 8_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = event => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    recorder.onerror = () => fail(new Error("Live video encoding failed"));
    recorder.onstop = () => {
      if (chunks.length === 0) {
        fail(new Error("Live recording captured no frames from the preview. If the preview is blank, reload it and try again."));
        return;
      }
      settled = true;
      const blob = new Blob(chunks, { type: recorder!.mimeType || mimeType });
      release();
      resolve(blob);
    };
    signal.addEventListener("abort", abort, { once: true });
    recorder.start();
    // WebGPU swap-chain canvases may be cleared before captureStream reads them.
    // Refresh one stable canvas from completed frames, with one readback at a time.
    let updating = false;
    const refresh = async () => {
      if (settled || stopping) {
        return;
      }
      frame = requestAnimationFrame(() => void refresh());
      if (updating) {
        return;
      }
      updating = true;
      try {
        await stable?.update();
      } catch (error) {
        fail(error);
      } finally {
        updating = false;
      }
    };
    if (stable) {
      frame = requestAnimationFrame(() => void refresh());
    }
    return {
      result,
      stop() {
        if (!settled && !stopping) {
          stopping = true;
          try {
            recorder!.stop();
          } catch (error) {
            fail(error);
          }
        }
      },
    };
  } catch (error) {
    fail(error);
    throw error;
  }
}
