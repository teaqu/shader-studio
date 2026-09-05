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
  it("compiles a Slang shader with no configured inputs", { timeout: 30_000 }, async () => {
    const harness = createShaderCanvasHarness("slang");
    try {
      await harness.compile({
        image: `float4 mainImage(float2 fragCoord) {
          return float4(0.0, 0.0, 0.0, 1.0);
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

  it("rejects access to an input that is not configured", { timeout: 30_000 }, async () => {
    const harness = createShaderCanvasHarness("slang");
    try {
      await expect(harness.compile({
        image: `float4 mainImage(float2 fragCoord) {
          return inputs.iChannel3.Sample(fragCoord / iResolution.xy);
        }`,
      })).rejects.toThrow(/iChannel3|undefined identifier/i);
    } finally {
      harness.dispose();
    }
  });

  it("delivers slot-14 metadata through its configured input object", { timeout: 30_000 }, async () => {
    const harness = createShaderCanvasHarness("slang");
    try {
      await harness.compile({
        image: `float4 mainImage(float2 fragCoord) {
          return float4(float2(inputs.iChannel14.size) / float2(256.0, 3.0), 1.0, 1.0);
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
