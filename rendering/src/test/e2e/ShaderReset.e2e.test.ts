import { describe, expect, it } from "vitest";
import type { RenderingEngine } from "../../types/RenderingEngine";
import {
  createShaderCanvasHarness,
  TEST_CANVAS_SIZE,
  type Pixel,
  type ShaderLanguage,
  type ShaderProgram,
} from "./ShaderCanvasHarness";

const FRAME_COUNT = 30;

const configFor = (language: ShaderLanguage): NonNullable<ShaderProgram["config"]> => ({
  version: "1.0",
  passes: {
    // BufferB deliberately precedes BufferA. Its BufferA input therefore reads
    // the previous frame, which makes the reset frame exercise cross-buffer
    // zeroing rather than the value BufferA produces later in the same frame.
    BufferB: {
      path: `buffer-b.${language}`,
      resolution: { width: TEST_CANVAS_SIZE, height: TEST_CANVAS_SIZE },
      inputs: {
        iChannel0: { type: "buffer", source: "BufferB", filter: "nearest" },
        iChannel1: { type: "buffer", source: "BufferA", filter: "nearest" },
      },
    },
    BufferA: {
      path: `buffer-a.${language}`,
      resolution: { width: TEST_CANVAS_SIZE, height: TEST_CANVAS_SIZE },
      inputs: {
        iChannel0: { type: "buffer", source: "BufferA", filter: "nearest" },
      },
    },
    Image: {
      inputs: {
        iChannel0: { type: "buffer", source: "BufferA", filter: "nearest" },
        iChannel1: { type: "buffer", source: "BufferB", filter: "nearest" },
      },
    },
  },
});

const programs: Record<ShaderLanguage, ShaderProgram> = {
  glsl: {
    image: `void mainImage(out vec4 color, in vec2 fragCoord) {
      vec2 uv = fragCoord / iResolution.xy;
      vec4 a = texture(iChannel0, uv);
      vec4 b = texture(iChannel1, uv);
      color = vec4(a.r, a.g, b.g * b.b, 1.0);
    }`,
    buffers: {
      BufferA: `void mainImage(out vec4 color, in vec2 fragCoord) {
        vec4 previous = texture(iChannel0, fragCoord / iResolution.xy);
        if (iFrame == 0) {
          color = vec4(1.0, float(all(equal(previous, vec4(0.0)))), 0.0, 1.0);
          return;
        }
        color = vec4(fract(previous.r * 0.37 + fragCoord.x * 0.11),
          fract(previous.g * 0.53 + fragCoord.y * 0.07),
          fract(previous.b * 0.71 + 0.13), 1.0);
      }`,
      BufferB: `void mainImage(out vec4 color, in vec2 fragCoord) {
        vec2 uv = fragCoord / iResolution.xy;
        vec4 previous = texture(iChannel0, uv);
        vec4 crossBuffer = texture(iChannel1, uv);
        if (iFrame == 0) {
          color = vec4(1.0, float(all(equal(previous, vec4(0.0)))),
            float(all(equal(crossBuffer, vec4(0.0)))), 1.0);
          return;
        }
        color = vec4(fract(previous.r * 0.41 + crossBuffer.r * 0.17),
          fract(previous.g * 0.59 + crossBuffer.g * 0.19),
          fract(previous.b * 0.73 + crossBuffer.b * 0.23), 1.0);
      }`,
    },
    config: configFor("glsl"),
  },
  slang: {
    image: `float4 mainImage(float2 fragCoord) {
      float2 uv = fragCoord / iResolution.xy;
      float4 a = iChannel0.Sample(uv);
      float4 b = iChannel1.Sample(uv);
      return float4(a.r, a.g, b.g * b.b, 1.0);
    }`,
    buffers: {
      BufferA: `float4 mainImage(float2 fragCoord) {
        float4 previous = iChannel0.Sample(fragCoord / iResolution.xy);
        if (iFrame == 0) {
          return float4(1.0, all(previous == float4(0.0)), 0.0, 1.0);
        }
        return float4(frac(previous.r * 0.37 + fragCoord.x * 0.11),
          frac(previous.g * 0.53 + fragCoord.y * 0.07),
          frac(previous.b * 0.71 + 0.13), 1.0);
      }`,
      BufferB: `float4 mainImage(float2 fragCoord) {
        float2 uv = fragCoord / iResolution.xy;
        float4 previous = iChannel0.Sample(uv);
        float4 crossBuffer = iChannel1.Sample(uv);
        if (iFrame == 0) {
          return float4(1.0, all(previous == float4(0.0)),
            all(crossBuffer == float4(0.0)), 1.0);
        }
        return float4(frac(previous.r * 0.41 + crossBuffer.r * 0.17),
          frac(previous.g * 0.59 + crossBuffer.g * 0.19),
          frac(previous.b * 0.73 + crossBuffer.b * 0.23), 1.0);
      }`,
    },
    config: configFor("slang"),
  },
  wgsl: {
    image: `fn mainImage(coord: vec2f) -> vec4f {
      let uv = coord / iResolution.xy;
      let a = iChannel0Sample(uv);
      let b = iChannel1Sample(uv);
      return vec4f(a.r, a.g, b.g * b.b, 1.0);
    }`,
    buffers: {
      BufferA: `fn mainImage(coord: vec2f) -> vec4f {
        let previous = iChannel0Sample(coord / iResolution.xy);
        if (iFrame == 0) {
          return vec4f(1.0, select(0.0, 1.0, all(previous == vec4f(0.0))), 0.0, 1.0);
        }
        return vec4f(fract(previous.r * 0.37 + coord.x * 0.11),
          fract(previous.g * 0.53 + coord.y * 0.07),
          fract(previous.b * 0.71 + 0.13), 1.0);
      }`,
      BufferB: `fn mainImage(coord: vec2f) -> vec4f {
        let uv = coord / iResolution.xy;
        let previous = iChannel0Sample(uv);
        let crossBuffer = iChannel1Sample(uv);
        if (iFrame == 0) {
          return vec4f(1.0, select(0.0, 1.0, all(previous == vec4f(0.0))),
            select(0.0, 1.0, all(crossBuffer == vec4f(0.0))), 1.0);
        }
        return vec4f(fract(previous.r * 0.41 + crossBuffer.r * 0.17),
          fract(previous.g * 0.59 + crossBuffer.g * 0.19),
          fract(previous.b * 0.73 + crossBuffer.b * 0.23), 1.0);
      }`,
    },
    config: configFor("wgsl"),
  },
};

