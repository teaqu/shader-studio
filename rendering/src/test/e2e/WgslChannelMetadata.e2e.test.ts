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

const levelSum = (count: number) =>
  Array.from({ length: count }, (_, i) => `tex${i}SampleLevel(vec2f(0.5), 0.0).r`).join(" + ");

describe("WGSL channel metadata WebGPU E2E", () => {
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
    const harness = createShaderCanvasHarness("wgsl");
    try {
      await harness.compile({
        image: `fn mainImage(p: vec2f) -> vec4f {
          let sum = ${levelSum(count)};
          return vec4f(sum * ${(255 / (count * (count + 1) / 2)).toFixed(6)}, 0.0, 0.0, 1.0);
        }`,
        config: { version: "1", passes: { Image: { inputs } } },
      });
      expect(await harness.renderAndReadPixels()).toEqual(Array.from({ length: 4 }, () => [255, 0, 0, 255]));
    } finally {
      harness.dispose();
    }
  });

  it("preserves different upload and sampler settings for one image URL", { timeout: 30_000 }, async () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 2;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "red"; context.fillRect(0, 0, 2, 1);
    context.fillStyle = "blue"; context.fillRect(0, 1, 2, 1);
    const path = canvas.toDataURL();
    const harness = createShaderCanvasHarness("wgsl");
    try {
      await harness.compile({
        image: `fn mainImage(p: vec2f) -> vec4f {
          let uploadDifference = abs(aSampleLevel(vec2f(0.25), 0.0).r - bSampleLevel(vec2f(0.25), 0.0).r);
          let samplerDifference = abs(aSampleLevel(vec2f(0.25, 1.25), 0.0).r - cSampleLevel(vec2f(0.25, 1.25), 0.0).r);
          return vec4f(uploadDifference, samplerDifference, f32(b.size.y) / 2.0, 1.0);
        }`,
        config: { version: "1", passes: { Image: { inputs: {
          a: { type: "texture", path, filter: "nearest", wrap: "repeat", vflip: true },
          b: { type: "texture", path, filter: "nearest", wrap: "repeat", vflip: false },
          c: { type: "texture", path, filter: "nearest", wrap: "clamp", vflip: true },
        } } } },
      });
      expect(await harness.renderAndReadPixels()).toEqual(Array.from({ length: 4 }, () => [255, 255, 255, 255]));
    } finally {
      harness.dispose();
    }
  });

  it("uses deduplicated channels in compute and retains output bindings after resize", { timeout: 30_000 }, async () => {
    const harness = createShaderCanvasHarness("wgsl");
    try {
      await harness.compile({
        image: "fn mainImage(p: vec2f) -> vec4f { return resultSampleLevel(p / iResolution.xy, 0.0); }",
        buffers: { Compute: `@compute @workgroup_size(1, 1, 1)
          fn fill(@builtin(global_invocation_id) id: vec3u) {
            let sum = ${levelSum(24)};
            writeOutput(id.xy, vec4f(vec2f(tex23.size) / vec2f(256.0, 3.0), sum, 1.0));
          }` },
        config: { version: "1", passes: {
          Image: { inputs: { result: { type: "buffer", source: "Compute" } } },
          Compute: { type: "compute", path: "compute.wgsl", entryPoint: "fill", inputs: Object.fromEntries(
            Array.from({ length: 24 }, (_, i) => [`tex${i}`, { type: "keyboard" as const }]),
          ) },
        } },
      });
      expect(await harness.renderAndReadPixels()).toEqual(Array.from({ length: 4 }, () => [255, 255, 0, 255]));
      harness.resize(4, 4);
      expect(await harness.renderAndReadPixels()).toEqual(Array.from({ length: 4 }, () => [255, 255, 0, 255]));
    } finally {
      harness.dispose();
    }
  });

  it("renders 24 aliases of one texture without exhausting sampler bindings", { timeout: 30_000 }, async () => {
    const harness = createShaderCanvasHarness("wgsl");
    try {
      await harness.compile({
        image: `fn mainImage(coord: vec2f) -> vec4f {
          let value = ${levelSum(24)};
          return vec4f(vec2f(tex23.size) / vec2f(256.0, 3.0), value, 1.0);
        }`,
        config: { version: "1", passes: { Image: { inputs: Object.fromEntries(
          Array.from({ length: 24 }, (_, i) => [`tex${i}`, { type: "keyboard" as const }]),
        ) } } },
      });
      expect(await harness.renderAndReadPixels()).toEqual(Array.from({ length: 4 }, () => [255, 255, 0, 255]));
    } finally {
      harness.dispose();
    }
  });

  it("compiles a WGSL shader with no configured inputs", { timeout: 30_000 }, async () => {
    const harness = createShaderCanvasHarness("wgsl");
    try {
      await harness.compile({
        image: "fn mainImage(coord: vec2f) -> vec4f { return vec4f(0.0, 0.0, 0.0, 1.0); }",
      });
      expect(await harness.renderAndReadPixels()).toEqual(Array.from({ length: 4 }, () => [0, 0, 0, 255]));
    } finally {
      harness.dispose();
    }
  });

  it("rejects access to an input that is not configured", { timeout: 30_000 }, async () => {
    const harness = createShaderCanvasHarness("wgsl");
    try {
      await expect(harness.compile({
        image: "fn mainImage(coord: vec2f) -> vec4f { return iChannel3Sample(coord / iResolution.xy); }",
      })).rejects.toThrow(/iChannel3/);
    } finally {
      harness.dispose();
    }
  });

  it("delivers slot-14 metadata through its configured input object", { timeout: 30_000 }, async () => {
    const harness = createShaderCanvasHarness("wgsl");
    try {
      await harness.compile({
        image: `fn mainImage(coord: vec2f) -> vec4f {
          return vec4f(vec2f(iChannel14.size) / vec2f(256.0, 3.0), 1.0, 1.0);
        }`,
        config: slot14Config,
      });
      expect(await harness.renderAndReadPixels()).toEqual(Array.from({ length: 4 }, () => [255, 255, 255, 255]));
    } finally {
      harness.dispose();
    }
  });
});
