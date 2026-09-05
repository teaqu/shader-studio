import { describe, expect, it } from "vitest";
import {
  createShaderCanvasHarness,
  type Pixel,
  type ShaderLanguage,
  type ShaderProgram,
} from "./ShaderCanvasHarness";

/** Paints iMouse.xy scaled into the red/green channels so a pointer move is visible in a readback. */
const mousePrograms: Record<ShaderLanguage, ShaderProgram> = {
  glsl: {
    image: `void mainImage(out vec4 color, in vec2 fragCoord) {
      color = vec4(iMouse.xy / iResolution.xy, 0.0, 1.0);
    }`,
  },
  slang: {
    image: `float4 mainImage(float2 fragCoord) {
      return float4(iMouse.xy / iResolution.xy, 0.0, 1.0);
    }`,
  },
};

/** Canvas is 2x2, so these land on distinct integer mouse pixels. */
const pointerDownPosition = { u: 0.25, v: 0.75 };
const pointerMovePosition = { u: 0.75, v: 0.25 };

const downPixel: Pixel = [0, 0, 0, 255];
const movedPixel: Pixel = [128, 128, 0, 255];

function dispatchPointer(
  canvas: HTMLCanvasElement,
  type: "pointerdown" | "pointermove",
  position: { u: number; v: number },
): void {
  const rect = canvas.getBoundingClientRect();
  canvas.dispatchEvent(new PointerEvent(type, {
    pointerId: 1,
    clientX: rect.left + rect.width * position.u,
    clientY: rect.top + rect.height * position.v,
  }));
}

describe.each(["glsl", "slang"] as const)("%s paused input freezing", (language) => {
  it("keeps iMouse frozen while paused and picks the pointer back up on resume", { timeout: 30_000 }, async () => {
    const harness = createShaderCanvasHarness(language);
    harness.canvas.setPointerCapture = () => {};
    harness.canvas.releasePointerCapture = () => {};
    try {
      await harness.compile(mousePrograms[language]);

      dispatchPointer(harness.canvas, "pointerdown", pointerDownPosition);
      const runningPixels = await harness.renderAndReadPixels();
      expect(runningPixels.every((pixel) => pixel.every((c, i) => c === downPixel[i]))).toBe(true);

      // Pause, then render once so the engine snapshots the frozen uniforms.
      harness.engine.togglePause();
      const firstPausedPixels = await harness.renderAndReadPixels();
      expect(firstPausedPixels[0]).toEqual(downPixel);

      // Moving the pointer while paused must not reach the shader.
      dispatchPointer(harness.canvas, "pointermove", pointerMovePosition);
      const pausedPixels = await harness.renderAndReadPixels();
      expect(pausedPixels[0]).toEqual(downPixel);

      // Resuming picks up where the pointer actually is.
      harness.engine.togglePause();
      const resumedPixels = await harness.renderAndReadPixels();
      expect(resumedPixels[0]).toEqual(movedPixel);
    } finally {
      harness.dispose();
    }
  });
});