function revised(program: ShaderProgram, language: ShaderLanguage): ShaderProgram {
  const marker = `\n// reset compilation ${language}`;
  return {
    ...program,
    image: program.image + marker,
    buffers: Object.fromEntries(Object.entries(program.buffers ?? {}).map(([name, source]) => [
      name,
      source + marker,
    ])),
  };
}

async function compileDirect(engine: RenderingEngine, program: ShaderProgram, language: ShaderLanguage): Promise<void> {
  const result = await engine.compileShaderPipeline(
    program.image,
    program.config ?? null,
    program.path ?? `/e2e/image.${language}`,
    program.buffers ?? {},
  );
  if (!result?.success) {
    throw new Error(result?.errors?.join("\n") ?? "Reset compilation returned no result");
  }
}

const whiteFrame = (): Pixel[] => Array.from(
  { length: TEST_CANVAS_SIZE ** 2 },
  () => [255, 255, 255, 255] as Pixel,
);

describe.each(["glsl", "wgsl", "slang"] as const)("%s atomic reset", (language) => {
  it("publishes reset resources with frame zero and matches 30 fresh Emergence frames", { timeout: 120_000 }, async () => {
    const fresh = createShaderCanvasHarness(language);
    const reset = createShaderCanvasHarness(language);
    try {
      await fresh.compile(programs[language]);
      const freshFrames: Pixel[][] = [];
      for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
        freshFrames.push(await fresh.renderAndReadPixels());
      }
      expect(freshFrames[0]).toEqual(whiteFrame());

      await reset.compile(programs[language]);
      for (let frame = 0; frame < 5; frame += 1) {
        await reset.renderAndReadPixels();
      }

      reset.engine.resetTime();
      const applying = compileDirect(reset.engine, revised(programs[language], language), language);

      // compileShaderPipeline has yielded before it can apply. Render exactly
      // one old-generation frame in that gap, including when compiler and
      // pipeline caches are warm.
      await reset.renderAndReadPixels();
      await applying;

      const resetFrames: Pixel[][] = [];
      for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
        resetFrames.push(await reset.renderAndReadPixels());
      }

      // White encodes iFrame==0, zero self-feedback in both passes, and zero
      // previous-frame input from the later BufferA pass into BufferB.
      expect(resetFrames[0]).toEqual(whiteFrame());
      expect(resetFrames).toEqual(freshFrames);
    } finally {
      fresh.dispose();
      reset.dispose();
    }
  });
});
