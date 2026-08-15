import { describe, expect, it } from "vitest";
import { GLSL_INTRINSICS, findGlslIntrinsics } from "../intrinsics";

describe("GLSL intrinsics", () => {
  it("contains WebGL overloads and stage filtering", () => {
    expect(findGlslIntrinsics("texture", 300, "fragment").some((item) => item.signature.includes("sampler2D"))).toBe(true);
    expect(findGlslIntrinsics("texture2D", 300, "fragment")).toEqual([]);
    expect(findGlslIntrinsics("texture2D", 100, "fragment")).toHaveLength(1);
    expect(findGlslIntrinsics("dFdx", 300, "vertex")).toEqual([]);
    expect(findGlslIntrinsics("dFdx", 300, "fragment")).toHaveLength(1);
  });

  it("uses concise descriptions without return-value boilerplate", () => {
    expect(GLSL_INTRINSICS.filter((item) => /^returns?\b/i.test(item.description))).toEqual([]);
  });

  it("covers the WebGL shader reference and its GLSL ES 3.00 equivalents", () => {
    const common = [
      "radians", "degrees", "sin", "cos", "tan", "asin", "acos", "atan",
      "pow", "exp", "log", "exp2", "log2", "sqrt", "inversesqrt",
      "abs", "sign", "floor", "ceil", "fract", "mod", "min", "max", "clamp", "mix", "step", "smoothstep",
      "length", "distance", "dot", "cross", "normalize", "faceforward", "reflect", "refract", "matrixCompMult",
      "lessThan", "lessThanEqual", "greaterThan", "greaterThanEqual", "equal", "notEqual", "any", "all", "not",
    ];
    const es300 = [
      ...common, "sinh", "cosh", "tanh", "asinh", "acosh", "atanh", "trunc", "round", "roundEven", "modf",
      "isnan", "isinf", "floatBitsToInt", "floatBitsToUint", "intBitsToFloat", "uintBitsToFloat",
      "outerProduct", "transpose", "determinant", "inverse",
      "textureSize", "texture", "textureProj", "textureLod", "textureOffset", "texelFetch", "texelFetchOffset",
      "textureProjOffset", "textureLodOffset", "textureProjLod", "textureProjLodOffset", "textureGrad",
      "textureGradOffset", "textureProjGrad", "textureProjGradOffset",
      "packSnorm2x16", "unpackSnorm2x16", "packUnorm2x16", "unpackUnorm2x16", "packHalf2x16", "unpackHalf2x16",
      "dFdx", "dFdy", "fwidth",
    ];
    const es100Textures = ["texture2D", "texture2DProj", "textureCube", "texture2DLod", "texture2DProjLod", "textureCubeLod"];

    for (const name of es300) {
      const entries = [
        ...findGlslIntrinsics(name, 300, "fragment"),
        ...findGlslIntrinsics(name, 300, "vertex"),
      ];
      expect(entries, `GLSL ES 3.00 ${name}`).not.toEqual([]);
    }
    for (const name of [...common, ...es100Textures]) {
      const entries = [
        ...findGlslIntrinsics(name, 100, "fragment"),
        ...findGlslIntrinsics(name, 100, "vertex"),
      ];
      expect(entries, `GLSL ES 1.00 ${name}`).not.toEqual([]);
    }
  });

  it("filters built-in variables by shader stage and language version", () => {
    for (const name of ["gl_FragCoord", "gl_FragDepth", "gl_FrontFacing", "gl_PointCoord"]) {
      expect(findGlslIntrinsics(name, 300, "fragment"), name).toHaveLength(1);
      expect(findGlslIntrinsics(name, 300, "vertex"), name).toEqual([]);
    }
    for (const name of ["gl_InstanceID", "gl_PointSize", "gl_Position", "gl_VertexID"]) {
      expect(findGlslIntrinsics(name, 300, "vertex"), name).toHaveLength(1);
      expect(findGlslIntrinsics(name, 300, "fragment"), name).toEqual([]);
    }
    expect(findGlslIntrinsics("gl_VertexID", 100, "vertex")).toEqual([]);
    expect(findGlslIntrinsics("gl_FragDepth", 100, "fragment")).toEqual([]);
  });
});
