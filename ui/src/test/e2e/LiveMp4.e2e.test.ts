import { expect, it } from "vitest";
import type { RenderingEngine } from "../../../../rendering/src/types/RenderingEngine";
import { ShaderRecorder } from "../../lib/recording/ShaderRecorder";
import raySpheres from "../../../../tests/fixtures/capture/ray-spheres.glsl?raw";
import { decodeVideoFrames, glslInfo, lumaPsnr, psnr, renderReference } from "./captureMediaHelpers";

it.each(["mp4", "webm"] as const)("keeps Aurora gradients smooth in Live %s", async format => {
  const canvas = document.createElement("canvas");
  canvas.width = 816;
  canvas.height = 458;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;
  const reference = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const offset = (y * canvas.width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const uv = c === 1 ? (canvas.height - y - 0.5) / canvas.height : (x + 0.5) / canvas.width;
        reference.data[offset + c] = Math.round(255 * (0.5 + 0.5 * Math.cos(1.4 + uv + c * 2)));
      }
      reference.data[offset + 3] = 255;
    }
  }
  ctx.putImageData(reference, 0, 0);
  const recorder = new ShaderRecorder();
  const recording = recorder.recordLive(
    { mode: "live", format, width: canvas.width, height: canvas.height, fps: 60, duration: 1, startTime: 0 },
    { getCanvas: () => canvas } as RenderingEngine,
  );
  let tick = 0;
  const interval = setInterval(() => {
    ctx.putImageData(reference, 0, 0);
    ctx.fillStyle = tick++ % 2 ? "white" : "black";
    ctx.fillRect(0, 0, 1, 1);
  }, 1000 / 60);
  try {
    await new Promise(resolve => setTimeout(resolve, 1100));
    recorder.stopLiveRecording();
    const blob = await recording;
    const decoded = await decodeVideoFrames(blob, [0.1]);
    if (format === "mp4") {
      expect(decoded.duration).toBeGreaterThanOrEqual(0.8);
    }
    // RGB catches chroma blocks that a luma-only quality test can miss.
    expect(psnr(decoded.frames[0], reference)).toBeGreaterThanOrEqual(42);
  } finally {
    clearInterval(interval);
    canvas.remove();
    recorder.cancel();
  }
}, 30_000);

it("preserves fine detail in Live MP4 and seeks backwards through the saved file", async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 1920;
  canvas.height = 1080;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;
  const reference = await renderReference(glslInfo(raySpheres), canvas.width, canvas.height, 1);
  const recorder = new ShaderRecorder();
  ctx.putImageData(reference, 0, 0);
  const recording = recorder.recordLive(
    { mode: "live", format: "mp4", width: canvas.width, height: canvas.height, fps: 30, duration: 1, startTime: 0 },
    { getCanvas: () => canvas } as RenderingEngine,
  );
  let tick = 0;
  const interval = setInterval(() => {
    ctx.putImageData(reference, 0, 0);
    ctx.fillStyle = tick++ % 2 ? "white" : "black";
    ctx.fillRect(0, 0, 1, 1);
  }, 1000 / 30);
  try {
    await new Promise(resolve => setTimeout(resolve, 1100));
    recorder.stopLiveRecording();
    const blob = await recording;
    const { Input, BlobSource, MP4 } = await import("mediabunny");
    const input = new Input({ source: new BlobSource(blob), formats: [MP4] });
    const duration = await input.computeDuration();
    input.dispose();
    const decoded = await decodeVideoFrames(blob, [duration * 0.8, duration * 0.1]);
    expect([decoded.width, decoded.height]).toEqual([1920, 1080]);
    expect(decoded.duration).toBeGreaterThan(0);
    expect(duration).toBeGreaterThanOrEqual(0.8);
    for (const frame of decoded.frames) {
      expect(lumaPsnr(frame, reference)).toBeGreaterThanOrEqual(28);
    }
  } finally {
    clearInterval(interval);
    canvas.remove();
    recorder.cancel();
  }
}, 30_000);
