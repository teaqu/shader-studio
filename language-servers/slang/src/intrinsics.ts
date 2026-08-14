export interface SlangIntrinsic {
  readonly name: string;
  readonly signatures: readonly string[];
  readonly description: string;
}

function intrinsic(name: string, signatures: readonly string[], description: string): SlangIntrinsic {
  return Object.freeze({ name, signatures: Object.freeze(signatures), description });
}

/** Common Slang shader intrinsics with repository-authored factual descriptions. */
export const SLANG_INTRINSICS: readonly SlangIntrinsic[] = Object.freeze([
  intrinsic("abs", ["T abs(T value)"], "Returns the component-wise absolute value."),
  intrinsic("acos", ["T acos(T value)"], "Returns the component-wise arc cosine in radians."),
  intrinsic("asin", ["T asin(T value)"], "Returns the component-wise arc sine in radians."),
  intrinsic("atan", ["T atan(T value)"], "Returns a component-wise arc tangent in radians."),
  intrinsic("atan2", ["T atan2(T y, T x)"], "Returns a component-wise arc tangent using the signs of both arguments."),
  intrinsic("ceil", ["T ceil(T value)"], "Rounds each component toward positive infinity."),
  intrinsic("clamp", ["T clamp(T value, T minimum, T maximum)"], "Constrains each component to a range."),
  intrinsic("cos", ["T cos(T angle)"], "Returns the component-wise cosine of an angle in radians."),
  intrinsic("cross", ["float3 cross(float3 left, float3 right)"], "Returns the three-dimensional cross product."),
  intrinsic("ddx", ["T ddx(T value)"], "Returns the screen-space derivative in the horizontal direction."),
  intrinsic("ddy", ["T ddy(T value)"], "Returns the screen-space derivative in the vertical direction."),
  intrinsic("degrees", ["T degrees(T radians)"], "Converts radians to degrees."),
  intrinsic("distance", ["float distance(T left, T right)"], "Returns the distance between two points."),
  intrinsic("dot", ["float dot(T left, T right)"], "Returns the vector dot product."),
  intrinsic("exp", ["T exp(T value)"], "Raises e to each component."),
  intrinsic("exp2", ["T exp2(T value)"], "Raises two to each component."),
  intrinsic("floor", ["T floor(T value)"], "Rounds each component toward negative infinity."),
  intrinsic("frac", ["T frac(T value)"], "Returns the fractional part of each component."),
  intrinsic("fwidth", ["T fwidth(T value)"], "Returns the sum of the absolute horizontal and vertical derivatives."),
  intrinsic("length", ["float length(T value)"], "Returns the vector length."),
  intrinsic("lerp", ["T lerp(T start, T end, T amount)"], "Linearly interpolates between two values."),
  intrinsic("log", ["T log(T value)"], "Returns the component-wise natural logarithm."),
  intrinsic("log2", ["T log2(T value)"], "Returns the component-wise base-two logarithm."),
  intrinsic("max", ["T max(T left, T right)"], "Returns the component-wise maximum."),
  intrinsic("min", ["T min(T left, T right)"], "Returns the component-wise minimum."),
  intrinsic("normalize", ["T normalize(T value)"], "Returns a vector in the same direction with unit length."),
  intrinsic("pow", ["T pow(T base, T exponent)"], "Raises each base component to the corresponding exponent."),
  intrinsic("radians", ["T radians(T degrees)"], "Converts degrees to radians."),
  intrinsic("reflect", ["T reflect(T incident, T normal)"], "Returns the reflection direction for an incident vector and surface normal."),
  intrinsic("refract", ["T refract(T incident, T normal, float eta)"], "Returns the refraction direction for a ratio of refractive indices."),
  intrinsic("round", ["T round(T value)"], "Rounds each component to the nearest integer value."),
  intrinsic("rsqrt", ["T rsqrt(T value)"], "Returns the reciprocal square root of each component."),
  intrinsic("saturate", ["T saturate(T value)"], "Constrains each component to the inclusive range zero through one."),
  intrinsic("sign", ["T sign(T value)"], "Returns the sign of each component."),
  intrinsic("sin", ["T sin(T angle)"], "Returns the component-wise sine of an angle in radians."),
  intrinsic("smoothstep", ["T smoothstep(T minimum, T maximum, T value)"], "Performs smooth Hermite interpolation across a range."),
  intrinsic("sqrt", ["T sqrt(T value)"], "Returns the square root of each component."),
  intrinsic("step", ["T step(T edge, T value)"], "Returns zero below the edge and one otherwise."),
  intrinsic("tan", ["T tan(T angle)"], "Returns the component-wise tangent of an angle in radians."),
  intrinsic("transpose", ["matrix<T, C, R> transpose(matrix<T, R, C> value)"], "Returns the matrix transpose."),
].sort((left, right) => left.name.localeCompare(right.name)));

export function findSlangIntrinsics(name: string): readonly SlangIntrinsic[] {
  return SLANG_INTRINSICS.filter((item) => item.name === name);
}
