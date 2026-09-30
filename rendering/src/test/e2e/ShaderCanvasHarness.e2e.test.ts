import { describe, expect, it } from "vitest";
import { createShaderCanvasHarness, type ShaderLanguage } from "./ShaderCanvasHarness";

const SOURCE: Record<ShaderLanguage, string> = {
  glsl: "void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(0.2, 0.4, 0.6, 1.0); }",
  slang: "float4 mainImage(float2 fragCoord)\n{\n  return float4(0.2, 0.4, 0.6, 1.0);\n}",
  wgsl: "fn mainImage(coord: vec2f) -> vec4f {\n  return vec4f(0.2, 0.4, 0.6, 1.0);\n}",
};

describe("ShaderCanvasHarness", () => {
  // Vitest does not stop a test body when the test times out. A timed-out
  // test that keeps reading back on a shared harness used to collect the next
  // test's result along with its own, so that test failed later with a
  // misleading "still not held" readback timeout.
  it.each(["glsl", "slang", "wgsl"] as const)(
    "refuses a second readback while one is in flight instead of taking its result (%s)",
    { timeout: 30_000 },
    async (language) => {
      const harness = createShaderCanvasHarness(language);
      try {
        await harness.compile({ path: `/overlap.${language}`, image: SOURCE[language] });

        const first = harness.renderAndReadRegion(0);
        await expect(harness.renderAndReadRegion(0)).rejects.toThrow(/already has a readback in flight/);

        const region = await first;
        expect(region.length).toBeGreaterThan(0);
        // Once the first readback settles the harness is usable again.
        expect((await harness.renderAndReadRegion(0)).length).toBe(region.length);
      } finally {
        harness.dispose();
      }
    },
  );
});
