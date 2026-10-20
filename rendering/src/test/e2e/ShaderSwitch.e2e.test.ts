import { describe, expect, it, vi } from "vitest";
import { RenderingEngine } from "../../webgl/RenderingEngine";

const RED_SHADER =
  "void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(1.0, 0.0, 0.0, 1.0); }";
const GREEN_SHADER =
  "void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(0.0, 1.0, 0.0, 1.0); }";
const BROKEN_SHADER =
  "void mainImage(out vec4 fragColor, in vec2 fragCoord) { UNDEFINED_SYMBOL; }";

function createEngine(): { engine: RenderingEngine; canvas: HTMLCanvasElement } {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  document.body.appendChild(canvas);

  const engine = new RenderingEngine();
  engine.initialize(canvas, true);
  return { engine, canvas };
}

function cleanup(engine: RenderingEngine, canvas: HTMLCanvasElement): void {
  engine.dispose();
  document.body.removeChild(canvas);
}

describe("Shader switch e2e", () => {
  it("eventually renders a switched shader after a pending GPU frame completes", async () => {
    const { engine, canvas } = createEngine();
    const gl = canvas.getContext("webgl2")!;
    const wait = vi.spyOn(gl, "clientWaitSync").mockReturnValue(gl.TIMEOUT_EXPIRED);
    engine.setGpuBackpressureDefaults({ framesInFlight: 1 });

    try {
      await engine.compileShaderPipeline(RED_SHADER, null, "red.glsl");
      engine.render(0);
      expect(engine.readPixel(0, 0)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
      await engine.compileShaderPipeline(GREEN_SHADER, null, "green.glsl");
      engine.render(16);
      // Switching shaders must retain the pending GPU submission limit.
      expect(engine.readPixel(0, 0)).toEqual({ r: 255, g: 0, b: 0, a: 255 });

      // GPU completion becomes observable in a subsequent event-loop task.
      setTimeout(() => wait.mockReturnValue(gl.ALREADY_SIGNALED), 0);
      await expect.poll(() => {
        engine.render(32);
        return engine.readPixel(0, 0);
      }).toEqual({ r: 0, g: 255, b: 0, a: 255 });
    } finally {
      wait.mockRestore();
      cleanup(engine, canvas);
    }
  });

  it("should render red, switch to green, and read green", async () => {
    const { engine, canvas } = createEngine();

    await engine.compileShaderPipeline(RED_SHADER, null, "red.glsl");
    engine.render(0);
    expect(engine.readPixel(0, 0)).toEqual({ r: 255, g: 0, b: 0, a: 255 });

    await engine.compileShaderPipeline(GREEN_SHADER, null, "green.glsl");
    engine.render(16);
    expect(engine.readPixel(0, 0)).toEqual({ r: 0, g: 255, b: 0, a: 255 });

    cleanup(engine, canvas);
  });

  it("should clear canvas when switching to a broken shader", async () => {
    const { engine, canvas } = createEngine();

    // Compile and render a working shader
    await engine.compileShaderPipeline(RED_SHADER, null, "red.glsl");
    engine.render(0);
    expect(engine.readPixel(0, 0)).toEqual({ r: 255, g: 0, b: 0, a: 255 });

    // Switch to a broken shader (different path)
    const result = await engine.compileShaderPipeline(BROKEN_SHADER, null, "broken.glsl");
    expect(result?.success).toBe(false);

    // Render a frame — should clear because this is a different shader path
    engine.render(16);
    expect(engine.readPixel(0, 0)).toEqual({ r: 0, g: 0, b: 0, a: 255 });

    cleanup(engine, canvas);
  });

  it("should recover from broken shader when switching to a working one", async () => {
    const { engine, canvas } = createEngine();

    // Start with working shader
    await engine.compileShaderPipeline(RED_SHADER, null, "red.glsl");
    engine.render(0);
    expect(engine.readPixel(0, 0)).toEqual({ r: 255, g: 0, b: 0, a: 255 });

    // Switch to broken shader
    const broken = await engine.compileShaderPipeline(BROKEN_SHADER, null, "broken.glsl");
    expect(broken?.success).toBe(false);
    engine.render(16);
    expect(engine.readPixel(0, 0)).toEqual({ r: 0, g: 0, b: 0, a: 255 });

    // The default two-frame queue may still contain the preceding submissions.
    // Yield between render attempts so WebGL can report fence completion.
    await engine.compileShaderPipeline(GREEN_SHADER, null, "green.glsl");
    await expect.poll(() => {
      engine.render(32);
      return engine.readPixel(0, 0);
    }).toEqual({ r: 0, g: 255, b: 0, a: 255 });

    cleanup(engine, canvas);
  });

  it("should reset frame counter when switching to a different shader", async () => {
    const { engine, canvas } = createEngine();

    await engine.compileShaderPipeline(RED_SHADER, null, "red.glsl");
    // Render several frames to advance the frame counter
    engine.render(0);
    engine.render(16);
    engine.render(32);
    const frameBefore = engine.getTimeManager().getFrame();
    expect(frameBefore).toBeGreaterThan(0);

    // Switch to a different shader — frame should reset to 0
    await engine.compileShaderPipeline(GREEN_SHADER, null, "green.glsl");
    const frameAfter = engine.getTimeManager().getFrame();
    expect(frameAfter).toBe(0);

    cleanup(engine, canvas);
  });

  it("should NOT reset frame counter when recompiling the same shader path", async () => {
    const { engine, canvas } = createEngine();

    await engine.compileShaderPipeline(RED_SHADER, null, "same.glsl");
    engine.render(0);
    engine.render(16);
    engine.render(32);
    const frameBefore = engine.getTimeManager().getFrame();
    expect(frameBefore).toBeGreaterThan(0);

    // Recompile same path with different code — frame should be preserved
    await engine.compileShaderPipeline(GREEN_SHADER, null, "same.glsl");
    const frameAfter = engine.getTimeManager().getFrame();
    expect(frameAfter).toBe(frameBefore);

    cleanup(engine, canvas);
  });

  it("should preserve the previous shader after a failed recompile on the same path", async () => {
    const { engine, canvas } = createEngine();

    // Render red
    await engine.compileShaderPipeline(RED_SHADER, null, "red.glsl");
    engine.render(0);
    expect(engine.readPixel(0, 0)).toEqual({ r: 255, g: 0, b: 0, a: 255 });

    // Recompile the same shader path with broken code — last good output should remain
    await engine.compileShaderPipeline(BROKEN_SHADER, null, "red.glsl");

    // Even after another render frame, the old red shader should still be active
    engine.render(16);
    expect(engine.readPixel(0, 0)).toEqual({ r: 255, g: 0, b: 0, a: 255 });

    cleanup(engine, canvas);
  });
});
