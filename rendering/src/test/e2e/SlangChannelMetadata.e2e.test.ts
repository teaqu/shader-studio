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
  it("samples distinct textures through one sampler up to the available texture budget", { timeout: 30_000 }, async () => {
    const adapter = await navigator.gpu.requestAdapter();
    const count = Math.min(24, adapter!.limits.maxSampledTexturesPerShaderStage);
    const inputs: Record<string, ConfigInput> = {};
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    for (let i = 0; i < count; i++) {
      context.fillStyle = `rgb(${i + 1}, 0, 0)`;
      context.fillRect(0, 0, 1, 1);
      inputs[`tex${i}`] = { type: "texture", path: canvas.toDataURL(), filter: "nearest" };
    }
    const harness = createShaderCanvasHarness("slang");
    try {
      await harness.compile({
        image: `float4 mainImage(float2 p) {
          float sum = ${Array.from({ length: count }, (_, i) => `inputs.tex${i}.SampleLevel(float2(0.5), 0).r`).join(" + ")};
          return float4(sum * ${255 / (count * (count + 1) / 2)}, 0, 0, 1);
        }`,
        config: { version: "1", passes: { Image: { inputs } } },
      });
      expect(await harness.renderAndReadPixels()).toEqual(Array.from({ length: 4 }, () => [255, 0, 0, 255]));
    } finally { harness.dispose(); }
  });

  it("preserves different upload and sampler settings for one image URL", { timeout: 30_000 }, async () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 2;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "red"; context.fillRect(0, 0, 2, 1);
    context.fillStyle = "blue"; context.fillRect(0, 1, 2, 1);
    const path = canvas.toDataURL();
    const harness = createShaderCanvasHarness("slang");
    try {
      await harness.compile({
        image: `float4 mainImage(float2 p) {
          float a = abs(inputs.a.SampleLevel(float2(0.25), 0).r - inputs.b.SampleLevel(float2(0.25), 0).r);
          float b = abs(inputs.a.SampleLevel(float2(0.25, 1.25), 0).r - inputs.c.SampleLevel(float2(0.25, 1.25), 0).r);
          return float4(a, b, float(inputs.b.size.y) / 2.0, 1);
        }`,
        config: { version: "1", passes: { Image: { inputs: {
          a: { type: "texture", path, filter: "nearest", wrap: "repeat", vflip: true },
          b: { type: "texture", path, filter: "nearest", wrap: "repeat", vflip: false },
          c: { type: "texture", path, filter: "nearest", wrap: "clamp", vflip: true },
        } } } },
      });
      expect(await harness.renderAndReadPixels()).toEqual(Array.from({ length: 4 }, () => [255, 255, 255, 255]));
    } finally { harness.dispose(); }
  });

  it("uses deduplicated channels in compute and retains output bindings after resize", { timeout: 30_000 }, async () => {
    const harness = createShaderCanvasHarness("slang");
    try {
      await harness.compile({
        image: "float4 mainImage(float2 p) { return inputs.result.SampleLevel(p / iResolution.xy, 0); }",
        buffers: { Compute: `[shader("compute")] [numthreads(1, 1, 1)]
          void fill(uint3 id : SV_DispatchThreadID) {
            float sum = ${Array.from({ length: 24 }, (_, i) => `inputs.tex${i}.SampleLevel(float2(0.5), 0).r`).join(" + ")};
            writeOutput(id.xy, float4(float2(inputs.tex23.size) / float2(256, 3), sum, 1));
          }` },
        config: { version: "1", passes: {
          Image: { inputs: { result: { type: "buffer", source: "Compute" } } },
          Compute: { type: "compute", path: "compute.slang", entryPoint: "fill", inputs: Object.fromEntries(
            Array.from({ length: 24 }, (_, i) => [`tex${i}`, { type: "keyboard" as const }]),
          ) },
        } },
      });
      expect(await harness.renderAndReadPixels()).toEqual(Array.from({ length: 4 }, () => [255, 255, 0, 255]));
      harness.resize(4, 4);
      expect(await harness.renderAndReadPixels()).toEqual(Array.from({ length: 4 }, () => [255, 255, 0, 255]));
    } finally { harness.dispose(); }
  });

  it("renders 24 aliases of one texture without exhausting sampler bindings", { timeout: 30_000 }, async () => {
    const harness = createShaderCanvasHarness("slang");
    try {
      await harness.compile({
        image: `float4 mainImage(float2 fragCoord) {
          float value = ${Array.from({ length: 24 }, (_, i) => `inputs.tex${i}.SampleLevel(float2(0.5), 0).r`).join(" + ")};
          return float4(float2(inputs.tex23.size) / float2(256.0, 3.0), value, 1.0);
        }`,
        config: { version: "1", passes: { Image: { inputs: Object.fromEntries(
          Array.from({ length: 24 }, (_, i) => [`tex${i}`, { type: "keyboard" as const }]),
        ) } } },
      });
      expect(await harness.renderAndReadPixels()).toEqual(Array.from({ length: 4 }, () => [255, 255, 0, 255]));
    } finally { harness.dispose(); }
  });

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
