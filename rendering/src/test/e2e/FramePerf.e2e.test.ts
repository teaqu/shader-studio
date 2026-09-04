import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createShaderCanvasHarness, type ShaderLanguage } from "./ShaderCanvasHarness";

/**
 * Exercises the `window.__shaderPerf` instrumentation against real engines, so
 * the payloads collected from a VS Code webview can be trusted to carry what
 * the comparison needs: which adapter the host handed the engine, the canvas
 * backing store it is actually rendering, and the frame rate it reaches.
 */

type PerfGlobal = typeof globalThis & { __shaderPerf?: boolean };

const programs: Record<ShaderLanguage, string> = {
  glsl: `void mainImage(out vec4 color, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    float acc = 0.0;
    for (int i = 0; i < 64; ++i) {
      acc += sin(uv.x * float(i) + iTime) * cos(uv.y * float(i));
    }
    color = vec4(vec3(acc / 64.0), 1.0);
  }`,
  slang: `float4 mainImage(float2 fragCoord) {
    float2 uv = fragCoord / iResolution.xy;
    float acc = 0.0;
    for (int i = 0; i < 64; ++i) {
      acc += sin(uv.x * float(i) + iTime) * cos(uv.y * float(i));
    }
    return float4(float3(acc / 64.0), 1.0);
  }`,
};

const WIDTH = 1280;
const HEIGHT = 720;
/** Long enough for the tracker's 120-frame window to close at 60fps. */
const SAMPLE_MS = 2600;

interface PerfLine {
  event: string;
  payload: Record<string, unknown>;
}

function capture(): { lines: PerfLine[]; restore: () => void } {
  const lines: PerfLine[] = [];
  const original = console.log;
  const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    const [line] = args;
    if (typeof line === "string" && line.startsWith("[ShaderPerf] ")) {
      const start = line.indexOf("{");
      lines.push({
        event: line.slice("[ShaderPerf] ".length, start).trim(),
        payload: JSON.parse(line.slice(start)) as Record<string, unknown>,
      });
    }
    original.apply(console, args as []);
  });
  return { lines, restore: () => spy.mockRestore() };
}

async function run(language: ShaderLanguage): Promise<PerfLine[]> {
  const { lines, restore } = capture();
  // The init payload is emitted while the engine acquires its device.
  const harness = createShaderCanvasHarness(language);
  try {
    harness.resize(WIDTH, HEIGHT);
    await harness.compile({ image: programs[language] });
    harness.engine.getTimeManager().setSpeed(1);
    harness.engine.startRenderLoop();
    await new Promise((resolve) => setTimeout(resolve, SAMPLE_MS));
    harness.engine.stopRenderLoop();
    return lines;
  } finally {
    restore();
    harness.dispose();
  }
}

describe("__shaderPerf instrumentation", () => {
  beforeEach(() => {
    (globalThis as PerfGlobal).__shaderPerf = true;
  });

  afterEach(() => {
    delete (globalThis as PerfGlobal).__shaderPerf;
  });

  it.each(["glsl", "slang"] as const)("reports adapter, canvas and frame rate for %s", { timeout: 120_000 }, async (language) => {
    const engine = language === "glsl" ? "webgl" : "webgpu";
    const lines = await run(language);

    const init = lines.find((line) => line.event === `${engine} init`);
    expect(init, `${engine} init was not logged`).toBeDefined();
    // Init fires while the engine acquires its context, which for WebGL is
    // before the first resize — so it describes the canvas as it stood then.
    expect(init!.payload).toHaveProperty("backingWidth");
    expect(init!.payload).toHaveProperty("devicePixelRatio");
    if (engine === "webgpu") {
      // A software device here would explain any amount of slowness.
      expect(init!.payload).toHaveProperty("isFallbackAdapter");
      expect(init!.payload).toHaveProperty("adapter");
    } else {
      expect(typeof init!.payload.renderer === "string" || init!.payload.renderer === null).toBe(true);
    }

    const frames = lines.filter((line) => line.event === `${engine} frames`);
    expect(frames.length, `${engine} never completed a report window`).toBeGreaterThan(0);
    const report = frames[0]!.payload;
    expect(report.fps as number).toBeGreaterThan(0);
    expect(report.backingPixels).toBe(WIDTH * HEIGHT);
    expect(report.cpuMsAvg as number).toBeGreaterThanOrEqual(0);
    expect(report).toHaveProperty("fpsLimit");
    // Pacing: an average frame rate can look healthy while motion stutters.
    expect(report.gapMsP50 as number).toBeGreaterThan(0);
    expect(report.gapMsP95 as number).toBeGreaterThanOrEqual(report.gapMsP50 as number);
    expect(report.hitches as number).toBeGreaterThanOrEqual(0);
    console.log(`[FramePerfSummary] ${engine}`, JSON.stringify({ init: init!.payload, report }));
  });
});
