export interface GlslIntrinsic {
  readonly name: string;
  readonly kind: "function" | "type" | "variable";
  readonly signature: string;
  readonly returnType?: string;
  readonly parameters: readonly { readonly name: string; readonly type: string }[];
  readonly description: string;
  readonly minVersion: 100 | 300;
  readonly stages: readonly ("fragment" | "vertex")[];
}

const ALL_STAGES = ["fragment", "vertex"] as const;
const FRAGMENT = ["fragment"] as const;

function fn(
  name: string,
  returnType: string,
  parameters: readonly [string, string][],
  description: string,
  minVersion: 100 | 300 = 100,
  stages: readonly ("fragment" | "vertex")[] = ALL_STAGES,
): GlslIntrinsic {
  return Object.freeze({
    name,
    kind: "function" as const,
    signature: `${returnType} ${name}(${parameters.map(([type, parameter]) => `${type} ${parameter}`).join(", ")})`,
    returnType,
    parameters: Object.freeze(parameters.map(([type, parameter]) => Object.freeze({ name: parameter, type }))),
    description,
    minVersion,
    stages,
  });
}

/** WebGL-focused, repository-authored factual intrinsic catalogue. */
export const GLSL_INTRINSICS: readonly GlslIntrinsic[] = Object.freeze([
  fn("abs", "genType", [["genType", "x"]], "Component-wise absolute value."),
  fn("ceil", "genType", [["genType", "x"]], "Rounds each component toward positive infinity."),
  fn("clamp", "genType", [["genType", "x"], ["genType", "minValue"], ["genType", "maxValue"]], "Constrains values to a range."),
  fn("cos", "genType", [["genType", "angle"]], "Cosine of an angle in radians."),
  fn("cross", "vec3", [["vec3", "x"], ["vec3", "y"]], "Cross product of two vectors."),
  fn("dFdx", "genType", [["genType", "p"]], "Partial derivative in the window x direction.", 100, FRAGMENT),
  fn("dFdy", "genType", [["genType", "p"]], "Partial derivative in the window y direction.", 100, FRAGMENT),
  fn("distance", "float", [["genType", "p0"], ["genType", "p1"]], "Distance between two points."),
  fn("dot", "float", [["genType", "x"], ["genType", "y"]], "Dot product."),
  fn("exp", "genType", [["genType", "x"]], "Raises e to each component."),
  fn("floor", "genType", [["genType", "x"]], "Rounds each component toward negative infinity."),
  fn("fract", "genType", [["genType", "x"]], "Fractional part of each component."),
  fn("length", "float", [["genType", "x"]], "Vector length."),
  fn("max", "genType", [["genType", "x"], ["genType", "y"]], "Component-wise maximum."),
  fn("min", "genType", [["genType", "x"], ["genType", "y"]], "Component-wise minimum."),
  fn("mix", "genType", [["genType", "x"], ["genType", "y"], ["genType", "a"]], "Linearly interpolates between x and y."),
  fn("normalize", "genType", [["genType", "x"]], "Vector with length one."),
  fn("pow", "genType", [["genType", "x"], ["genType", "y"]], "Raises x to the power y component-wise."),
  fn("reflect", "genType", [["genType", "incident"], ["genType", "normal"]], "Reflected incident vector."),
  fn("refract", "genType", [["genType", "incident"], ["genType", "normal"], ["float", "eta"]], "Refracted vector."),
  fn("sin", "genType", [["genType", "angle"]], "Sine of an angle in radians."),
  fn("smoothstep", "genType", [["genType", "edge0"], ["genType", "edge1"], ["genType", "x"]], "Performs smooth Hermite interpolation."),
  fn("sqrt", "genType", [["genType", "x"]], "Square root of each component."),
  fn("step", "genType", [["genType", "edge"], ["genType", "x"]], "Zero below edge and one otherwise."),
  fn("texture", "vec4", [["sampler2D", "sampler"], ["vec2", "coordinate"]], "Samples a 2D texture.", 300),
  fn("texture", "vec4", [["samplerCube", "sampler"], ["vec3", "direction"]], "Samples a cube texture.", 300),
  fn("texture2D", "vec4", [["sampler2D", "sampler"], ["vec2", "coordinate"]], "Samples a 2D texture.", 100),
  fn("textureCube", "vec4", [["samplerCube", "sampler"], ["vec3", "direction"]], "Samples a cube texture.", 100),
].sort((a, b) => a.name.localeCompare(b.name) || a.signature.localeCompare(b.signature)));

export function findGlslIntrinsics(
  name: string,
  version: 100 | 300,
  stage: "fragment" | "vertex",
): readonly GlslIntrinsic[] {
  return GLSL_INTRINSICS.filter((item) => item.name === name && item.minVersion <= version && item.stages.includes(stage));
}
