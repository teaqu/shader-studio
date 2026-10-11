import { describe, expect, it, vi } from "vitest";
import { createShaderCanvasHarness, type ShaderLanguage } from "./ShaderCanvasHarness";

const SOURCE: Record<ShaderLanguage, string> = {
  glsl: "void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(0.2, 0.4, 0.6, 1.0); }",
  slang: "float4 mainImage(float2 fragCoord)\n{\n  return float4(0.2, 0.4, 0.6, 1.0);\n}",
  wgsl: "fn mainImage(coord: vec2f) -> vec4f {\n  return vec4f(0.2, 0.4, 0.6, 1.0);\n}",
};

describe("ShaderCanvasHarness", () => {
  it.each(['glsl', 'wgsl'] as const)('renders a changed shader time when the wall clock coincides with its synthetic timestamp (%s)', { timeout: 30_000 }, async language => {
    const harness = createShaderCanvasHarness(language);
    let clock: ReturnType<typeof vi.spyOn> | undefined;
    try {
      await harness.compile({ image: SOURCE[language] });
      const render = vi.spyOn(harness.engine, 'render');
      await harness.renderAndReadRegion(0);
      const nextTimestamp = render.mock.calls[0]![0]! + 1000 / 60;
      clock = vi.spyOn(performance, 'now').mockReturnValueOnce(nextTimestamp);
      const region = await harness.renderAndReadRegion(1);
      expect(harness.engine.getTimeManager().getFrame()).toBe(2);
      expect(region.some(value => value !== 0)).toBe(true);
    } finally {
      clock?.mockRestore();
      harness.dispose();
    }
  });
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
