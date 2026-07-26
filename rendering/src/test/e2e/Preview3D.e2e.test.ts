import { describe, expect, it } from "vitest";
import { createDefaultPreviewSettings } from "../../preview3d/types";
import { RenderingEngine } from "../../webgl/RenderingEngine";

const RED_SHADER =
  "void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(1.0, 0.0, 0.0, 1.0); }";

function readFramebufferPixel(canvas: HTMLCanvasElement, x: number, y: number): number[] {
  const gl = canvas.getContext("webgl2");
  if (!gl) {
    throw new Error("WebGL2 context unavailable");
  }
  const pixel = new Uint8Array(4);
  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  return Array.from(pixel);
}

describe("3D object preview e2e", () => {
  it("renders a mainImage shader on a cube and switches back to fullscreen 2D", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    document.body.appendChild(canvas);

    const engine = new RenderingEngine();
    engine.initialize(canvas, true);
    engine.setPreviewInputEnabled(true);
    engine.setPreviewSettings({
      ...createDefaultPreviewSettings(),
      mode: "3d",
      scene: { grid: false, axes: false },
    });

    const result = await engine.compileShaderPipeline(RED_SHADER, null, "preview-3d.glsl");
    expect(result?.success).toBe(true);

    engine.render(0);
    expect(readFramebufferPixel(canvas, 64, 64)).toEqual([255, 0, 0, 255]);
    expect(engine.readPixel(64, 64)).toBeNull();

    engine.setPreviewSettings(createDefaultPreviewSettings());
    engine.render(16);
    expect(engine.readPixel(64, 64)).toEqual({ r: 255, g: 0, b: 0, a: 255 });

    engine.dispose();
    document.body.removeChild(canvas);
  });
});
