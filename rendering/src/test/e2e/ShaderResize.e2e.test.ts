import { describe, expect, it } from "vitest";
import {
  createShaderCanvasHarness,
  type Pixel,
  type ShaderLanguage,
  type ShaderProgram,
} from "./ShaderCanvasHarness";

const CENTER_PIXEL_OFFSET = ((30 * 60) + 30) * 4;

function centerPixel(region: Uint8ClampedArray): Pixel {
  return [...region.slice(CENTER_PIXEL_OFFSET, CENTER_PIXEL_OFFSET + 4)] as Pixel;
}

const programs: Record<ShaderLanguage, ShaderProgram> = {
  glsl: {
    image: `vec2 expectedCanvasSize() {
      if (iFrame == 0) return vec2(80.0, 60.0);
      if (iFrame == 1) return vec2(120.0, 90.0);
      return vec2(64.0, 48.0);
    }
    void mainImage(out vec4 color, in vec2 fragCoord) {
      float history = texture(iChannel0, vec2(12.5, 10.5) / iResolution.xy).r;
      float scaledSize = texture(iChannel1, vec2(0.5)).g;
      float fixedSize = texture(iChannel2, vec2(0.5)).b;
      float canvasSize = all(equal(iResolution.xy, expectedCanvasSize())) ? 1.0 : 0.0;
      color = vec4(history, scaledSize, fixedSize, 1.0) * vec4(vec3(canvasSize), 1.0);
    }`,
    buffers: {
      History: `void mainImage(out vec4 color, in vec2 fragCoord) {
        vec4 previous = texture(iChannel0, fragCoord / iResolution.xy);
        float seed = iFrame == 0 && all(lessThan(abs(fragCoord - vec2(12.5, 10.5)), vec2(1.0))) ? 1.0 : 0.0;
        color = max(previous, vec4(seed, 0.0, 0.0, 1.0));
      }`,
      Scaled: `void mainImage(out vec4 color, in vec2 fragCoord) {
        vec2 expected = iFrame == 0 ? vec2(40.0, 30.0) : iFrame == 1 ? vec2(60.0, 45.0) : vec2(32.0, 24.0);
        color = vec4(0.0, all(equal(iResolution.xy, expected)) ? 1.0 : 0.0, 0.0, 1.0);
      }`,
      Fixed: `void mainImage(out vec4 color, in vec2 fragCoord) {
        color = vec4(0.0, 0.0, all(equal(iResolution.xy, vec2(7.0, 5.0))) ? 1.0 : 0.0, 1.0);
      }`,
    },
    config: {
      version: "1",
      passes: {
        History: {
          path: "history.glsl",
          inputs: { iChannel0: { type: "buffer", source: "History" } },
        },
        Scaled: { path: "scaled.glsl", resolution: { scale: 0.5 } },
        Fixed: { path: "fixed.glsl", resolution: { width: 7, height: 5 } },
        Image: {
          inputs: {
            iChannel0: { type: "buffer", source: "History" },
            iChannel1: { type: "buffer", source: "Scaled" },
            iChannel2: { type: "buffer", source: "Fixed" },
          },
        },
      },
    },
  },
  slang: {
    image: `float2 expectedCanvasSize() {
      if (iFrame == 0) return float2(80.0, 60.0);
      if (iFrame == 1) return float2(120.0, 90.0);
      return float2(64.0, 48.0);
    }
    float4 mainImage(float2 fragCoord) {
      float history = sampleIChannel0(float2(12.5, 10.5) / iResolution.xy).r;
      float scaledSize = sampleIChannel1(float2(0.5)).g;
      float fixedSize = sampleIChannel2(float2(0.5)).b;
      float canvasSize = all(iResolution.xy == expectedCanvasSize()) ? 1.0 : 0.0;
      return float4(history, scaledSize, fixedSize, 1.0) * float4(float3(canvasSize), 1.0);
    }`,
    buffers: {
      History: `float4 mainImage(float2 fragCoord) {
        float4 previous = sampleIChannel0(fragCoord / iResolution.xy);
        float seed = iFrame == 0 && all(abs(fragCoord - float2(12.5, 10.5)) < float2(1.0)) ? 1.0 : 0.0;
        return max(previous, float4(seed, 0.0, 0.0, 1.0));
      }`,
      Scaled: `float4 mainImage(float2 fragCoord) {
        float2 expected = iFrame == 0 ? float2(40.0, 30.0) : iFrame == 1 ? float2(60.0, 45.0) : float2(32.0, 24.0);
        return float4(0.0, all(iResolution.xy == expected) ? 1.0 : 0.0, 0.0, 1.0);
      }`,
      Fixed: `float4 mainImage(float2 fragCoord) {
        return float4(0.0, 0.0, all(iResolution.xy == float2(7.0, 5.0)) ? 1.0 : 0.0, 1.0);
      }`,
    },
    config: {
      version: "1",
      passes: {
        History: {
          path: "history.slang",
          inputs: { iChannel0: { type: "buffer", source: "History" } },
        },
        Scaled: { path: "scaled.slang", resolution: { scale: 0.5 } },
        Fixed: { path: "fixed.slang", resolution: { width: 7, height: 5 } },
        Image: {
          inputs: {
            iChannel0: { type: "buffer", source: "History" },
            iChannel1: { type: "buffer", source: "Scaled" },
            iChannel2: { type: "buffer", source: "Fixed" },
          },
        },
      },
    },
  },
};

describe.each(["glsl", "slang"] as const)("%s runtime canvas resize", (language) => {
  it("updates pass resolutions and preserves feedback when growing and shrinking", { timeout: 30_000 }, async () => {
    const harness = createShaderCanvasHarness(language);
    try {
      harness.resize(80, 60);
      await harness.compile(programs[language]);

      expect(centerPixel(await harness.renderAndReadRegion())).toEqual([255, 255, 255, 255]);

      harness.resize(120, 90);
      expect([harness.canvas.width, harness.canvas.height]).toEqual([120, 90]);
      expect(centerPixel(await harness.renderAndReadRegion())).toEqual([255, 255, 255, 255]);

      harness.resize(64, 48);
      expect([harness.canvas.width, harness.canvas.height]).toEqual([64, 48]);
      expect(centerPixel(await harness.renderAndReadRegion())).toEqual([255, 255, 255, 255]);
    } finally {
      harness.dispose();
    }
  });
});
