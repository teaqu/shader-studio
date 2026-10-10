import { describe, expect, it } from "vitest";
import { createShaderCanvasHarness } from "./ShaderCanvasHarness";

describe("desktop mainVR rendering", () => {
  it("renders normalized rays and responds to desktop camera movement", async () => {
    const harness = createShaderCanvasHarness("glsl");
    try {
      await harness.compile({ image: `
        void mainImage(out vec4 color, in vec2 coord) { color = vec4(1.0, 0.0, 0.0, 1.0); }
        void mainVR(out vec4 color, in vec2 coord, in vec3 origin, in vec3 direction) {
          color = vec4(direction.xy * 0.5 + 0.5, clamp(length(origin), 0.0, 1.0), 1.0);
        }` });
      expect(await harness.renderAndReadPixels()).toEqual(Array(4).fill([255, 0, 0, 255]));
      expect(harness.engine.isVrPreviewAvailable?.()).toBe(true);
      harness.engine.setVrPreviewEnabled?.(true);
      const pixels = await harness.renderAndReadPixels();
      expect(pixels[0][0]).not.toBe(pixels[1][0]);
      expect(pixels[0][1]).not.toBe(pixels[2][1]);
      expect(pixels.every((pixel) => pixel[2] === 0 && pixel[3] === 255)).toBe(true);
      const event = new KeyboardEvent("keydown", { key: "w", code: "KeyW" });
      Object.defineProperty(event, "keyCode", { value: 87 });
      window.dispatchEvent(event);
      await harness.renderAndReadPixels();
      const moved = await harness.renderAndReadPixels();
      const release = new KeyboardEvent("keyup", { key: "w", code: "KeyW" });
      Object.defineProperty(release, "keyCode", { value: 87 });
      window.dispatchEvent(release);
      expect(moved.some((pixel) => pixel[2] > 0)).toBe(true);
      harness.engine.setVrPreviewEnabled?.(false);
      expect(await harness.renderAndReadPixels()).toEqual(Array(4).fill([255, 0, 0, 255]));
    } finally {
      harness.dispose();
    }
  });
});
