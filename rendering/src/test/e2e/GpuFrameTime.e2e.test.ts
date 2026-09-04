import { describe, expect, it } from "vitest";
import { createShaderCanvasHarness, type ShaderLanguage } from "./ShaderCanvasHarness";

/**
 * The render loop runs on animation frames and never waits for the GPU, so a
 * backend accepting frames faster than the hardware retires them reports a
 * healthy frame rate while the picture falls behind. Submit-to-completion
 * latency is the only figure that exposes that, so it has to survive contact
 * with a real device.
 */

const programs: Record<ShaderLanguage, string> = {
  glsl: `void mainImage(out vec4 color, in vec2 fragCoord) {
    color = vec4(fragCoord / iResolution.xy, 0.0, 1.0);
  }`,
  slang: `float4 mainImage(float2 fragCoord) {
    return float4(fragCoord / iResolution.xy, 0.0, 1.0);
  }`,
};

/** Deliberately far more work than one frame's worth at this size. */
const heavySlang = `float4 mainImage(float2 fragCoord) {
  float2 uv = fragCoord / iResolution.xy;
  float acc = 0.0;
  for (int i = 0; i < 4000; ++i) {
    acc += sin(uv.x * float(i) + iTime) * cos(uv.y * float(i) * 1.37);
  }
  return float4(float3(acc / 4000.0), 1.0);
}`;

async function renderFrames(language: ShaderLanguage, image: string, width: number, height: number, frames: number) {
  const harness = createShaderCanvasHarness(language);
  harness.resize(width, height);
  await harness.compile({ image });
  for (let frame = 0; frame < frames; frame += 1) {
    await harness.renderAndReadRegion();
  }
  return harness;
}

describe("GPU frame time", () => {
  it("reports submit-to-completion latency for the WebGPU engine", { timeout: 120_000 }, async () => {
    const harness = await renderFrames("slang", programs.slang, 640, 360, 6);
    try {
      const gpuMs = harness.engine.getGpuFrameTimeMs?.() ?? null;

      expect(gpuMs).not.toBeNull();
      expect(gpuMs!).toBeGreaterThan(0);
      // A trivial shader at this size finishes well inside a second.
      expect(gpuMs!).toBeLessThan(1000);
      console.log("[GpuFrameTime] trivial", JSON.stringify({ gpuMs }));
    } finally {
      harness.dispose();
    }
  });

  it("grows with the work the GPU is given", { timeout: 120_000 }, async () => {
    const light = await renderFrames("slang", programs.slang, 1280, 720, 6);
    const lightMs = light.engine.getGpuFrameTimeMs?.() ?? null;
    light.dispose();

    const heavy = await renderFrames("slang", heavySlang, 1280, 720, 6);
    const heavyMs = heavy.engine.getGpuFrameTimeMs?.() ?? null;
    heavy.dispose();

    console.log("[GpuFrameTime] scaling", JSON.stringify({ lightMs, heavyMs }));
    expect(heavyMs!).toBeGreaterThan(lightMs!);
  });

  it("reports submit-to-completion latency for the WebGL engine too", { timeout: 120_000 }, async () => {
    const harness = await renderFrames("glsl", programs.glsl, 640, 360, 6);
    try {
      const gpuMs = harness.engine.getGpuFrameTimeMs?.() ?? null;

      expect(gpuMs).not.toBeNull();
      expect(gpuMs!).toBeGreaterThan(0);
      expect(gpuMs!).toBeLessThan(1000);
      console.log("[GpuFrameTime] webgl", JSON.stringify({ gpuMs }));
    } finally {
      harness.dispose();
    }
  });

  it("measures both engines on the same shader, so the two can be compared", { timeout: 180_000 }, async () => {
    const glsl = await renderFrames("glsl", programs.glsl, 1280, 720, 6);
    const glslMs = glsl.engine.getGpuFrameTimeMs?.() ?? null;
    glsl.dispose();

    const slang = await renderFrames("slang", programs.slang, 1280, 720, 6);
    const slangMs = slang.engine.getGpuFrameTimeMs?.() ?? null;
    slang.dispose();

    console.log("[GpuFrameTime] engines", JSON.stringify({ glslMs, slangMs }));
    expect(glslMs).not.toBeNull();
    expect(slangMs).not.toBeNull();
  });
});
