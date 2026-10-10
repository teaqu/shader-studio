/** Holds stable WebGPU readbacks in a canvas that the browser can stream. */
export async function createLivePreviewCanvas(
  preview: HTMLCanvasElement,
  captureFrame: () => Promise<ImageData>,
  fps: number,
  signal: AbortSignal,
) {
  const canvas = document.createElement("canvas");
  canvas.width = preview.width;
  canvas.height = preview.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Live recording could not create a stable preview canvas");
  }
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reject!: (error: unknown) => void;
  const error = new Promise<never>((_resolve, fail) => {
    reject = fail;
  });
  void error.catch(() => {});
  const dispose = () => {
    stopped = true;
    clearTimeout(timer);
    signal.removeEventListener("abort", dispose);
  };
  const copy = async () => {
    const image = await captureFrame();
    if (stopped || signal.aborted) {
      return;
    }
    context.putImageData(image, 0, 0);
    // Schedule only after readback completes: at most one GPU copy is pending.
    timer = setTimeout(() => {
      void copy().catch(failure => {
        dispose(); reject(failure);
      });
    }, 1000 / fps);
  };
  signal.addEventListener("abort", dispose, { once: true });
  try {
    signal.throwIfAborted();
    await copy();
    signal.throwIfAborted();
    return { canvas, dispose, error };
  } catch (failure) {
    dispose();
    throw failure;
  }
}
