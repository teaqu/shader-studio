import { describe, expect, it } from "vitest";
import type { ShaderConfig } from "@shader-studio/types";
import { createShaderCanvasHarness } from "./ShaderCanvasHarness";

const hookSource: Record<"wgsl" | "slang", string> = {
  wgsl: `fn mainImage(coord: vec2f) -> vec4f {
  let value = abs(iWorldPosition) * 0.65 + vec3f(0.08, 0.03, 0.12);
  return vec4f(value, 1.0);
}`,
  slang: `float4 mainImage(float2 coord) {
  float3 value = abs(iWorldPosition) * 0.65 + float3(0.08, 0.03, 0.12);
  return float4(value, 1);
}`,
};

const cubeConfig: ShaderConfig = {
  version: "1.0",
  passes: { Image: { geometry: { type: "cube" } } },
};

function dragOrbit(canvas: HTMLCanvasElement): void {
  // Synthetic PointerEvents lack an active capture id; real browser drags do.
  const capture = canvas.setPointerCapture;
  const release = canvas.releasePointerCapture;
  canvas.setPointerCapture = () => undefined;
  canvas.releasePointerCapture = () => undefined;
  canvas.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 44, clientX: 16, clientY: 16 }));
  canvas.dispatchEvent(new PointerEvent("pointermove", { button: 0, pointerId: 44, clientX: 78, clientY: 33 }));
  canvas.dispatchEvent(new PointerEvent("pointerup", { button: 0, pointerId: 44, clientX: 78, clientY: 33 }));
  canvas.setPointerCapture = capture;
  canvas.releasePointerCapture = release;
}

describe("hook mesh camera fallback", () => {
  it.each(["wgsl", "slang"] as const)("orbits a %s cube without mainVertex or a selected native vertex", { timeout: 30_000 }, async language => {
    const harness = createShaderCanvasHarness(language);
    try {
      harness.resize(96, 96);
      await harness.compile({ path: `/hook-cube.${language}`, image: hookSource[language], config: cubeConfig });
      const before = await harness.renderAndReadRegion();
      dragOrbit(harness.canvas);
      const after = await harness.renderAndReadRegion();
      expect(after).not.toEqual(before);
      expect(after.some(value => value !== 0)).toBe(true);
    } finally {
      harness.dispose();
    }
  });
});
