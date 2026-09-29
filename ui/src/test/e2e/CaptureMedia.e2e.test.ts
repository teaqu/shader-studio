import { describe, expect, it } from "vitest";
import raySpheres from "../../../../tests/fixtures/capture/ray-spheres.glsl?raw";
import { ShaderRecorder } from "../../lib/recording/ShaderRecorder";
import type { ShaderInfo } from "../../lib/recording/types";
import { blobToImageData, decodeVideoFrames, glslInfo, lumaPsnr, renderReference } from "./captureMediaHelpers";

// Saved media is decoded by the browser and compared with lossless Render
// screenshots of the same shader time. Video is lossy, so quality is judged
// on luma PSNR with documented floors, never by exact bytes.

const smooth = `void mainImage(out vec4 c, in vec2 f) {
  vec2 uv = f / iResolution.xy;
  c = vec4(0.5 + 0.5 * cos(iTime + uv.xyx + vec3(0, 2, 4)), 1.0);
}`;

/** BufferA counts rendered frames through its own feedback; Image shows the count in red. */
const frameCounter: ShaderInfo = glslInfo(
  `void mainImage(out vec4 c, in vec2 f) { c = texelFetch(iChannel0, ivec2(0), 0); }`,
  {
    buffers: {
      BufferA: `void mainImage(out vec4 c, in vec2 f) {
        vec4 previous = iFrame == 0 ? vec4(0.0) : texelFetch(iChannel0, ivec2(0), 0);
        c = vec4(previous.r + 1.0 / 255.0, 0.0, 0.0, 1.0);
      }`,
    },
    config: {
      version: "1",
      passes: {
        BufferA: { path: "counter-a.glsl", inputs: { iChannel0: { type: "buffer", source: "BufferA" } } },
        Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA" } } },
      },
    },
  },
);

function tinted(value: number[]): ShaderInfo {
  // uTint is declared by the script context, not in source, as script uniforms are.
  return glslInfo(`void mainImage(out vec4 c, in vec2 f) { c = vec4(uTint, 1.0); }`, {
    customUniformDeclarations: "uniform vec3 uTint;",
    customUniformInfo: [{ name: "uTint", type: "vec3" }],
    customUniformValues: [{ name: "uTint", type: "vec3", value }],
  });
}

function centre(image: ImageData): [number, number, number] {
  const i = (Math.floor(image.height / 2) * image.width + Math.floor(image.width / 2)) * 4;
  return [image.data[i], image.data[i + 1], image.data[i + 2]];
}

describe("Render video quality (#39)", () => {
  const width = 640;
  const height = 360;
  const fps = 30;

  it("keeps ray-spheres detail and frame timing in a saved WebM", async () => {
    const blob = await new ShaderRecorder().record(
      { mode: "render", format: "webm", duration: 1, startTime: 0, fps, width, height },
      glslInfo(raySpheres),
    );
    const sampled = [5, 15, 25];
    const decoded = await decodeVideoFrames(blob, sampled.map((frame) => (frame + 0.25) / fps));

    expect([decoded.width, decoded.height]).toEqual([width, height]);
    expect(decoded.duration).toBeCloseTo(1, 1);
    for (const [k, frame] of sampled.entries()) {
      // The saved frame is closest to its own shader time, not a neighbour's.
      const scores = await Promise.all([-1, 0, 1].map(async (offset) =>
        lumaPsnr(decoded.frames[k], await renderReference(glslInfo(raySpheres), width, height, (frame + offset) / fps))));
      expect(scores.indexOf(Math.max(...scores))).toBe(1);
      // Measured ceiling for this shader after 4:2:0 chroma is 33.3 dB luma;
      // the old 5 Mbps / 0.1 bpp policies scored 18-20 dB (visibly blocky).
      expect(scores[1]).toBeGreaterThanOrEqual(28);
    }
  }, 120_000);

  it("does not inflate files for simple shaders", async () => {
    const blob = await new ShaderRecorder().record(
      { mode: "render", format: "webm", duration: 1, startTime: 0, fps, width, height },
      glslInfo(smooth),
    );
    const decoded = await decodeVideoFrames(blob, [15.25 / fps]);
    const reference = await renderReference(glslInfo(smooth), width, height, 15 / fps);

    expect(lumaPsnr(decoded.frames[0], reference)).toBeGreaterThanOrEqual(45);
    // Measured about 1.1 Mbps; the bitrate is a ceiling that simple content doesn't reach.
    expect((blob.size * 8) / 1e6).toBeLessThan(3);
  }, 120_000);
});

describe("Render preparation keeps feedback history (#11)", () => {
  it("renders every preceding frame before a screenshot", async () => {
    // 0.5 s at the 60 fps screenshot preparation rate is 30 frames, plus the captured one.
    const png = await new ShaderRecorder().captureScreenshot(
      { mode: "render", format: "png", width: 64, height: 64, time: 0.5 },
      frameCounter,
    );
    expect(centre(await blobToImageData(png))[0]).toBe(31);
  }, 60_000);

  it("starts a video after its preparation frames without resetting feedback", async () => {
    const fps = 30;
    const blob = await new ShaderRecorder().record(
      { mode: "render", format: "webm", duration: 1, startTime: 0.5, fps, width: 64, height: 64 },
      frameCounter,
    );
    const decoded = await decodeVideoFrames(blob, [0.25 / fps, 10.25 / fps]);

    // 15 preparation frames at 30 fps, then the first saved frame is the 16th render.
    expect(centre(decoded.frames[0])[0]).toBeGreaterThanOrEqual(14);
    expect(centre(decoded.frames[0])[0]).toBeLessThanOrEqual(18);
    expect(centre(decoded.frames[1])[0]).toBeGreaterThanOrEqual(24);
    expect(centre(decoded.frames[1])[0]).toBeLessThanOrEqual(28);
    // Preparation is not part of the saved clip.
    expect(decoded.duration).toBeCloseTo(1, 1);
  }, 60_000);
});

describe("Render uses the captured uniform snapshot (#35)", () => {
  it("applies a script uniform declared outside the source to the saved image", async () => {
    const png = await new ShaderRecorder().captureScreenshot(
      { mode: "render", format: "png", width: 32, height: 32, time: 0 },
      tinted([1, 0.5, 0]),
    );
    const [r, g, b] = centre(await blobToImageData(png));
    expect(r).toBe(255);
    expect(g).toBeGreaterThanOrEqual(127);
    expect(g).toBeLessThanOrEqual(128);
    expect(b).toBe(0);
  }, 60_000);

  it("keeps an explicit zero value instead of treating it as missing", async () => {
    const png = await new ShaderRecorder().captureScreenshot(
      { mode: "render", format: "png", width: 32, height: 32, time: 0 },
      tinted([0, 0, 0]),
    );
    expect(centre(await blobToImageData(png))).toEqual([0, 0, 0]);
  }, 60_000);

  it("uses the same snapshot for saved video frames", async () => {
    const blob = await new ShaderRecorder().record(
      { mode: "render", format: "webm", duration: 0.5, startTime: 0, fps: 30, width: 64, height: 64 },
      tinted([0, 1, 0]),
    );
    const [r, g, b] = centre((await decodeVideoFrames(blob, [0.1])).frames[0]);
    expect(r).toBeLessThanOrEqual(8);
    expect(g).toBeGreaterThanOrEqual(247);
    expect(b).toBeLessThanOrEqual(8);
  }, 60_000);
});
