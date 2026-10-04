import { ShaderRecorder } from "../../lib/recording/ShaderRecorder";
import type { ShaderInfo } from "../../lib/recording/types";

export function glslInfo(code: string, extra: Partial<ShaderInfo> = {}): ShaderInfo {
  return { code, config: null, path: "/fixture.glsl", buffers: {}, language: "glsl", ...extra };
}

export async function blobToImageData(blob: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d")!;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

/** Lossless reference for time `time` through the real Render screenshot path. */
export async function renderReference(info: ShaderInfo, width: number, height: number, time: number): Promise<ImageData> {
  const recorder = new ShaderRecorder();
  const png = await recorder.captureScreenshot({ mode: "render", format: "png", width, height, time }, info);
  return blobToImageData(png);
}

/** Decode frames of a saved video at the given presentation times (seconds). */
export async function decodeVideoFrames(blob: Blob, times: number[]): Promise<{ frames: ImageData[]; copiedFrames: ImageData[]; width: number; height: number; duration: number; frameMetadata: Array<{ format: string | null; colorSpace: VideoColorSpaceInit }> }> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error(`video decode failed: ${video.error?.message ?? "unknown"}`));
    });
    const canvas = new OffscreenCanvas(video.videoWidth, video.videoHeight);
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    const frames: ImageData[] = [];
    const copiedFrames: ImageData[] = [];
    const frameMetadata: Array<{ format: string | null; colorSpace: VideoColorSpaceInit }> = [];
    for (const time of times) {
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        video.currentTime = time;
      });
      context.drawImage(video, 0, 0);
      frames.push(context.getImageData(0, 0, canvas.width, canvas.height));
      if (typeof VideoFrame !== "undefined") {
        const frame = new VideoFrame(video, { timestamp: Math.round(time * 1e6) });
        try {
          frameMetadata.push({ format: frame.format, colorSpace: frame.colorSpace.toJSON() });
          const pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4);
          await frame.copyTo(pixels, { format: "RGBA", colorSpace: "srgb", rect: { x: 0, y: 0, width: canvas.width, height: canvas.height } });
          copiedFrames.push(new ImageData(pixels, canvas.width, canvas.height));
        } finally {
          frame.close();
        }
      }
    }
    return { frames, copiedFrames, width: video.videoWidth, height: video.videoHeight, duration: video.duration, frameMetadata };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** Peak signal-to-noise ratio over RGB, in dB (Infinity when identical). */
export function psnr(a: ImageData, b: ImageData): number {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  let sum = 0;
  let count = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = a.data[i + c] - b.data[i + c];
      sum += d * d;
      count++;
    }
  }
  const mse = sum / count;
  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
}

/** Luma (BT.601) PSNR in dB; compares detail independently of 4:2:0 chroma loss. */
export function lumaPsnr(a: ImageData, b: ImageData): number {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  let sum = 0;
  let count = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const ya = 0.299 * a.data[i] + 0.587 * a.data[i + 1] + 0.114 * a.data[i + 2];
    const yb = 0.299 * b.data[i] + 0.587 * b.data[i + 1] + 0.114 * b.data[i + 2];
    sum += (ya - yb) ** 2;
    count++;
  }
  const mse = sum / count;
  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
}
