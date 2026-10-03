import { describe, expect, it } from "vitest";
import type { ShaderConfig } from "@shader-studio/types";
import { createShaderCanvasHarness } from "./ShaderCanvasHarness";
import wgslSource from "../fixtures/native-camera-matrices.wgsl?raw";
import slangSource from "../fixtures/native-camera-matrices.slang?raw";

const config: ShaderConfig = {
  version: "1.0",
  passes: {
    Image: {
      geometry: { type: "cube" },
      entryPoints: { vertex: "cameraVertex", fragment: "cameraColor" },
    },
  },
};

function orbit(canvas: HTMLCanvasElement): void {
  // Synthetic browser-test PointerEvents have no active capture id. The real
  // viewer drag does; keep the production handler path while making that test
  // harness limitation inert.
  const capture = canvas.setPointerCapture;
  const release = canvas.releasePointerCapture;
  canvas.setPointerCapture = () => undefined;
  canvas.releasePointerCapture = () => undefined;
  canvas.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 12, clientX: 24, clientY: 24 }));
  canvas.dispatchEvent(new PointerEvent("pointermove", { button: 0, pointerId: 12, clientX: 88, clientY: 38 }));
  canvas.dispatchEvent(new PointerEvent("pointerup", { button: 0, pointerId: 12, clientX: 88, clientY: 38 }));
  canvas.setPointerCapture = capture;
  canvas.releasePointerCapture = release;
}

describe("native mesh matrix builtins", () => {
  it.each([
    ["wgsl", wgslSource],
    ["slang", slangSource],
  ] as const)("follows the existing viewer drag camera in %s", { timeout: 30_000 }, async (language, source) => {
    const harness = createShaderCanvasHarness(language);
    try {
      harness.resize(96, 96);
      await harness.compile({ path: `/native-camera.${language}`, image: source, config });
      const before = await harness.renderAndReadRegion();
      orbit(harness.canvas);
      const after = await harness.renderAndReadRegion();
      expect(after).not.toEqual(before);
      expect(after.some(channel => channel !== 0)).toBe(true);
    } finally {
      harness.dispose();
    }
  });
});
