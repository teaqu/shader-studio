import type { BlendMode, CullMode, DepthCompareFunction } from "@shader-studio/types";
import type { ResolvedRenderState } from "../types/Geometry";

type GL = WebGL2RenderingContext;

/** [srcRGB, dstRGB, srcAlpha, dstAlpha] for each blend mode; equations are always FUNC_ADD. */
export function webglBlendFactors(gl: GL, blend: Exclude<BlendMode, "none">): [GLenum, GLenum, GLenum, GLenum] {
  switch (blend) {
    case "alpha":
      return [gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA];
    case "premultiplied":
      return [gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA];
    case "additive":
      return [gl.ONE, gl.ONE, gl.ONE, gl.ONE];
  }
}

export function webglDepthFunc(gl: GL, compare: DepthCompareFunction): GLenum {
  switch (compare) {
    case "never": return gl.NEVER;
    case "less": return gl.LESS;
    case "equal": return gl.EQUAL;
    case "less-equal": return gl.LEQUAL;
    case "greater": return gl.GREATER;
    case "not-equal": return gl.NOTEQUAL;
    case "greater-equal": return gl.GEQUAL;
    case "always": return gl.ALWAYS;
  }
}

function webglCullFace(gl: GL, cull: Exclude<CullMode, "none">): GLenum {
  return cull === "back" ? gl.BACK : gl.FRONT;
}

/**
 * Apply a pass's blend/depth/cull and return a function that puts the GL
 * defaults back, so the state never reaches later passes, variable capture or
 * pixel-region reads. A disabled depth test still writes depth when asked, as
 * WebGPU does, by testing with ALWAYS rather than disabling DEPTH_TEST.
 */
export function applyWebGLRenderState(gl: GL, state: ResolvedRenderState): () => void {
  if (state.blend === "none") {
    gl.disable(gl.BLEND);
  } else {
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    const [srcRgb, dstRgb, srcAlpha, dstAlpha] = webglBlendFactors(gl, state.blend);
    gl.blendFuncSeparate(srcRgb, dstRgb, srcAlpha, dstAlpha);
  }

  if (state.depth) {
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(state.depth.test ? webglDepthFunc(gl, state.depth.compare) : gl.ALWAYS);
    gl.depthMask(state.depth.write);
  } else {
    gl.disable(gl.DEPTH_TEST);
  }

  if (state.cull === "none") {
    gl.disable(gl.CULL_FACE);
  } else {
    gl.enable(gl.CULL_FACE);
    gl.frontFace(gl.CCW);
    gl.cullFace(webglCullFace(gl, state.cull));
  }

  return () => restoreWebGLRenderState(gl);
}

/** GL's initial blend, depth and cull state, which every other draw path assumes. */
export function restoreWebGLRenderState(gl: GL): void {
  gl.disable(gl.BLEND);
  gl.blendEquation(gl.FUNC_ADD);
  gl.blendFunc(gl.ONE, gl.ZERO);
  gl.disable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LESS);
  gl.depthMask(true);
  gl.disable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.frontFace(gl.CCW);
}
