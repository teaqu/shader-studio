export interface GlslIntrinsic {
  readonly name: string;
  readonly kind: "function" | "type" | "variable";
  readonly signature: string;
  readonly returnType?: string;
  readonly parameters: readonly { readonly name: string; readonly type: string }[];
  readonly description: string;
  readonly minVersion: 100 | 300;
  readonly maxVersion: 100 | 300;
  readonly stages: readonly ("fragment" | "vertex")[];
}

const ALL_STAGES = ["fragment", "vertex"] as const;
const FRAGMENT = ["fragment"] as const;
const VERTEX = ["vertex"] as const;

function fn(
  name: string,
  returnType: string,
  parameters: readonly [string, string][],
  description: string,
  minVersion: 100 | 300 = 100,
  stages: readonly ("fragment" | "vertex")[] = ALL_STAGES,
  maxVersion: 100 | 300 = 300,
): GlslIntrinsic {
  return Object.freeze({
    name,
    kind: "function" as const,
    signature: `${returnType} ${name}(${parameters.map(([type, parameter]) => `${type} ${parameter}`).join(", ")})`,
    returnType,
    parameters: Object.freeze(parameters.map(([type, parameter]) => Object.freeze({ name: parameter, type }))),
    description,
    minVersion,
    maxVersion,
    stages,
  });
}

function variable(
  name: string,
  type: string,
  description: string,
  stages: readonly ("fragment" | "vertex")[],
  minVersion: 100 | 300 = 100,
): GlslIntrinsic {
  return Object.freeze({
    name,
    kind: "variable" as const,
    signature: `${type} ${name}`,
    returnType: type,
    parameters: Object.freeze([]),
    description,
    minVersion,
    maxVersion: 300 as const,
    stages,
  });
}

