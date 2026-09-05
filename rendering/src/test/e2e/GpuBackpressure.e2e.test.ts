import { describe, expect, it } from "vitest";
import { createShaderCanvasHarness, type ShaderLanguage } from "./ShaderCanvasHarness";
import { MAX_FRAMES_IN_FLIGHT } from "../../util/GpuBackpressure";

/**
 * shouldWaitForGpu/trackFrameInFlight are covered against fakes in
 * WebGPUBackpressure.test.ts and WebGLBackpressure.test.ts, including that
 * framesInFlight/inFlightFences never grows past MAX_FRAMES_IN_FLIGHT there.
 * Fakes control exactly when a completion promise resolves or a fence
 * reports signaled; a real device decides that on its own schedule instead.
 *
 * This drives the real render loop, on real animation frames, against a
 * shader heavy enough that the GPU falls behind, and samples the same
 * private counters the unit tests check — proving the cap holds against
 * real onSubmittedWorkDone()/clientWaitSync() behaviour, not just a fake
 * standing in for it.
 *
 * A tick-count comparison (paced vs. unpaced loop) was tried first and
 * dropped: a real browser's compositor already throttles requestAnimationFrame
 * under sustained heavy GPU load on its own, which confounds a paced-vs-unpaced
 * frame count. The in-flight cap is a hard invariant instead of a relative
 * count, so it stays meaningful regardless of the runner's GPU speed.
 */

/** Heavy enough that a single frame's GPU completion outlasts several animation-frame ticks. */
const heavy: Record<ShaderLanguage, string> = {
  glsl: `void mainImage(out vec4 color, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    float acc = 0.0;
    for (int i = 0; i < 20000; ++i) {
      acc += sin(uv.x * float(i) + iTime) * cos(uv.y * float(i) * 1.37);
    }
    color = vec4(vec3(acc / 20000.0), 1.0);
  }`,
  slang: `float4 mainImage(float2 fragCoord) {
    float2 uv = fragCoord / iResolution.xy;
    float acc = 0.0;
    for (int i = 0; i < 20000; ++i) {
      acc += sin(uv.x * float(i) + iTime) * cos(uv.y * float(i) * 1.37);
    }
    return float4(float3(acc / 20000.0), 1.0);
  }`,
};

/** The private counter each engine paces against — same fields the fake-backed unit tests read. */
function inFlightCount(engine: object, language: ShaderLanguage): number {
  return language === "slang"
    ? (engine as { framesInFlight: number }).framesInFlight
    : (engine as { inFlightFences: unknown[] }).inFlightFences.length;
}

async function sampleMaxInFlight(language: ShaderLanguage, windowMs: number): Promise<number> {
  const harness = createShaderCanvasHarness(language);
  try {
    harness.resize(640, 360);
    await harness.compile({ image: heavy[language] });
    harness.engine.startRenderLoop();

    // A setTimeout poll races the render loop on an independent clock, and
    // can land outside the brief window a fence is actually outstanding —
    // worse under Chromium's background-timer throttling on a CI runner.
    // Sampling via requestAnimationFrame instead ties each check to the same
    // clock the loop itself renders on: registered right after
    // startRenderLoop(), it runs later within the very frame the loop just
    // rendered, so it always sees that tick's just-tracked frame before the
    // next tick releases it.
    let maxSeen = 0;
    const deadline = performance.now() + windowMs;
    await new Promise<void>((resolve) => {
      const sample = () => {
        maxSeen = Math.max(maxSeen, inFlightCount(harness.engine, language));
        if (performance.now() < deadline) {
          requestAnimationFrame(sample);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(sample);
    });

    harness.engine.stopRenderLoop();
    return maxSeen;
  } finally {
    harness.dispose();
  }
}

describe("GPU backpressure invariant against a real device", () => {
  it("never lets more than MAX_FRAMES_IN_FLIGHT real WebGPU submissions queue up", { timeout: 60_000 }, async () => {
    const maxSeen = await sampleMaxInFlight("slang", 600);

    console.log("[GpuBackpressure] webgpu maxFramesInFlight", maxSeen);
    // Greater than 0 proves the shader is genuinely GPU-bound enough for the
    // cap to matter, not just trivially satisfied by a shader that never
    // has two frames outstanding.
    expect(maxSeen).toBeGreaterThan(0);
    expect(maxSeen).toBeLessThanOrEqual(MAX_FRAMES_IN_FLIGHT);
  });

  it("never lets more than MAX_FRAMES_IN_FLIGHT real WebGL fences queue up", { timeout: 60_000 }, async () => {
    const maxSeen = await sampleMaxInFlight("glsl", 600);

    console.log("[GpuBackpressure] webgl maxFramesInFlight", maxSeen);
    expect(maxSeen).toBeGreaterThan(0);
    expect(maxSeen).toBeLessThanOrEqual(MAX_FRAMES_IN_FLIGHT);
  });
});
