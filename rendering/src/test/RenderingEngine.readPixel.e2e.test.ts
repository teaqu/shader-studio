import { describe, expect, it } from "vitest";
import { RenderingEngine } from "../RenderingEngine";

describe("RenderingEngine readPixel e2e", () => {
  it("should read white from a 1x1 canvas rendering vec4(1.0, 1.0, 1.0, 0.0)", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    document.body.appendChild(canvas);

    const engine = new RenderingEngine();
    engine.initialize(canvas, true);

    const result = await engine.compileShaderPipeline(
      "void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(1.0, 1.0, 1.0, 0.0); }",
      null,
      "test.glsl",
    );

    expect(result?.success).toBe(true);

    engine.render(0);

    const pixel = engine.readPixel(0, 0);

    // alpha: false on the WebGL context means alpha is always 255
    // same as shadertoy
    expect(pixel).toEqual({
      r: 255,
      g: 255,
      b: 255,
      a: 255,
    });

    engine.dispose();
    document.body.removeChild(canvas);
  });
});
