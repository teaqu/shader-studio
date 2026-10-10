import { BufferTarget, CanvasSource, Mp4OutputFormat, Output } from "mediabunny";

export interface LiveMp4Capture {
  result: Promise<Blob>;
  stop(): void;
}

function captureCanvas(canvas: HTMLCanvasElement): { canvas: HTMLCanvasElement; copy?: () => void } {
  if (canvas.width % 2 === 0 && canvas.height % 2 === 0) {
    return { canvas };
  }
  const evenCanvas = document.createElement("canvas");
  evenCanvas.width = canvas.width + canvas.width % 2;
  evenCanvas.height = canvas.height + canvas.height % 2;
  const context = evenCanvas.getContext("2d");
  if (!context) {
    throw new Error("Live MP4 recording could not create a capture canvas");
  }
  return { canvas: evenCanvas, copy: () => context.drawImage(canvas, 0, 0) };
}

/** AVC fallback for hosts whose native MediaRecorder cannot write MP4. */
export async function createLiveMp4Capture(canvas: HTMLCanvasElement, signal: AbortSignal): Promise<LiveMp4Capture> {
  signal.throwIfAborted();
  const target = new BufferTarget();
  let source: CanvasSource | undefined;
  let output: Output | undefined;
  let frame: number | undefined;
  let settled = false;
  let stopping = false;
  let pending = false;
  let pendingEncode: Promise<void> = Promise.resolve();
  let encodedFrames = 0;
  let resolve!: (blob: Blob) => void;
  let reject!: (error: unknown) => void;
  const result = new Promise<Blob>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  void result.catch(() => {});
  const cancelFrame = () => {
    if (frame !== undefined) {
      cancelAnimationFrame(frame);
    }
  };
  const release = () => {
    cancelFrame();
    signal.removeEventListener("abort", abort);
  };
  const fail = async (error: unknown) => {
    if (settled) {
      return;
    }
    settled = true;
    release();
    try {
      await output?.cancel();
    } catch { /* Preserve the original capture error. */ }
    reject(error);
  };
  const abort = () => {
    void fail(signal.reason);
  };
  try {
    const capture = captureCanvas(canvas);
    source = new CanvasSource(capture.canvas, { codec: "avc", bitrate: 8_000_000 });
    output = new Output({ target, format: new Mp4OutputFormat() });
    output.addVideoTrack(source);
    signal.addEventListener("abort", abort, { once: true });
    await output.start();
    signal.throwIfAborted();
    let beganAt: number | undefined;
    const encode = (timestamp: number) => {
      if (settled || stopping) {
        return;
      }
      frame = requestAnimationFrame(encode);
      if (pending) {
        return;
      }
      pending = true;
      beganAt ??= timestamp;
      try {
        capture.copy?.();
        pendingEncode = source!.add((timestamp - beganAt) / 1000).then(() => {
          encodedFrames++;
        }, error => {
          void fail(error);
        }).finally(() => {
          pending = false;
        });
      } catch (error) {
        pending = false;
        void fail(error);
      }
    };
    frame = requestAnimationFrame(encode);
    return {
      result,
      stop() {
        if (settled || stopping) {
          return;
        }
        stopping = true;
        cancelFrame();
        void (async () => {
          try {
            await pendingEncode;
            if (settled) {
              return;
            }
            source!.close();
            await output!.finalize();
            signal.throwIfAborted();
            if (encodedFrames === 0 || !target.buffer?.byteLength) {
              throw new Error("Live recording captured no frames from the preview");
            }
            settled = true;
            resolve(new Blob([target.buffer], { type: "video/mp4" }));
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
