import { describe, expect, it } from "vitest";
import type { ShaderConfig } from "@shader-studio/types";
import { createShaderCanvasHarness } from "./ShaderCanvasHarness";
import wgslSource from "../../../../tests/fixtures/shader-corpus/wgsl/native-entrypoints/raster-varyings.wgsl?raw";
import slangSource from "../../../../tests/fixtures/shader-corpus/slang/native-entrypoints/raster-varyings.slang?raw";

const config: ShaderConfig = {
  version: "1.0",
  passes: {
    Image: {
      geometry: { type: "cube" },
      entryPoints: { vertex: "rasterVertex", fragment: "rasterColor" },
    },
  },
};

function litPixels(region: Uint8ClampedArray): number[][] {
  const pixels: number[][] = [];
  for (let index = 0; index < region.length; index += 4) {
    const pixel = [...region.slice(index, index + 4)];
    if (pixel[0] !== 0 || pixel[1] !== 0 || pixel[2] !== 0) {
      pixels.push(pixel);
    }
  }
  return pixels;
}

describe("native raster-varyings corpus fixture", () => {
  it.each([
    ["wgsl", wgslSource],
    ["slang", slangSource],
  ] as const)("renders the %s fixture as a visible cube with varied authored faces", { timeout: 30_000 }, async (language, source) => {
    const harness = createShaderCanvasHarness(language);
    try {
      harness.resize(128, 128);
      await harness.compile({ path: `/fixture/raster-varyings.${language}`, image: source, config });

      const region = await harness.renderAndReadRegion();
      const lit = litPixels(region);
      // The centred inspector region contains the cube, but is not a flat fullscreen fill.
      expect(lit.length).toBeGreaterThan(1_000);
      expect(lit.length).toBeLessThan(3_600);
      const faceColours = new Set(lit.map(pixel => pixel.slice(0, 3).join(",")));
      expect(faceColours.size).toBeGreaterThan(20);
      expect(lit.some(pixel => pixel[0] > pixel[1] * 1.5)).toBe(true);
      expect(lit.some(pixel => pixel[2] > pixel[0] * 1.5)).toBe(true);
    } finally {
      harness.dispose();
    }
  });

  it.each([
    ["wgsl", wgslSource],
    ["slang", slangSource],
  ] as const)("keeps the %s cube visible when its native vertex stage is cleared", { timeout: 30_000 }, async (language, source) => {
    const harness = createShaderCanvasHarness(language);
    try {
      harness.resize(128, 128);
      await harness.compile({
        path: `/fixture/raster-varyings-generated-vertex.${language}`,
        image: source,
        config: { ...config, passes: { Image: { geometry: { type: "cube" }, entryPoints: { fragment: "rasterColor" } } } },
      });
      const lit = litPixels(await harness.renderAndReadRegion());
      // Generated mesh vertices carry UV0, world position1, and normal2—the
      // same interface rasterColor receives from its authored vertex stage.
      expect(lit.length).toBeGreaterThan(1_000);
      expect(lit.some(pixel => pixel[0] > pixel[1] * 1.5)).toBe(true);
      expect(lit.some(pixel => pixel[2] > pixel[0] * 1.5)).toBe(true);
    } finally {
      harness.dispose();
    }
  });
});
