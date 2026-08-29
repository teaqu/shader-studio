import { describe, expect, it } from "vitest";
import type { ConfigInput, ShaderConfig } from "@shader-studio/types";
import { createShaderCanvasHarness } from "./ShaderCanvasHarness";

const slot14Inputs: Record<string, ConfigInput> = Object.fromEntries(
  Array.from({ length: 15 }, (_, slot) => [`iChannel${slot}`, { type: "keyboard" }]),
);

const slot14Config: ShaderConfig = {
  version: "1",
  passes: { Image: { inputs: slot14Inputs } },
};

describe("Slang channel metadata WebGPU E2E", () => {
  it("keeps the four ShaderToy metadata slots available with no configured inputs", { timeout: 30_000 }, async () => {
    const harness = createShaderCanvasHarness("slang");
    try {
      await harness.compile({
        image: `float4 mainImage(float2 fragCoord) {
          float3 size = iChannelResolution[3];
          return float4(float3(iChannelTime[3] + size.x, size.y, size.z), 1.0);
        }`,
      });

      expect(await harness.renderAndReadPixels()).toEqual([
        [0, 0, 0, 255], [0, 0, 0, 255],
        [0, 0, 0, 255], [0, 0, 0, 255],
      ]);
    } finally {
      harness.dispose();
    }
  });

  it("delivers slot-14 metadata through the generated 15-entry uniform ABI", { timeout: 30_000 }, async () => {
    const harness = createShaderCanvasHarness("slang");
    try {
      await harness.compile({
        image: `float4 mainImage(float2 fragCoord) {
          return float4(iCh14.size / float3(256.0, 3.0, 1.0), 1.0);
        }`,
        config: slot14Config,
      });

      expect(await harness.renderAndReadPixels()).toEqual([
        [255, 255, 255, 255], [255, 255, 255, 255],
        [255, 255, 255, 255], [255, 255, 255, 255],
      ]);
    } finally {
      harness.dispose();
    }
  });
});
