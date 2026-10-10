import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createLivePreviewCanvas } from "../../lib/recording/LivePreviewCanvas";

const image = { width: 816, height: 458, data: new Uint8ClampedArray(4) } as ImageData;
let context: { putImageData: ReturnType<typeof vi.fn> };
let canvas: HTMLCanvasElement;
beforeEach(() => {
  vi.useFakeTimers();
  context = { putImageData: vi.fn() };
  canvas = { getContext: vi.fn(() => context) } as unknown as HTMLCanvasElement;
  vi.spyOn(document, "createElement").mockReturnValue(canvas);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const preview = () => ({ width: 816, height: 458 }) as HTMLCanvasElement;

it("copies a stable picture before recording and retains the original dimensions", async () => {
  const source = preview();
  const capture = vi.fn(async () => image);
  const stable = await createLivePreviewCanvas(source, capture, new AbortController().signal);
  expect(stable.canvas).toBe(canvas);
  expect([canvas.width, canvas.height]).toEqual([816, 458]);
  expect(context.putImageData).toHaveBeenCalledWith(image, 0, 0);
  source.width = 400;
  await stable.update!();
  expect(capture).toHaveBeenCalledTimes(2);
  expect([canvas.width, canvas.height]).toEqual([816, 458]);
  stable.dispose();
  await stable.update!();
  await vi.advanceTimersByTimeAsync(1000);
  expect(capture).toHaveBeenCalledTimes(2);
});

it("keeps one pending readback and ignores it after disposal", async () => {
  let resolve!: (value: ImageData) => void;
  const capture = vi.fn().mockResolvedValueOnce(image).mockImplementationOnce(() => new Promise<ImageData>(done => {
    resolve = done;
  }));
  const stable = await createLivePreviewCanvas(preview(), capture, new AbortController().signal);
  const pending = stable.update!();
  expect(capture).toHaveBeenCalledTimes(2);
  stable.dispose();
  resolve(image);
  await pending;
  expect(context.putImageData).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("cancels initialization while a first GPU readback is pending", async () => {
  let resolve!: (value: ImageData) => void;
  const controller = new AbortController();
  const starting = createLivePreviewCanvas(preview(), () => new Promise<ImageData>(done => {
    resolve = done;
  }), controller.signal);
  const rejected = expect(starting).rejects.toThrow("cancelled");
  controller.abort(new Error("cancelled"));
  resolve(image);
  await rejected;
  expect(context.putImageData).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("rejects an already cancelled recording without requesting a frame", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  const capture = vi.fn();
  await expect(createLivePreviewCanvas(preview(), capture, controller.signal)).rejects.toThrow("cancelled");
  expect(capture).not.toHaveBeenCalled();
});

it("reports an initial readback failure and schedules no further capture", async () => {
  await expect(createLivePreviewCanvas(preview(), vi.fn().mockRejectedValue(new Error("GPU lost")), new AbortController().signal)).rejects.toThrow("GPU lost");
  expect(vi.getTimerCount()).toBe(0);
});

it("surfaces later readback errors and stops the bounded capture loop", async () => {
  const capture = vi.fn().mockResolvedValueOnce(image).mockRejectedValueOnce(new Error("GPU lost"));
  const stable = await createLivePreviewCanvas(preview(), capture, new AbortController().signal);
  await expect(stable.update!()).rejects.toThrow("GPU lost");
  expect(vi.getTimerCount()).toBe(0);
  expect(context.putImageData).toHaveBeenCalledOnce();
});

it("reports a host that cannot create the stable canvas", async () => {
  vi.mocked(canvas.getContext).mockReturnValue(null);
  await expect(createLivePreviewCanvas(preview(), vi.fn(), new AbortController().signal)).rejects.toThrow("could not create a stable preview canvas");
});

 it("uses renderer frame copies after one startup readback instead of repeated CPU readbacks", async () => {
  const capture = vi.fn(async () => image);
  const detach = vi.fn();
  const attach = vi.fn(() => detach);
  const stable = await createLivePreviewCanvas(preview(), capture, new AbortController().signal, attach);
  expect(attach).toHaveBeenCalledWith(context);
  expect(stable.update).toBeUndefined();
  expect(capture).toHaveBeenCalledOnce();
  stable.dispose();
  stable.dispose();
  expect(detach).toHaveBeenCalledOnce();
 });
