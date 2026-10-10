/** Keeps one stable readback canvas; the encoder controls when it is refreshed. */
export async function createLivePreviewCanvas(
  preview: HTMLCanvasElement,
  captureFrame: () => Promise<ImageData>,
  signal: AbortSignal,
  attach?: (context: CanvasRenderingContext2D) => () => void,
) {
  const canvas = document.createElement("canvas");
  canvas.width = preview.width;
  canvas.height = preview.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Live recording could not create a stable preview canvas");
  }
  let stopped = false;
  let detach: (() => void) | undefined;
  const dispose = () => {
    stopped = true;
    detach?.();
    detach = undefined;
    signal.removeEventListener("abort", dispose);
  };
  const update = async () => {
    signal.throwIfAborted();
    if (stopped) {
      return;
    }
    const image = await captureFrame();
    if (stopped || signal.aborted) {
      return;
    }
    context.putImageData(image, 0, 0);
  };
  signal.addEventListener("abort", dispose, { once: true });
  try {
    signal.throwIfAborted();
    await update();
    signal.throwIfAborted();
    detach = attach?.(context);
    return { canvas, dispose, update: attach ? undefined : update };
  } catch (failure) {
    dispose();
    throw failure;
  }
}
