import { expect, it } from "vitest";
import type { RenderingEngine } from "../../../../rendering/src/types/RenderingEngine";
import { ShaderRecorder } from "../../lib/recording/ShaderRecorder";
import raySpheres from "../../../../tests/fixtures/capture/ray-spheres.glsl?raw";
import { decodeVideoFrames, glslInfo, lumaPsnr, psnr, renderReference } from "./captureMediaHelpers";
import { bt709I420Planes, encodeBt709I420Diagnostic, i420ToRgbaDiagnostic } from "./bt709I420Diagnostic";
import { patchMp4SpsColourDiagnostic } from "./spsColourDiagnostic";

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
  const packets: Array<{ bytes: number; samples: number; keyframes: number }> = [];
  let sample: { format: string | null; colorSpace: VideoColorSpaceInit; options: VideoEncoderEncodeOptions | undefined } | undefined;
  let decoder: VideoDecoderConfig | undefined;
  let avccHeader: number[] | undefined;
  if (format === "mp4") {
    globalThis.VideoEncoder = class extends originalEncoder {
      constructor(init: VideoEncoderInit) {
        super({ ...init, output: (chunk, metadata) => {
          const counts = packets[configurations.length - 1];
          if (counts) {
            counts.bytes += chunk.byteLength;
            counts.samples++;
            counts.keyframes += Number(chunk.type === "key");
          }
          if (metadata?.decoderConfig?.codedWidth === canvas.width) {
            const { codec, codedWidth, codedHeight, colorSpace } = metadata.decoderConfig;
            decoder = { codec, codedWidth, codedHeight, colorSpace };
            const description = metadata.decoderConfig.description;
            if (description) {
              const bytes = ArrayBuffer.isView(description)
                ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
                : new Uint8Array(description);
              avccHeader = Array.from(bytes.slice(0, 24));
            }
          }
          init.output(chunk, metadata);
        } });
      }
      configure(config: VideoEncoderConfig) {
        configurations.push({ ...config });
        packets.push({ bytes: 0, samples: 0, keyframes: 0 });
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
      const measurePlanes = (actual: Uint8Array, matrix: "bt709" | "smpte170m") => {
        const expected = bt709I420Planes(reference, matrix);
        const area = reference.width * reference.height;
        return [[0, area], [area, area * 5 / 4], [area * 5 / 4, area * 3 / 2]].map(([start, end]) => {
          let bias = 0; let mse = 0; let maximumError = 0;
          for (let offset = start; offset < end; offset++) {
            const error = actual[offset] - expected[offset];
            bias += error; mse += error * error; maximumError = Math.max(maximumError, Math.abs(error));
          }
          return { bias: bias / (end - start), mse: mse / (end - start), maximumError };
        });
      };
      const measureCpuRgb = (planes: Uint8Array, actual: ImageData) => (["bt709", "smpte170m"] as const).map(matrix => {
        const frame = i420ToRgbaDiagnostic(planes, reference.width, reference.height, matrix);
        return { matrix, rgbPsnr: psnr(frame, reference), channels: measureChannels(frame), versusBrowserPsnr: psnr(frame, actual) };
      });
      console.log("Live MP4 colour diagnostics", JSON.stringify({
        rgbPsnr: psnr(decoded.frames[0], reference), channels: measureChannels(decoded.frames[0]),
        copiedPsnr: psnr(decoded.copiedFrames[0], reference), copiedChannels: measureChannels(decoded.copiedFrames[0]),
        canvas: ctx.getContextAttributes(), configurations, sample, decoder,
        decoded: decoded.frameMetadata,
        packets, blobBytes: blob.size, avccHeader,
        yuvPlanes: decoded.nativePlanes[0] && measurePlanes(decoded.nativePlanes[0], decoded.frameMetadata[0].colorSpace.matrix === "smpte170m" ? "smpte170m" : "bt709"),
        cpuRgb: decoded.nativePlanes[0] && measureCpuRgb(decoded.nativePlanes[0], decoded.frames[0]),
      }));
      const explicitBlob = await encodeBt709I420Diagnostic(reference, 60);
      const explicit = await decodeVideoFrames(explicitBlob, [.1]);
      console.log("Explicit BT709 I420 colour diagnostics", JSON.stringify({
        rgbPsnr: psnr(explicit.frames[0], reference), channels: measureChannels(explicit.frames[0]),
        copiedPsnr: psnr(explicit.copiedFrames[0], reference), copiedChannels: measureChannels(explicit.copiedFrames[0]),
        configurations, sample, decoder, decoded: explicit.frameMetadata,
        packets, blobBytes: explicitBlob.size, avccHeader, yuvPlanes: explicit.nativePlanes[0] && measurePlanes(explicit.nativePlanes[0], "bt709"),
        cpuRgb: explicit.nativePlanes[0] && measureCpuRgb(explicit.nativePlanes[0], explicit.frames[0]),
      }));
      const primariesBlob = await patchMp4SpsColourDiagnostic(blob, "primaries", 1);
      const transferBlob = await patchMp4SpsColourDiagnostic(explicitBlob, "transfer", 1);
      for (const [kind, fixture] of [["originalPrimaries709", primariesBlob], ["explicitTransfer709", transferBlob]] as const) {
        const altered = await decodeVideoFrames(fixture, [.1]);
        console.log("SPS-only decoded colour diagnostics", JSON.stringify({ kind,
          rgbPsnr: psnr(altered.frames[0], reference), channels: measureChannels(altered.frames[0]),
          decoded: altered.frameMetadata, cpuRgb: measureCpuRgb(altered.nativePlanes[0], altered.frames[0]),
        }));
      }
      // Transport this small procedural fixture for decode-only comparison on another host.
      // It contains the generated gradient above; no workspace media or shader source.
      for (const [kind, fixture] of [["original", blob], ["explicit709", explicitBlob], ["originalPrimaries709", primariesBlob], ["explicitTransfer709", transferBlob]] as const) {
        const bytes = new Uint8Array(await fixture.arrayBuffer());
        console.log("Live MP4 procedural fixture bytes", JSON.stringify({ kind, bytes: bytes.length, base64: btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join("")) }));
      }
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
