/**
 * The type vocabulary of each shading language, shared by the editor's
 * highlighting and the language servers' completion so the two cannot drift.
 */

const GLSL_VECTOR_TYPES = ["vec", "dvec", "ivec", "uvec", "bvec"]
  .flatMap((prefix) => [2, 3, 4].map((size) => `${prefix}${size}`));

const GLSL_MATRIX_TYPES = ["mat", "dmat"].flatMap((prefix) => [
  ...[2, 3, 4].map((size) => `${prefix}${size}`),
  ...[2, 3, 4].flatMap((rows) => (
    [2, 3, 4].map((columns) => `${prefix}${rows}x${columns}`)
  )),
]);

const GLSL_RESOURCE_SHAPES = [
  "1D", "2D", "3D", "Cube", "2DRect", "1DArray", "2DArray", "CubeArray",
  "Buffer", "2DMS", "2DMSArray",
];

const GLSL_SAMPLER_TYPES = ["", "i", "u"].flatMap((prefix) => (
  GLSL_RESOURCE_SHAPES.map((shape) => `${prefix}sampler${shape}`)
));

const GLSL_SHADOW_SAMPLER_TYPES = [
  "sampler1DShadow", "sampler2DShadow", "samplerCubeShadow",
  "sampler2DRectShadow", "sampler1DArrayShadow", "sampler2DArrayShadow",
  "samplerCubeArrayShadow",
];

const GLSL_IMAGE_TYPES = ["", "i", "u"].flatMap((prefix) => (
  GLSL_RESOURCE_SHAPES.map((shape) => `${prefix}image${shape}`)
));

/** Scalar and vector types a shader author writes by hand every day. */
export const GLSL_VALUE_TYPE_KEYWORDS: readonly string[] = Object.freeze([
  "void", "bool", "int", "uint", "float", "double",
  ...GLSL_VECTOR_TYPES,
  ...GLSL_MATRIX_TYPES,
]);

/** Every GLSL type keyword, including the resource types. */
export const GLSL_TYPE_KEYWORDS: readonly string[] = Object.freeze([
  ...GLSL_VALUE_TYPE_KEYWORDS,
  "atomic_uint",
  ...GLSL_SAMPLER_TYPES,
  ...GLSL_SHADOW_SAMPLER_TYPES,
  ...GLSL_IMAGE_TYPES,
]);

/** Scalar and vector types a shader author writes by hand every day. */
export const SLANG_VALUE_TYPE_KEYWORDS: readonly string[] = Object.freeze([
  "void", "bool", "bool2", "bool3", "bool4", "half", "half2", "half3", "half4",
  "float", "float2", "float3", "float4", "double", "double2", "double3", "double4",
  "int", "int2", "int3", "int4", "uint", "uint2", "uint3", "uint4",
  "float16_t", "float32_t", "float64_t",
  "int8_t", "uint8_t", "int16_t", "uint16_t", "int32_t", "uint32_t", "int64_t", "uint64_t",
]);

/** Every Slang type keyword, including the resource types. */
export const SLANG_TYPE_KEYWORDS: readonly string[] = Object.freeze([
  ...SLANG_VALUE_TYPE_KEYWORDS,
  "vector", "matrix", "Texture1D", "Texture2D", "Texture3D", "TextureCube",
  "Texture1DArray", "Texture2DArray", "Texture3DArray", "TextureCubeArray",
  "RWTexture1D", "RWTexture2D", "RWTexture3D", "RWTexture1DArray",
  "RWTexture2DArray", "RWTexture3DArray", "SamplerState", "SamplerComparisonState",
  "Buffer", "RWBuffer", "StructuredBuffer", "RWStructuredBuffer",
  "ByteAddressBuffer", "RWByteAddressBuffer", "ParameterBlock", "ConstantBuffer",
  "RaytracingAccelerationStructure",
]);

const TYPE_KEYWORDS_BY_LANGUAGE = {
  glsl: new Set(GLSL_TYPE_KEYWORDS),
  slang: new Set(SLANG_TYPE_KEYWORDS),
} as const;

/** Whether the word names a built-in type of the language. */
export function isShaderTypeKeyword(language: "glsl" | "slang", word: string): boolean {
  return TYPE_KEYWORDS_BY_LANGUAGE[language].has(word);
}

/** Types that can only be a function's return type, never a variable's. */
export const RETURN_ONLY_TYPE_KEYWORDS: readonly string[] = Object.freeze(["void"]);

/**
 * Type keywords a completion list should offer. Inside a function body a
 * declaration declares a variable, so the return-only types are dropped: `void`
 * names no value. At file scope it stays, because a function declaration starts
 * with exactly that.
 */
export function shaderTypeCompletionKeywords(
  language: "glsl" | "slang",
  options: { insideFunctionBody?: boolean } = {},
): readonly string[] {
  const keywords = language === "glsl" ? GLSL_TYPE_KEYWORDS : SLANG_TYPE_KEYWORDS;
  return options.insideFunctionBody
    ? keywords.filter((keyword) => !RETURN_ONLY_TYPE_KEYWORDS.includes(keyword))
    : keywords;
}

/** The subset that leads the list, in the order it should appear. */
export function shaderValueTypeKeywords(language: "glsl" | "slang"): readonly string[] {
  return language === "glsl" ? GLSL_VALUE_TYPE_KEYWORDS : SLANG_VALUE_TYPE_KEYWORDS;
}

/**
 * Entry points the renderer calls by name. They are the one thing worth
 * offering where a new name is being declared, because the author has to write
 * them exactly.
 */
export const SHADER_ENTRY_POINT_NAMES: readonly string[] = Object.freeze(["mainImage", "mainVertex"]);

/** Whether the name is a renderer entry point rather than an author's own symbol. */
export function isShaderEntryPointName(name: string): boolean {
  return SHADER_ENTRY_POINT_NAMES.includes(name);
}
