import { describe, expect, it, vi } from "vitest";
import { withVrViewport } from "../../webxr/VrViewport";

const view = { viewport: { x: 1, y: 2, width: 3, height: 4 }, rayTransform: new Float32Array(16) };
const gl = (enabled = false) => ({ SCISSOR_TEST: 1, SCISSOR_BOX: 2, isEnabled: vi.fn(() => enabled), getParameter: vi.fn(() => Int32Array.from([8, 9, 10, 11])), enable: vi.fn(), disable: vi.fn(), scissor: vi.fn() });

describe("withVrViewport", () => {
  it("scissors an eye and restores a disabled prior state", () => {
    const target = gl();
    const draw = vi.fn();
    withVrViewport(target as unknown as WebGL2RenderingContext, view, draw);
    expect(draw).toHaveBeenCalledOnce();
    expect(target.enable).toHaveBeenCalledWith(1);
    expect(target.scissor.mock.calls).toEqual([[1, 2, 3, 4], [8, 9, 10, 11]]);
    expect(target.disable).toHaveBeenCalledWith(1);
  });

  it("restores the box even when drawing throws and preserves enabled state", () => {
    const target = gl(true);
    expect(() => withVrViewport(target as unknown as WebGL2RenderingContext, view, () => {
      throw new Error("draw failed");
    })).toThrow("draw failed");
    expect(target.disable).not.toHaveBeenCalled();
    expect(target.scissor).toHaveBeenLastCalledWith(8, 9, 10, 11);
  });

  it("requires WebGL2", () => {
    expect(() => withVrViewport(null, view, vi.fn())).toThrow("Headset rendering requires WebGL2");
  });
});
