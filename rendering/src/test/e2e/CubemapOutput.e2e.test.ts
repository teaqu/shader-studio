import { describe, expect, it } from "vitest";
import type { ShaderConfig } from "@shader-studio/types";
import { createShaderCanvasHarness } from "./ShaderCanvasHarness";

const cube = `void mainCubemap(out vec4 color, in vec2 coord, in vec3 origin, in vec3 direction) {
  color = vec4(0.5 + 0.5 * direction, 1.0);
}`;
const image = `void mainImage(out vec4 color, in vec2 coord) {
  vec3 rays[6] = vec3[6](vec3(1,0,0), vec3(-1,0,0), vec3(0,1,0), vec3(0,-1,0), vec3(0,0,1), vec3(0,0,-1));
  color = texture(iChannel0, rays[int(coord.x) + 2 * int(coord.y) + int(iTime)]);
}`;
const config: ShaderConfig = { version: "1.0", passes: {
  Image: { inputs: { iChannel0: { type: "buffer", source: "Cubemap", filter: "linear" } } },
  Cubemap: { path: "cube.glsl", outputKind: "cubemap", faceSize: 32 },
} };
const axisColors = [[255,128,128,255], [0,128,128,255], [128,255,128,255], [128,0,128,255], [128,128,255,255], [128,128,0,255]];
function expectAxes(pixels: number[][], start = 0) {
  expect(pixels).toHaveLength(4);
  pixels.forEach((pixel, index) => pixel.forEach((value, component) => expect(Math.abs(value - axisColors[(index + 2) % 4 + start][component]), JSON.stringify({ pixels, start })).toBeLessThanOrEqual(1)));
}

describe("generated WebGL cubemap outputs", () => {
  it("samples all six direction faces and survives recompilation and resizing", async () => {
    const harness = createShaderCanvasHarness("glsl");
    try {
      harness.resize(2, 2);
      await harness.compile({ image, config, buffers: { Cubemap: cube } });
      expectAxes(await harness.renderAndReadPixels());
      expectAxes(await harness.renderAndReadPixels(2), 2);
      await harness.compile({ image, config: { ...config, passes: { ...config.passes, Cubemap: { ...config.passes.Cubemap!, faceSize: 64 } } }, buffers: { Cubemap: cube } });
      expectAxes(await harness.renderAndReadPixels());
      expectAxes(await harness.renderAndReadPixels(2), 2);
      harness.resize(12, 2);
      harness.resize(2, 2);
      expectAxes(await harness.renderAndReadPixels());
      expectAxes(await harness.renderAndReadPixels(2), 2);
    } finally {
      harness.dispose();
    }
  });

  it("publishes all six faces together and reads the previous cube during self-feedback", async () => {
    const harness = createShaderCanvasHarness("glsl");
    try {
      harness.resize(2, 2);
      const feedback: ShaderConfig = { ...config, passes: { ...config.passes,
        Cubemap: { ...config.passes.Cubemap!, inputs: { iChannel0: { type: "buffer", source: "Cubemap" } } },
      } };
      await harness.compile({ image, config: feedback, buffers: { Cubemap: `void mainCubemap(out vec4 c, in vec2 p, in vec3 o, in vec3 d) { c = texture(iChannel0, d) + vec4(0.1,0.0,0.0,1.0); }` } });
      const first = await harness.renderAndReadPixels();
      const second = await harness.renderAndReadPixels();
      expect(first.map(p => p[0])).toEqual(Array(4).fill(26));
      expect(second.map(p => p[0])).toEqual(Array(4).fill(51));
    } finally {
      harness.dispose();
    }
  });
});
