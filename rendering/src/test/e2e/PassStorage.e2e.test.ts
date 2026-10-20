import { expect, it } from "vitest";
import { createShaderCanvasHarness } from "./ShaderCanvasHarness";

it.each(["slang", "wgsl"] as const)("renders disjoint per-pass storage subsets in %s", { timeout: 30_000 }, async language => {
  const harness = createShaderCanvasHarness(language);
  try {
    await harness.compile({
      image: language === "wgsl"
        ? "fn mainImage(coord: vec2f) -> vec4f { return vec4f(f32(data9[0]), 0.0, 0.0, 1.0); }"
        : "float4 mainImage(float2 coord) { return float4(float(data9[0]), 0.0, 0.0, 1.0); }",
      buffers: {
        ComputeA: language === "wgsl"
          ? "@compute @workgroup_size(1) fn fill() { data0[0] = 1u; }"
          : '[shader("compute")] [numthreads(1, 1, 1)] void fill() { data0[0] = 1u; }',
        ComputeB: language === "wgsl"
          ? "@compute @workgroup_size(1) fn copy() { data9[0] = data0[0]; }"
          : '[shader("compute")] [numthreads(1, 1, 1)] void copy() { data9[0] = data0[0]; }',
      },
      config: {
        version: "1",
        storage: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [
          `data${i}`, { count: 1, elementType: language === "wgsl" ? "u32" : "uint" },
        ])),
        passes: {
          ComputeA: { type: "compute", path: `a.${language}`, entryPoint: "fill", dispatch: { count: 1 } },
          ComputeB: { type: "compute", path: `b.${language}`, entryPoint: "copy", dispatch: { count: 1 } },
          Image: { inputs: {} },
        },
      },
    });
    expect(await harness.renderAndReadPixels()).toEqual(Array.from({ length: 4 }, () => [255, 0, 0, 255]));
    harness.engine.resetTime();
    expect(await harness.renderAndReadPixels()).toEqual(Array.from({ length: 4 }, () => [255, 0, 0, 255]));
  } finally {
    harness.dispose();
  }
});
