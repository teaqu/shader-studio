import { describe, expect, it } from "vitest";
import raySpheres from "../../../../tests/fixtures/capture/ray-spheres.glsl?raw";
import { ShaderRecorder } from "../../lib/recording/ShaderRecorder";
import type { ShaderInfo } from "../../lib/recording/types";
import { createEngineForLanguage } from "../../lib/engineFactory";
import { blobToImageData, decodeVideoFrames, glslInfo, lumaPsnr, renderReference } from "./captureMediaHelpers";

// Saved media is decoded by the browser and compared with lossless Render
// screenshots of the same shader time. Video is lossy, so quality is judged
// on luma PSNR with documented floors, never by exact bytes.

const smooth = `void mainImage(out vec4 c, in vec2 f) {
  vec2 uv = f / iResolution.xy;
  c = vec4(0.5 + 0.5 * cos(iTime + uv.xyx + vec3(0, 2, 4)), 1.0);
}`;

type Language = "glsl" | "wgsl" | "slang";
const LANGUAGES: Language[] = ["glsl", "wgsl", "slang"];

function info(language: Language, code: string, extra: Partial<ShaderInfo> = {}): ShaderInfo {
  return glslInfo(code, { language, path: `/fixture.${language}`, ...extra });
}

const COUNTER_SOURCES: Record<Language, { image: string; buffer: string }> = {
  glsl: {
    image: `void mainImage(out vec4 c, in vec2 f) { c = texelFetch(iChannel0, ivec2(0), 0); }`,
    buffer: `void mainImage(out vec4 c, in vec2 f) {
      vec4 previous = iFrame == 0 ? vec4(0.0) : texelFetch(iChannel0, ivec2(0), 0);
      c = vec4(previous.r + 1.0 / 255.0, 0.0, 0.0, 1.0);
    }`,
  },
  wgsl: {
    image: `fn mainImage(coord: vec2f) -> vec4f { return iChannel0Sample(vec2f(0.5)); }`,
    buffer: `fn mainImage(coord: vec2f) -> vec4f {
      var previous = iChannel0Sample(vec2f(0.5));
      if (iFrame == 0) { previous = vec4f(0.0); }
      return vec4f(previous.r + 1.0 / 255.0, 0.0, 0.0, 1.0);
    }`,
  },
  slang: {
    image: `float4 mainImage(float2 fragCoord) { return iChannel0.Sample(float2(0.5, 0.5)); }`,
    buffer: `float4 mainImage(float2 fragCoord) {
      float4 previous = iFrame == 0 ? float4(0.0, 0.0, 0.0, 0.0) : iChannel0.Sample(float2(0.5, 0.5));
      return float4(previous.r + 1.0 / 255.0, 0.0, 0.0, 1.0);
    }`,
  },
};

/** BufferA counts rendered frames through its own feedback; Image shows the count in red. */
function frameCounter(language: Language): ShaderInfo {
  const { image, buffer } = COUNTER_SOURCES[language];
  return info(language, image, {
    buffers: { BufferA: buffer },
    config: {
      version: "1",
      passes: {
        BufferA: { path: `counter-a.${language}`, inputs: { iChannel0: { type: "buffer", source: "BufferA" } } },
        Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA" } } },
      },
    },
  });
}

const TINT_SOURCES: Record<Language, string> = {
  glsl: `void mainImage(out vec4 c, in vec2 f) { c = vec4(uTint, 1.0); }`,
  wgsl: `fn mainImage(coord: vec2f) -> vec4f { return vec4f(uTint, 1.0); }`,
  slang: `float4 mainImage(float2 fragCoord) { return float4(uTint, 1.0); }`,
};

function tinted(language: Language, value: number[]): ShaderInfo {
  // uTint is declared by the script context, not in source, as script uniforms are.
  return info(language, TINT_SOURCES[language], {
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

describe.each(LANGUAGES)("Render preparation keeps feedback history (#11) — %s", (language) => {
  it("captures the latest feedback image without advancing or rewinding it", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 8;
    document.body.appendChild(canvas);
    const engine = createEngineForLanguage(language);
    engine.initialize(canvas, true);
    const shader = frameCounter(language);
    try {
      const compiled = await engine.compileShaderPipeline(shader.code, shader.config, shader.path, shader.buffers);
      expect(compiled?.success).toBe(true);
      for (let frame = 0; frame < 3; frame++) {
        engine.getTimeManager().setFrame(frame);
        engine.renderForCapture();
      }
      const recorder = new ShaderRecorder();
      for (let capture = 0; capture < 2; capture++) {
        const png = await recorder.captureLiveScreenshot(
          { mode: "live", format: "png", width: 8, height: 8 }, engine,
        );
        expect(centre(await blobToImageData(png))[0]).toBe(3);
      }
    } finally {
      engine.dispose();
      canvas.remove();
    }
  }, 60_000);

  it("renders every preceding frame before a screenshot", async () => {
    // 0.5 s at the 60 fps screenshot preparation rate is 30 frames, plus the captured one.
    const png = await new ShaderRecorder().captureScreenshot(
      { mode: "render", format: "png", width: 64, height: 64, time: 0.5 },
      frameCounter(language),
    );
    expect(centre(await blobToImageData(png))[0]).toBe(31);
  }, 60_000);

  it("starts a video after its preparation frames without resetting feedback", async () => {
    const fps = 30;
    const blob = await new ShaderRecorder().record(
      { mode: "render", format: "webm", duration: 1, startTime: 0.5, fps, width: 64, height: 64 },
      frameCounter(language),
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

describe.each(LANGUAGES)("Render uses the captured uniform snapshot (#35) — %s", (language) => {
  it("applies a script uniform declared outside the source to the saved image", async () => {
    const png = await new ShaderRecorder().captureScreenshot(
      { mode: "render", format: "png", width: 32, height: 32, time: 0 },
      tinted(language, [1, 0.5, 0]),
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
      tinted(language, [0, 0, 0]),
    );
    expect(centre(await blobToImageData(png))).toEqual([0, 0, 0]);
  }, 60_000);

  it("uses the same snapshot for saved video frames", async () => {
    const blob = await new ShaderRecorder().record(
      { mode: "render", format: "webm", duration: 0.5, startTime: 0, fps: 30, width: 64, height: 64 },
      tinted(language, [0, 1, 0]),
    );
    const [r, g, b] = centre((await decodeVideoFrames(blob, [0.1])).frames[0]);
    expect(r).toBeLessThanOrEqual(8);
    expect(g).toBeGreaterThanOrEqual(247);
    expect(b).toBeLessThanOrEqual(8);
  }, 60_000);
});
