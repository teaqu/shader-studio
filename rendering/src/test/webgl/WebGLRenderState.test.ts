import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyWebGLRenderState,
  restoreWebGLRenderState,
  webglBlendFactors,
  webglDepthFunc,
} from "../../webgl/WebGLRenderState";
import type { ResolvedRenderState } from "../../types/Geometry";

const createGl = () => ({
  BLEND: 0x0be2,
  DEPTH_TEST: 0x0b71,
  CULL_FACE: 0x0b44,
  NEVER: 0x0200,
  LESS: 0x0201,
  EQUAL: 0x0202,
  LEQUAL: 0x0203,
  GREATER: 0x0204,
  NOTEQUAL: 0x0205,
  GEQUAL: 0x0206,
  ALWAYS: 0x0207,
  ZERO: 0,
  ONE: 1,
  SRC_ALPHA: 0x0302,
  ONE_MINUS_SRC_ALPHA: 0x0303,
  FUNC_ADD: 0x8006,
  FRONT: 0x0404,
  BACK: 0x0405,
  CCW: 0x0901,
  enable: vi.fn(),
  disable: vi.fn(),
  blendEquation: vi.fn(),
  blendFunc: vi.fn(),
  blendFuncSeparate: vi.fn(),
  depthFunc: vi.fn(),
  depthMask: vi.fn(),
  cullFace: vi.fn(),
  frontFace: vi.fn(),
});

describe("WebGLRenderState", () => {
  let gl: ReturnType<typeof createGl>;
  const asGl = () => gl as unknown as WebGL2RenderingContext;
  const state = (overrides: Partial<ResolvedRenderState> = {}): ResolvedRenderState => ({
    blend: "none",
    clear: [0, 0, 0, 1],
    depth: { test: true, write: true, compare: "less" },
    cull: "none",
    ...overrides,
  });

  beforeEach(() => {
    gl = createGl();
  });

  it.each([
    ["alpha", ["SRC_ALPHA", "ONE_MINUS_SRC_ALPHA", "ONE", "ONE_MINUS_SRC_ALPHA"]],
    ["premultiplied", ["ONE", "ONE_MINUS_SRC_ALPHA", "ONE", "ONE_MINUS_SRC_ALPHA"]],
    ["additive", ["ONE", "ONE", "ONE", "ONE"]],
  ] as const)("maps %s blending to its factors with FUNC_ADD", (blend, factors) => {
    expect(webglBlendFactors(asGl(), blend)).toEqual(factors.map((name) => gl[name]));

    applyWebGLRenderState(asGl(), state({ blend }));

    expect(gl.enable).toHaveBeenCalledWith(gl.BLEND);
    expect(gl.blendEquation).toHaveBeenCalledWith(gl.FUNC_ADD);
    expect(gl.blendFuncSeparate).toHaveBeenCalledWith(...factors.map((name) => gl[name]));
  });

  it("disables blending for none", () => {
    applyWebGLRenderState(asGl(), state());

    expect(gl.disable).toHaveBeenCalledWith(gl.BLEND);
    expect(gl.enable).not.toHaveBeenCalledWith(gl.BLEND);
    expect(gl.blendFuncSeparate).not.toHaveBeenCalled();
  });

  it.each([
    ["never", "NEVER"],
    ["less", "LESS"],
    ["equal", "EQUAL"],
    ["less-equal", "LEQUAL"],
    ["greater", "GREATER"],
    ["not-equal", "NOTEQUAL"],
    ["greater-equal", "GEQUAL"],
    ["always", "ALWAYS"],
  ] as const)("maps depth compare %s to %s", (compare, func) => {
    expect(webglDepthFunc(asGl(), compare)).toBe(gl[func]);

    applyWebGLRenderState(asGl(), state({ depth: { test: true, write: false, compare } }));

    expect(gl.enable).toHaveBeenCalledWith(gl.DEPTH_TEST);
    expect(gl.depthFunc).toHaveBeenCalledWith(gl[func]);
    expect(gl.depthMask).toHaveBeenCalledWith(false);
  });

  it("keeps DEPTH_TEST enabled with ALWAYS when the test is off, so writes still happen", () => {
    applyWebGLRenderState(asGl(), state({ depth: { test: false, write: true, compare: "greater" } }));

    expect(gl.enable).toHaveBeenCalledWith(gl.DEPTH_TEST);
    expect(gl.depthFunc).toHaveBeenCalledWith(gl.ALWAYS);
    expect(gl.depthMask).toHaveBeenCalledWith(true);
  });

  it("disables the depth test for passes without depth state", () => {
    applyWebGLRenderState(asGl(), state({ depth: null }));

    expect(gl.disable).toHaveBeenCalledWith(gl.DEPTH_TEST);
    expect(gl.depthFunc).not.toHaveBeenCalled();
    expect(gl.depthMask).not.toHaveBeenCalled();
  });

  it.each([
    ["back", "BACK"],
    ["front", "FRONT"],
  ] as const)("culls %s faces with CCW front faces", (cull, face) => {
    applyWebGLRenderState(asGl(), state({ cull }));

    expect(gl.enable).toHaveBeenCalledWith(gl.CULL_FACE);
    expect(gl.frontFace).toHaveBeenCalledWith(gl.CCW);
    expect(gl.cullFace).toHaveBeenCalledWith(gl[face]);
  });

  it("disables culling for none", () => {
    applyWebGLRenderState(asGl(), state());

    expect(gl.disable).toHaveBeenCalledWith(gl.CULL_FACE);
    expect(gl.cullFace).not.toHaveBeenCalled();
  });

  it("returns a restore function that resets GL's initial blend, depth and cull state", () => {
    const restore = applyWebGLRenderState(asGl(), state({
      blend: "additive",
      depth: { test: true, write: false, compare: "greater" },
      cull: "front",
    }));
    vi.clearAllMocks();

    restore();

    expect(gl.disable).toHaveBeenCalledWith(gl.BLEND);
    expect(gl.blendEquation).toHaveBeenCalledWith(gl.FUNC_ADD);
    expect(gl.blendFunc).toHaveBeenCalledWith(gl.ONE, gl.ZERO);
    expect(gl.disable).toHaveBeenCalledWith(gl.DEPTH_TEST);
    expect(gl.depthFunc).toHaveBeenCalledWith(gl.LESS);
    expect(gl.depthMask).toHaveBeenCalledWith(true);
    expect(gl.disable).toHaveBeenCalledWith(gl.CULL_FACE);
    expect(gl.cullFace).toHaveBeenCalledWith(gl.BACK);
    expect(gl.frontFace).toHaveBeenCalledWith(gl.CCW);
    expect(gl.enable).not.toHaveBeenCalled();
  });

  it("restores the same defaults when called directly", () => {
    restoreWebGLRenderState(asGl());

    expect(gl.depthMask).toHaveBeenCalledWith(true);
    expect(gl.blendFunc).toHaveBeenCalledWith(gl.ONE, gl.ZERO);
  });
});
