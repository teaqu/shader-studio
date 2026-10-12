import { describe, expect, it } from "vitest";
import type { ShaderConfig } from "@shader-studio/types";
import { createShaderCanvasHarness } from "./ShaderCanvasHarness";

const image = `float4 mainImage(float2 p) {
  float3 rays[4] = { float3(1,0,0), float3(-1,0,0), float3(0,1,0), float3(0,-1,0) };
  uint index = uint(p.x) + 2u * uint(p.y);
  return sky.SampleLevel(rays[index], 0.0);
}`;

const offAxisImage = `float4 mainImage(float2 p) {
  float3 rays[4] = {
    normalize(float3(1, 0.5, 0.25)), normalize(float3(-1, -0.5, 0.25)),
    normalize(float3(0.25, 1, -0.5)), normalize(float3(-0.25, -1, 0.5))
  };
  return sky.SampleLevel(rays[uint(p.x) + 2u * uint(p.y)], 0.0);
}`;

const config: ShaderConfig = { version: "1", passes: {
  Image: { inputs: { sky: { type: "buffer", source: "Sky", filter: "nearest" } } },
  Sky: { path: "sky.slang", outputKind: "cubemap", faceSize: 16 },
} };

describe("Slang WebGPU cubemap outputs", () => {
  it("renders axis directions from six raster faces", { timeout: 30_000 }, async () => {
    const harness = createShaderCanvasHarness("slang");
    try {
      harness.resize(2, 2);
      await harness.compile({ image, config, buffers: { Sky: `float4 mainCubemap(float2 p, float3 o, float3 d) { return float4(d.x > 0.99, d.y > 0.99, d.z > 0.99, 1); }` } });
      const sky = (harness.engine as any).session.passPipelines.get("Sky");
      expect(sky?.getPipeline()).toBeTruthy();
      expect(sky?.getBindGroup()).toBeTruthy();
      const device = (harness.engine as any).device as GPUDevice;
      device.pushErrorScope("validation");
      const pixels = await harness.renderAndReadPixels();
      const validationError = await device.popErrorScope();
      expect(validationError?.message).toBeUndefined();
      expect(pixels).toEqual([
        [0, 255, 0, 255], [0, 0, 0, 255], [255, 0, 0, 255], [0, 0, 0, 255],
      ]);
    } finally {
      harness.dispose();
    }
  });

  it("writes and samples six compute layers as one cube", { timeout: 30_000 }, async () => {
    const harness = createShaderCanvasHarness("slang");
    try {
      harness.resize(2, 2);
      await harness.compile({ image, config: { ...config, passes: { ...config.passes, Sky: { type: "compute", path: "sky.slang", outputKind: "cubemap", faceSize: 16, entryPoint: "draw" } } }, buffers: { Sky: `[shader("compute")]
[numthreads(1,1,1)] void draw(uint3 id : SV_DispatchThreadID) {
  if (id.x >= 16u || id.y >= 16u || id.z >= 6u) return;
  float3 d = cubemapDirection(id.xy, id.z);
  writeOutput(id.xy, id.z, float4(d.x > 0.99, d.y > 0.99, d.z > 0.99, 1));
}` } });
      expect(await harness.renderAndReadPixels()).toEqual([
        [0, 255, 0, 255], [0, 0, 0, 255], [255, 0, 0, 255], [0, 0, 0, 255],
      ]);
    } finally {
      harness.dispose();
    }
  });

  it("matches raster cube directions at off-axis +X and +Y samples", { timeout: 30_000 }, async () => {
    const raster = createShaderCanvasHarness("slang");
    const compute = createShaderCanvasHarness("slang");
    const directionColor = "float4(0.5 + 0.5 * d, 1.0)";
    try {
      raster.resize(2, 2);
      compute.resize(2, 2);
      await raster.compile({ image: offAxisImage, config, buffers: { Sky: `float4 mainCubemap(float2 p, float3 o, float3 d) { return ${directionColor}; }` } });
      const computeConfig: ShaderConfig = { ...config, passes: { ...config.passes,
        Sky: { type: "compute", path: "sky.slang", outputKind: "cubemap", faceSize: 16, entryPoint: "draw" },
      } };
      await compute.compile({ image: offAxisImage, config: computeConfig, buffers: { Sky: `[shader("compute")]
[numthreads(1,1,1)] void draw(uint3 id : SV_DispatchThreadID) {
  if (id.x >= 16u || id.y >= 16u || id.z >= 6u) return;
  float3 d = cubemapDirection(id.xy, id.z);
  writeOutput(id.xy, id.z, ${directionColor});
}` } });
      expect(await compute.renderAndReadPixels()).toEqual(await raster.renderAndReadPixels());
    } finally {
      raster.dispose();
      compute.dispose();
    }
  });

  it("reads the prior six-face raster cube for feedback and clears it on a face resize", { timeout: 30_000 }, async () => {
    const harness = createShaderCanvasHarness("slang");
    const feedbackConfig: ShaderConfig = { ...config, passes: { ...config.passes,
      Sky: { ...config.passes.Sky!, inputs: { history: { type: "buffer", source: "Sky" } } },
    } };
    const feedbackSource = `float4 mainCubemap(float2 p, float3 o, float3 d) {
  return history.SampleLevel(d, 0.0) + float4(0.1, 0.0, 0.0, 1.0);
}`;
    try {
      harness.resize(2, 2);
      await harness.compile({ image, config: feedbackConfig, buffers: { Sky: feedbackSource } });
      expect((await harness.renderAndReadPixels()).map((pixel) => pixel[0])).toEqual(Array(4).fill(26));
      expect((await harness.renderAndReadPixels()).map((pixel) => pixel[0])).toEqual(Array(4).fill(51));

      await harness.compile({ image, config: { ...feedbackConfig, passes: { ...feedbackConfig.passes,
        Sky: { ...feedbackConfig.passes.Sky!, faceSize: 32 },
      } }, buffers: { Sky: feedbackSource } });
      expect((await harness.renderAndReadPixels()).map((pixel) => pixel[0])).toEqual(Array(4).fill(26));
    } finally {
      harness.dispose();
    }
  });
});