/** WebGL-focused, repository-authored factual intrinsic catalogue. */
export const GLSL_INTRINSICS: readonly GlslIntrinsic[] = Object.freeze([
  fn("abs", "genType", [["genType", "x"]], "Component-wise absolute value."),
  fn("acos", "genType", [["genType", "x"]], "Component-wise arc cosine in radians."),
  fn("acosh", "genType", [["genType", "x"]], "Component-wise inverse hyperbolic cosine.", 300),
  fn("all", "bool", [["bvec", "x"]], "True when every component is true."),
  fn("any", "bool", [["bvec", "x"]], "True when at least one component is true."),
  fn("asin", "genType", [["genType", "x"]], "Component-wise arc sine in radians."),
  fn("asinh", "genType", [["genType", "x"]], "Component-wise inverse hyperbolic sine.", 300),
  fn("atan", "genType", [["genType", "yOverX"]], "Component-wise arc tangent in radians."),
  fn("atan", "genType", [["genType", "y"], ["genType", "x"]], "Component-wise arc tangent using the signs of both arguments."),
  fn("atanh", "genType", [["genType", "x"]], "Component-wise inverse hyperbolic tangent.", 300),
  fn("ceil", "genType", [["genType", "x"]], "Rounds each component toward positive infinity."),
  fn("clamp", "genType", [["genType", "x"], ["genType", "minValue"], ["genType", "maxValue"]], "Constrains values to a range."),
  fn("cos", "genType", [["genType", "angle"]], "Cosine of an angle in radians."),
  fn("cosh", "genType", [["genType", "x"]], "Component-wise hyperbolic cosine.", 300),
  fn("cross", "vec3", [["vec3", "x"], ["vec3", "y"]], "Cross product of two vectors."),
  fn("dFdx", "genType", [["genType", "p"]], "Partial derivative in the window x direction.", 100, FRAGMENT),
  fn("dFdy", "genType", [["genType", "p"]], "Partial derivative in the window y direction.", 100, FRAGMENT),
  fn("degrees", "genType", [["genType", "radians"]], "Converts radians to degrees."),
  fn("determinant", "float", [["mat", "matrix"]], "Determinant of a square matrix.", 300),
  fn("distance", "float", [["genType", "p0"], ["genType", "p1"]], "Distance between two points."),
  fn("dot", "float", [["genType", "x"], ["genType", "y"]], "Dot product."),
  fn("equal", "bvec", [["genType", "x"], ["genType", "y"]], "Component-wise equality comparison."),
  fn("exp", "genType", [["genType", "x"]], "Raises e to each component."),
  fn("exp2", "genType", [["genType", "x"]], "Raises two to each component."),
  fn("faceforward", "genType", [["genType", "normal"], ["genType", "incident"], ["genType", "referenceNormal"]], "Orients a normal away from an incident vector."),
  fn("floatBitsToInt", "genIType", [["genType", "value"]], "Reinterprets floating-point bits as signed integers.", 300),
  fn("floatBitsToUint", "genUType", [["genType", "value"]], "Reinterprets floating-point bits as unsigned integers.", 300),
  fn("floor", "genType", [["genType", "x"]], "Rounds each component toward negative infinity."),
  fn("fract", "genType", [["genType", "x"]], "Fractional part of each component."),
  fn("fwidth", "genType", [["genType", "p"]], "Sum of the absolute horizontal and vertical derivatives.", 100, FRAGMENT),
  fn("greaterThan", "bvec", [["genType", "x"], ["genType", "y"]], "Component-wise greater-than comparison."),
  fn("greaterThanEqual", "bvec", [["genType", "x"], ["genType", "y"]], "Component-wise greater-than-or-equal comparison."),
  fn("intBitsToFloat", "genType", [["genIType", "value"]], "Reinterprets signed integer bits as floating-point values.", 300),
  fn("inverse", "mat", [["mat", "matrix"]], "Inverse of a square matrix.", 300),
  fn("inversesqrt", "genType", [["genType", "x"]], "Reciprocal square root of each component."),
  fn("isinf", "genBType", [["genType", "value"]], "Tests whether each component is positive or negative infinity.", 300),
  fn("isnan", "genBType", [["genType", "value"]], "Tests whether each component is not a number.", 300),
  fn("length", "float", [["genType", "x"]], "Vector length."),
  fn("lessThan", "bvec", [["genType", "x"], ["genType", "y"]], "Component-wise less-than comparison."),
  fn("lessThanEqual", "bvec", [["genType", "x"], ["genType", "y"]], "Component-wise less-than-or-equal comparison."),
  fn("log", "genType", [["genType", "x"]], "Component-wise natural logarithm."),
  fn("log2", "genType", [["genType", "x"]], "Component-wise base-two logarithm."),
  fn("matrixCompMult", "mat", [["mat", "x"], ["mat", "y"]], "Component-wise matrix product."),
  fn("max", "genType", [["genType", "x"], ["genType", "y"]], "Component-wise maximum."),
  fn("min", "genType", [["genType", "x"], ["genType", "y"]], "Component-wise minimum."),
  fn("mix", "genType", [["genType", "x"], ["genType", "y"], ["genType", "a"]], "Linearly interpolates between x and y."),
  fn("mod", "genType", [["genType", "x"], ["genType", "y"]], "Component-wise floating-point modulus."),
  fn("modf", "genType", [["genType", "value"], ["out genType", "integralPart"]], "Splits each component into fractional and integral parts.", 300),
  fn("normalize", "genType", [["genType", "x"]], "Vector with length one."),
  fn("not", "bvec", [["bvec", "x"]], "Component-wise logical complement."),
  fn("notEqual", "bvec", [["genType", "x"], ["genType", "y"]], "Component-wise inequality comparison."),
  fn("outerProduct", "mat", [["vec", "column"], ["vec", "row"]], "Outer product of two vectors.", 300),
  fn("packHalf2x16", "uint", [["vec2", "value"]], "Packs two floating-point values into 16-bit representations.", 300),
  fn("packSnorm2x16", "uint", [["vec2", "value"]], "Packs two signed normalized values into a uint.", 300),
  fn("packUnorm2x16", "uint", [["vec2", "value"]], "Packs two unsigned normalized values into a uint.", 300),
  fn("pow", "genType", [["genType", "x"], ["genType", "y"]], "Raises x to the power y component-wise."),
  fn("radians", "genType", [["genType", "degrees"]], "Converts degrees to radians."),
  fn("reflect", "genType", [["genType", "incident"], ["genType", "normal"]], "Reflected incident vector."),
  fn("refract", "genType", [["genType", "incident"], ["genType", "normal"], ["float", "eta"]], "Refracted vector."),
  fn("round", "genType", [["genType", "x"]], "Rounds each component to the nearest integer.", 300),
  fn("roundEven", "genType", [["genType", "x"]], "Rounds each component to the nearest even integer on ties.", 300),
  fn("sign", "genType", [["genType", "x"]], "Sign of each component."),
  fn("sin", "genType", [["genType", "angle"]], "Sine of an angle in radians."),
  fn("sinh", "genType", [["genType", "x"]], "Component-wise hyperbolic sine.", 300),
  fn("smoothstep", "genType", [["genType", "edge0"], ["genType", "edge1"], ["genType", "x"]], "Performs smooth Hermite interpolation."),
  fn("sqrt", "genType", [["genType", "x"]], "Square root of each component."),
  fn("step", "genType", [["genType", "edge"], ["genType", "x"]], "Zero below edge and one otherwise."),
  fn("tan", "genType", [["genType", "angle"]], "Tangent of an angle in radians."),
  fn("tanh", "genType", [["genType", "x"]], "Component-wise hyperbolic tangent.", 300),
  fn("texelFetch", "gvec4", [["gsampler2D", "sampler"], ["ivec2", "coordinate"], ["int", "lod"]], "Fetches one texel by integer coordinate.", 300),
  fn("texelFetchOffset", "gvec4", [["gsampler2D", "sampler"], ["ivec2", "coordinate"], ["int", "lod"], ["ivec2", "offset"]], "Fetches one texel with a constant coordinate offset.", 300),
  fn("texture", "vec4", [["sampler2D", "sampler"], ["vec2", "coordinate"]], "Samples a 2D texture.", 300),
  fn("texture", "vec4", [["samplerCube", "sampler"], ["vec3", "direction"]], "Samples a cube texture.", 300),
  fn("textureGrad", "gvec4", [["gsampler2D", "sampler"], ["vec2", "coordinate"], ["vec2", "dPdx"], ["vec2", "dPdy"]], "Samples a texture with explicit coordinate gradients.", 300),
  fn("textureGradOffset", "gvec4", [["gsampler2D", "sampler"], ["vec2", "coordinate"], ["vec2", "dPdx"], ["vec2", "dPdy"], ["ivec2", "offset"]], "Samples with explicit gradients and a constant coordinate offset.", 300),
  fn("textureLod", "gvec4", [["gsampler2D", "sampler"], ["vec2", "coordinate"], ["float", "lod"]], "Samples a texture at an explicit level of detail.", 300),
  fn("textureLodOffset", "gvec4", [["gsampler2D", "sampler"], ["vec2", "coordinate"], ["float", "lod"], ["ivec2", "offset"]], "Samples at an explicit level of detail with a constant offset.", 300),
  fn("textureOffset", "gvec4", [["gsampler2D", "sampler"], ["vec2", "coordinate"], ["ivec2", "offset"]], "Samples a texture with a constant coordinate offset.", 300),
  fn("textureProj", "gvec4", [["gsampler2D", "sampler"], ["vec3", "coordinate"]], "Samples a texture using projected coordinates.", 300),
  fn("textureProjGrad", "gvec4", [["gsampler2D", "sampler"], ["vec3", "coordinate"], ["vec2", "dPdx"], ["vec2", "dPdy"]], "Samples projected coordinates with explicit gradients.", 300),
  fn("textureProjGradOffset", "gvec4", [["gsampler2D", "sampler"], ["vec3", "coordinate"], ["vec2", "dPdx"], ["vec2", "dPdy"], ["ivec2", "offset"]], "Samples projected coordinates with gradients and an offset.", 300),
  fn("textureProjLod", "gvec4", [["gsampler2D", "sampler"], ["vec3", "coordinate"], ["float", "lod"]], "Samples projected coordinates at an explicit level of detail.", 300),
  fn("textureProjLodOffset", "gvec4", [["gsampler2D", "sampler"], ["vec3", "coordinate"], ["float", "lod"], ["ivec2", "offset"]], "Samples projected coordinates at a level of detail with an offset.", 300),
  fn("textureProjOffset", "gvec4", [["gsampler2D", "sampler"], ["vec3", "coordinate"], ["ivec2", "offset"]], "Samples projected coordinates with a constant offset.", 300),
  fn("textureSize", "ivec2", [["gsampler2D", "sampler"], ["int", "lod"]], "Texture dimensions at a level of detail.", 300),
  fn("texture2D", "vec4", [["sampler2D", "sampler"], ["vec2", "coordinate"]], "Samples a 2D texture.", 100, ALL_STAGES, 100),
  fn("texture2DLod", "vec4", [["sampler2D", "sampler"], ["vec2", "coordinate"], ["float", "lod"]], "Samples a 2D texture at an explicit level of detail.", 100, VERTEX, 100),
  fn("texture2DProj", "vec4", [["sampler2D", "sampler"], ["vec3", "coordinate"]], "Samples a 2D texture using projected coordinates.", 100, ALL_STAGES, 100),
  fn("texture2DProjLod", "vec4", [["sampler2D", "sampler"], ["vec3", "coordinate"], ["float", "lod"]], "Samples projected coordinates at an explicit level of detail.", 100, VERTEX, 100),
  fn("textureCube", "vec4", [["samplerCube", "sampler"], ["vec3", "direction"]], "Samples a cube texture.", 100, ALL_STAGES, 100),
  fn("textureCubeLod", "vec4", [["samplerCube", "sampler"], ["vec3", "direction"], ["float", "lod"]], "Samples a cube texture at an explicit level of detail.", 100, VERTEX, 100),
  fn("transpose", "mat", [["mat", "matrix"]], "Matrix transpose.", 300),
  fn("trunc", "genType", [["genType", "x"]], "Rounds each component toward zero.", 300),
  fn("uintBitsToFloat", "genType", [["genUType", "value"]], "Reinterprets unsigned integer bits as floating-point values.", 300),
  fn("unpackHalf2x16", "vec2", [["uint", "value"]], "Unpacks two 16-bit floating-point representations.", 300),
  fn("unpackSnorm2x16", "vec2", [["uint", "value"]], "Unpacks two signed normalized values from a uint.", 300),
  fn("unpackUnorm2x16", "vec2", [["uint", "value"]], "Unpacks two unsigned normalized values from a uint.", 300),
  variable("gl_FragCoord", "vec4", "Window-space coordinate of the current fragment.", FRAGMENT),
  variable("gl_FragDepth", "float", "Depth value written by the current fragment.", FRAGMENT, 300),
  variable("gl_FrontFacing", "bool", "True for fragments produced by front-facing primitives.", FRAGMENT),
  variable("gl_InstanceID", "int", "Index of the current instanced draw instance.", VERTEX, 300),
  variable("gl_PointCoord", "vec2", "Coordinate within the current point primitive.", FRAGMENT),
  variable("gl_PointSize", "float", "Rasterized point size in pixels.", VERTEX),
  variable("gl_Position", "vec4", "Clip-space position written by the vertex shader.", VERTEX),
  variable("gl_VertexID", "int", "Index of the current vertex.", VERTEX, 300),
].sort((a, b) => a.name.localeCompare(b.name) || a.signature.localeCompare(b.signature)));

export function findGlslIntrinsics(
  name: string,
  version: 100 | 300,
  stage: "fragment" | "vertex",
): readonly GlslIntrinsic[] {
  return GLSL_INTRINSICS.filter((item) => item.name === name
    && item.minVersion <= version
    && item.maxVersion >= version
    && item.stages.includes(stage));
}
