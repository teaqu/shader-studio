import { describe, expect, it } from "vitest";
import type { ShaderConfig } from "@shader-studio/types";
import { createShaderCanvasHarness, type ShaderLanguage } from "./ShaderCanvasHarness";

/**
 * Isolates the cost of explicit-LOD sampling. Channel textures default to
 * `filter: "mipmap"` in both engines (TextureCache), so GLSL's `texture()` and
 * the Slang prelude's `inputs.iChannel0.Sample` pick a mip from the derivatives. A
 * Slang port that samples `inputs.iChannel0.SampleLevel(..., 0)` — the workaround for
 * WGSL's uniformity rule inside branches — always reads level 0 instead, which
 * on a minified texture turns coherent mip reads into scattered full-size
 * reads. This measures how much that costs at preview resolutions.
 */

const TEXTURE_SIZE = 1024;
const SAMPLES_PER_PIXEL = 8;
/** Minification factor: derivatives this large would select a coarse mip. */
const UV_SCALE = 48.0;

/** Random noise defeats texture-cache locality, the way a photo's detail does. */
function createNoiseTextureUrl(): string {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(TEXTURE_SIZE, TEXTURE_SIZE);
  let seed = 1;
  for (let index = 0; index < image.data.length; index += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    image.data[index] = seed & 0xff;
    image.data[index + 1] = (seed >> 8) & 0xff;
    image.data[index + 2] = (seed >> 16) & 0xff;
    image.data[index + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

const glslImage = `void mainImage(out vec4 color, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float sum = 0.0;
  for (int i = 0; i < ${SAMPLES_PER_PIXEL}; ++i) {
    vec2 p = uv * ${UV_SCALE.toFixed(1)} + vec2(float(i) * 0.37, float(i) * 0.71);
    sum += texture(iChannel0, p).r;
  }
  color = vec4(vec3(sum / float(${SAMPLES_PER_PIXEL})), 1.0);
}`;

/** Implicit LOD via the prelude helper — the mip chain is used. */
const slangImplicitLod = `float4 mainImage(float2 fragCoord) {
  float2 uv = fragCoord / iResolution.xy;
  float sum = 0.0;
  for (int i = 0; i < ${SAMPLES_PER_PIXEL}; ++i) {
    float2 p = uv * ${UV_SCALE.toFixed(1)} + float2(float(i) * 0.37, float(i) * 0.71);
    sum += inputs.iChannel0.Sample(p).r;
  }
  return float4(float3(sum / float(${SAMPLES_PER_PIXEL})), 1.0);
}`;

/** Explicit LOD 0 — what a port needs when sampling inside non-uniform branches. */
const slangExplicitLod0 = `float4 mainImage(float2 fragCoord) {
  float2 uv = fragCoord / iResolution.xy;
  float sum = 0.0;
  for (int i = 0; i < ${SAMPLES_PER_PIXEL}; ++i) {
    float2 p = uv * ${UV_SCALE.toFixed(1)} + float2(float(i) * 0.37, float(i) * 0.71);
    sum += inputs.iChannel0.SampleLevel(p, 0.0).r;
  }
  return float4(float3(sum / float(${SAMPLES_PER_PIXEL})), 1.0);
}`;

/** A per-pixel branch, so WGSL treats everything inside it as non-uniform. */
const NON_UNIFORM_BRANCH = "frac(sin(dot(fragCoord, float2(1.13, 2.37))) * 4321.0) > 0.5";

function slangBranchProgram(sampleExpression: string, hoisted = ""): string {
  return `float4 mainImage(float2 fragCoord) {
  float2 uv = fragCoord / iResolution.xy;
  ${hoisted}
  float sum = 0.0;
  if (${NON_UNIFORM_BRANCH}) {
    for (int i = 0; i < ${SAMPLES_PER_PIXEL}; ++i) {
      float2 p = uv * ${UV_SCALE.toFixed(1)} + float2(float(i) * 0.37, float(i) * 0.71);
      sum += ${sampleExpression};
    }
  }
  return float4(float3(sum / float(${SAMPLES_PER_PIXEL})), 1.0);
}`;
}

/** The workaround a port reaches for today: always level 0. */
const slangBranchLod0 = slangBranchProgram(
  "inputs.iChannel0.SampleLevel(p, 0.0).r",
);

/** Implicit LOD inside a non-uniform branch — rejected by WGSL's uniformity rules. */
const slangBranchImplicit = slangBranchProgram("inputs.iChannel0.Sample(p).r");

/** Explicit level from the known minification, chosen outside the branch. */
const slangBranchLodHelper = slangBranchProgram(
  "inputs.iChannel0.SampleLevel(p, lod).r",
  `float lod = log2(max(1.0, ${TEXTURE_SIZE}.0 * ${UV_SCALE.toFixed(1)} / iResolution.y));`,
);

/** Real gradients, taken in uniform control flow and carried into the branch. */
const slangBranchGradHelper = slangBranchProgram(
  "inputs.iChannel0.SampleGrad(p, dx, dy).r",
  `float2 base = uv * ${UV_SCALE.toFixed(1)};
  float2 dx = ddx(base);
  float2 dy = ddy(base);`,
);

function textureConfig(url: string): ShaderConfig {
  return {
    version: "1",
    passes: {
      Image: {
        inputs: {
          iChannel0: { type: "texture", path: url, resolved_path: url },
        },
      },
    },
  };
}

const WARMUP_FRAMES = 2;
const MEASURED_FRAMES = 4;

async function measureFrameMs(
  language: ShaderLanguage,
  image: string,
  config: ShaderConfig,
  width: number,
  height: number,
): Promise<number> {
  const harness = createShaderCanvasHarness(language);
  try {
    harness.resize(width, height);
    await harness.compile({ image, config });
    for (let frame = 0; frame < WARMUP_FRAMES; frame += 1) {
      await harness.renderAndReadRegion();
    }
    const startedAt = performance.now();
    for (let frame = 0; frame < MEASURED_FRAMES; frame += 1) {
      await harness.renderAndReadRegion();
    }
    return Number(((performance.now() - startedAt) / MEASURED_FRAMES).toFixed(2));
  } finally {
    harness.dispose();
  }
}

describe("channel sampling cost", () => {
  it("compares implicit-LOD and explicit-LOD-0 channel reads", { timeout: 300_000 }, async () => {
    const url = createNoiseTextureUrl();
    const config = textureConfig(url);

    // Kept modest: every frame is read back with a deadline, and a shared CI
    // runner is far slower than the machine this was written on.
    for (const { width, height } of [
      { width: 480, height: 270 },
      { width: 960, height: 540 },
    ]) {
      const glsl = await measureFrameMs("glsl", glslImage, config, width, height);
      const slangImplicit = await measureFrameMs("slang", slangImplicitLod, config, width, height);
      const slangLod0 = await measureFrameMs("slang", slangExplicitLod0, config, width, height);
      console.log("[ChannelSampling]", JSON.stringify({
        width,
        height,
        glslMs: glsl,
        slangImplicitLodMs: slangImplicit,
        slangLod0Ms: slangLod0,
        lod0OverGlsl: Number((slangLod0 / Math.max(glsl, 0.01)).toFixed(2)),
        lod0OverImplicit: Number((slangLod0 / Math.max(slangImplicit, 0.01)).toFixed(2)),
      }));
      expect(glsl).toBeGreaterThan(0);
      expect(slangImplicit).toBeGreaterThan(0);
      expect(slangLod0).toBeGreaterThan(0);
    }
  });

  it("samples with explicit level and gradients from a compute pass", { timeout: 120_000 }, async () => {
    const url = createNoiseTextureUrl();
    const harness = createShaderCanvasHarness("slang");
    try {
      await harness.compile({
        image: "float4 mainImage(float2 fragCoord) { return inputs.iChannel0.Sample(fragCoord / iResolution.xy); }",
        buffers: {
          SampleKernel: `[shader("compute")]
            [numthreads(1, 1, 1)]
            void fill(uint3 id : SV_DispatchThreadID) {
              float2 uv = float2(id.xy) * 0.5;
              // Neither implicit-LOD sampling nor derivatives exist here, but
              // both explicit forms do.
              float4 level = inputs.iChannel0.SampleLevel(uv, 2.0);
              float4 grad = inputs.iChannel0.SampleGrad(uv, float2(0.01, 0.0), float2(0.0, 0.01));
              writeOutput(id.xy, float4(level.r, grad.g, 1.0, 1.0));
            }`,
        },
        config: {
          version: "1",
          passes: {
            Image: { inputs: { iChannel0: { type: "buffer", source: "SampleKernel" } } },
            SampleKernel: {
              type: "compute",
              path: "sample-kernel.slang",
              entryPoint: "fill",
              resolution: { width: 2, height: 2 },
              inputs: { iChannel0: { type: "texture", path: url, resolved_path: url } },
            },
          },
        },
      });

      // Blue is written unconditionally; reaching it proves both helpers ran.
      for (const pixel of await harness.renderAndReadPixels()) {
        expect(pixel[2]).toBe(255);
        expect(pixel[3]).toBe(255);
      }
    } finally {
      harness.dispose();
    }
  });

  it("samples inside a non-uniform branch by every available route", { timeout: 300_000 }, async () => {
    const url = createNoiseTextureUrl();
    const config = textureConfig(url);

    // The generated WGSL carries diagnostic(off, derivative_uniformity), so a
    // channel read behind a per-pixel branch compiles and keeps its mip
    // selection instead of forcing the port onto level 0.
    const implicit = await measureFrameMs("slang", slangBranchImplicit, config, 960, 540);
    const lod0 = await measureFrameMs("slang", slangBranchLod0, config, 960, 540);
    const lodHelper = await measureFrameMs("slang", slangBranchLodHelper, config, 960, 540);
    const gradHelper = await measureFrameMs("slang", slangBranchGradHelper, config, 960, 540);

    console.log("[BranchSampling]", JSON.stringify({
      implicitMs: implicit,
      lod0Ms: lod0,
      lodHelperMs: lodHelper,
      gradHelperMs: gradHelper,
      lod0OverLodHelper: Number((lod0 / Math.max(lodHelper, 0.01)).toFixed(2)),
      lod0OverGradHelper: Number((lod0 / Math.max(gradHelper, 0.01)).toFixed(2)),
      lod0OverImplicit: Number((lod0 / Math.max(implicit, 0.01)).toFixed(2)),
    }));

    // What this guards is that all three compile and render inside a
    // non-uniform branch — which implicit-LOD sampling could not do before the
    // derivative-uniformity filter. The timings are logged rather than
    // asserted: which is fastest depends on the machine, and a comparison
    // between two sub-second measurements is not a fact a test can hold to.
    for (const frameMs of [implicit, lod0, lodHelper, gradHelper]) {
      expect(frameMs).toBeGreaterThan(0);
    }
  });
});
