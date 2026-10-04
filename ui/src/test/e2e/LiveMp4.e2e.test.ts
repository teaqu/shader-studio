import { expect, it } from "vitest";
import type { RenderingEngine } from "../../../../rendering/src/types/RenderingEngine";
import { ShaderRecorder } from "../../lib/recording/ShaderRecorder";
import raySpheres from "../../../../tests/fixtures/capture/ray-spheres.glsl?raw";
import { decodeVideoFrames, glslInfo, lumaPsnr, psnr, renderReference } from "./captureMediaHelpers";
import { encodeBt709I420Diagnostic } from "./bt709I420Diagnostic";

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
  const originalEncoder = globalThis.VideoEncoder;
  const configurations: VideoEncoderConfig[] = [];
  let sample: { format: string | null; colorSpace: VideoColorSpaceInit; options: VideoEncoderEncodeOptions | undefined } | undefined;
  let decoder: VideoDecoderConfig | undefined;
  if (format === "mp4") {
    globalThis.VideoEncoder = class extends originalEncoder {
      constructor(init: VideoEncoderInit) {
        super({ ...init, output: (chunk, metadata) => {
          if (metadata?.decoderConfig?.codedWidth === canvas.width) {
            const { codec, codedWidth, codedHeight, colorSpace } = metadata.decoderConfig;
            decoder = { codec, codedWidth, codedHeight, colorSpace };
          }
          init.output(chunk, metadata);
        } });
      }
      configure(config: VideoEncoderConfig) {
        configurations.push({ ...config });
        super.configure(config);
      }
      encode(frame: VideoFrame, options?: VideoEncoderEncodeOptions) {
        if (frame.displayWidth === canvas.width) {
          sample = { format: frame.format, colorSpace: frame.colorSpace.toJSON(), options };
        }
        super.encode(frame, options);
      }
    };
  }
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
      const measureChannels = (frame: ImageData) => [0, 1, 2].map(channel => {
        let bias = 0;
        let mse = 0;
        let maximumError = 0;
        for (let pixel = channel; pixel < reference.data.length; pixel += 4) {
          const error = frame.data[pixel] - reference.data[pixel];
          bias += error;
          mse += error * error;
          maximumError = Math.max(maximumError, Math.abs(error));
        }
        const count = reference.width * reference.height;
        return { bias: bias / count, mse: mse / count, maximumError };
      });
      console.log("Live MP4 colour diagnostics", JSON.stringify({
        rgbPsnr: psnr(decoded.frames[0], reference), channels: measureChannels(decoded.frames[0]),
        copiedPsnr: psnr(decoded.copiedFrames[0], reference), copiedChannels: measureChannels(decoded.copiedFrames[0]),
        canvas: ctx.getContextAttributes(), configurations, sample, decoder,
        decoded: decoded.frameMetadata,
      }));
      const explicitBlob = await encodeBt709I420Diagnostic(reference, 60);
      const explicit = await decodeVideoFrames(explicitBlob, [.1]);
      console.log("Explicit BT709 I420 colour diagnostics", JSON.stringify({
        rgbPsnr: psnr(explicit.frames[0], reference), channels: measureChannels(explicit.frames[0]),
        copiedPsnr: psnr(explicit.copiedFrames[0], reference), copiedChannels: measureChannels(explicit.copiedFrames[0]),
        configurations, sample, decoder, decoded: explicit.frameMetadata,
      }));
    }
    // RGB catches chroma blocks that a luma-only quality test can miss.
    expect(psnr(decoded.frames[0], reference)).toBeGreaterThanOrEqual(42);
  } finally {
    clearInterval(interval);
    canvas.remove();
    recorder.cancel();
    globalThis.VideoEncoder = originalEncoder;
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
