import { expect, it, vi } from "vitest";
import { piCreateGlContext } from "../../../../vendor/pilibs/src/piWebUtils";

it("requests XR compatibility before shaders are allocated while preserving context options", () => {
  const gl = {};
  const getContext = vi.fn(() => gl);
  const canvas = { getContext } as unknown as HTMLCanvasElement;
  expect(piCreateGlContext(canvas, false, true, true, false, true)).toBe(gl);
  expect(getContext).toHaveBeenCalledWith("webgl2", expect.objectContaining({ xrCompatible: true, preserveDrawingBuffer: true, alpha: false, depth: true, antialias: false }));
});

it("keeps context fallback and default compatibility for existing callers", () => {
  const gl = {};
  const getContext = vi.fn().mockReturnValueOnce(null).mockReturnValueOnce(gl);
  const canvas = { getContext } as unknown as HTMLCanvasElement;
  expect(piCreateGlContext(canvas, false, true, false, false)).toBe(gl);
  expect(getContext).toHaveBeenLastCalledWith("experimental-webgl2", expect.objectContaining({ xrCompatible: false }));
});
