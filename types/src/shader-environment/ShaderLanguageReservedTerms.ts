/**
 * Static GLSL ES 3.00 vocabulary from sections 3.7 (keywords/reserved words)
 * and 4.1 (basic types) of the Khronos language specification:
 * https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf
 */
const GLSL_ES_300_KEYWORDS = [
  "break", "case", "centroid", "const", "continue", "default", "discard", "do", "else", "flat", "for",
  "highp", "if", "in", "inout", "invariant", "layout", "lowp", "mediump", "out", "precision", "return",
  "smooth", "struct", "switch", "uniform", "while",
] as const;

const GLSL_ES_300_TYPES = [
  "bool", "bvec2", "bvec3", "bvec4", "float", "int", "ivec2", "ivec3", "ivec4", "mat2", "mat2x2",
  "mat2x3", "mat2x4", "mat3", "mat3x2", "mat3x3", "mat3x4", "mat4", "mat4x2", "mat4x3", "mat4x4",
  "sampler2D", "sampler2DArray", "sampler2DArrayShadow", "sampler2DShadow", "sampler3D", "samplerCube",
  "samplerCubeShadow", "isampler2D", "isampler2DArray", "isampler3D", "isamplerCube", "uint", "usampler2D",
  "usampler2DArray", "usampler3D", "usamplerCube", "uvec2", "uvec3", "uvec4", "vec2", "vec3", "vec4", "void",
] as const;

const GLSL_ES_300_FUTURE_RESERVED_WORDS = [
  "active", "asm", "atomic_uint", "attribute", "cast", "class", "coherent", "common", "double", "dmat2",
  "dmat2x2", "dmat2x3", "dmat2x4", "dmat3", "dmat3x2", "dmat3x3", "dmat3x4", "dmat4", "dmat4x2",
  "dmat4x3", "dmat4x4", "dvec2", "dvec3", "dvec4", "enum", "extern", "external", "filter", "fixed", "fvec2",
  "fvec3", "fvec4", "goto", "half", "hvec2", "hvec3", "hvec4", "image1D", "image1DArray", "image1DArrayShadow",
  "image1DShadow", "image2D", "image2DArrayShadow", "image2DShadow",
  "image2DArray", "image2DMS", "image2DMSArray", "image2DRect", "image3D", "imageBuffer", "imageCube",
  "imageCubeArray", "iimage1D", "iimage1DArray", "iimage2D", "iimage2DArray", "iimage2DMS", "iimage2DMSArray",
  "iimage2DRect", "iimage3D", "iimageBuffer", "iimageCube", "iimageCubeArray", "inline", "input", "interface",
  "isampler1D", "isampler1DArray", "isampler2DMS", "isampler2DMSArray", "isampler2DRect", "isamplerBuffer",
  "isamplerCubeArray", "long",
  "namespace", "noinline", "noperspective", "output", "partition", "patch", "public", "readonly", "resource",
  "restrict", "sample", "sampler1D", "sampler1DArray", "sampler1DArrayShadow", "sampler1DShadow", "sampler2DMS",
  "sampler2DMSArray", "sampler2DRect", "sampler2DRectShadow", "sampler3DRect", "samplerBuffer", "samplerCubeArray",
  "samplerCubeArrayShadow", "short", "sizeof",
  "static", "subroutine", "superp", "template", "this", "typedef", "uimage1D", "uimage1DArray", "uimage2D",
  "uimage2DArray", "uimage2DMS", "uimage2DMSArray", "uimage2DRect", "uimage3D", "uimageBuffer", "uimageCube",
  "uimageCubeArray", "union", "unsigned", "usampler1D", "usampler1DArray", "usampler2DMS", "usampler2DMSArray",
  "usampler2DRect", "usamplerBuffer", "usamplerCubeArray", "using", "varying", "volatile", "writeonly",
] as const;

/**
 * Static Slang vocabulary. The declaration/control/modifier groups mirror the
 * repository's Slang editor grammar, with compiler-only contextual keywords
 * taken from Slang's parser and language-server completion catalogs:
 * https://github.com/shader-slang/slang/blob/master/source/slang/slang-parser.cpp
 * https://github.com/shader-slang/slang/blob/master/source/slang/slang-language-server-completion.cpp
 */
const SLANG_CONTROL_AND_STATEMENT_KEYWORDS = [
  "break", "case", "catch", "continue", "default", "defer", "discard", "do", "else", "for", "foreach", "if",
  "return", "switch", "throw", "throws", "try", "while",
] as const;

const SLANG_DECLARATION_AND_EXPRESSION_KEYWORDS = [
  "alignof", "as", "associatedtype", "attribute_syntax", "buffer", "cbuffer", "class", "countof", "each", "enum", "expand",
  "extension", "func", "functype", "generic", "get", "implementing", "import", "interface", "is", "let", "module",
  "namespace", "new", "none", "nullptr", "operator", "property", "semantic", "set", "sizeof", "struct", "syntax",
  "tbuffer", "this", "This", "type_param", "typealias", "typedef", "typename", "using", "var", "where",
] as const;

const SLANG_MODIFIER_KEYWORDS = [
  "abstract", "centroid", "coherent", "column_major", "const", "differentiable", "dyn", "dynamic_uniform", "export", "extern",
  "globallycoherent", "groupshared", "highp", "in", "inline", "inout", "internal", "linear", "lowp", "mediump",
  "mutating", "no_diff", "nointerpolation", "nonmutating", "noperspective", "out", "override", "param", "payload",
  "packoffset", "point", "precise", "primitives", "private", "protected", "public", "readonly", "ref", "require",
  "restrict", "row_major", "sample", "sealed", "shared", "static", "triangle", "triangleadj", "line", "lineadj",
  "uniform", "vertices", "indices", "virtual", "volatile", "writeonly",
] as const;

const SLANG_SCALAR_TYPES_WITH_CONVENIENCE_SHAPES = [
  "bool", "double", "float", "float16_t", "float32_t", "float64_t", "half", "int", "int8_t", "int16_t",
  "int32_t", "int64_t", "uint", "uint8_t", "uint16_t", "uint32_t", "uint64_t",
] as const;

const SLANG_VECTOR_TYPES = SLANG_SCALAR_TYPES_WITH_CONVENIENCE_SHAPES.flatMap((base) => (
  [2, 3, 4].map((size) => `${base}${size}`)
));

const SLANG_MATRIX_TYPES = SLANG_SCALAR_TYPES_WITH_CONVENIENCE_SHAPES.flatMap((base) => (
  [2, 3, 4].flatMap((rows) => [2, 3, 4].map((columns) => `${base}${rows}x${columns}`))
));

const SLANG_LITERAL_KEYWORDS = ["false", "null", "true"] as const;

const SLANG_BUILTIN_TYPES = [
  "Atomic", "bool", "bool2", "bool3", "bool4", "Buffer", "ByteAddressBuffer", "ConstantBuffer", "double", "double2",
  "double3", "double4", "float", "float2", "float3", "float4", "float16_t", "float32_t", "float64_t", "half",
  "half2", "half3", "half4", "int", "int2", "int3", "int4", "int8_t", "int16_t", "int32_t", "int64_t",
  "matrix", "ParameterBlock", "RaytracingAccelerationStructure", "RWBuffer", "RWByteAddressBuffer", "RWStructuredBuffer",
  "RWTexture1D", "RWTexture1DArray", "RWTexture2D", "RWTexture2DArray", "RWTexture3D", "RWTexture3DArray", "sampler",
  "SamplerComparisonState", "SamplerState", "StructuredBuffer", "Texture1D", "Texture1DArray", "Texture2D",
  "Texture2DArray", "Texture3D", "Texture3DArray", "TextureCube", "TextureCubeArray", "uint", "uint2", "uint3",
  "uint4", "uint8_t", "uint16_t", "uint32_t", "uint64_t", "vector", "void",
] as const;

const SHADER_LANGUAGE_RESERVED_TERMS = new Set<string>([
  ...GLSL_ES_300_KEYWORDS,
  ...GLSL_ES_300_TYPES,
  ...GLSL_ES_300_FUTURE_RESERVED_WORDS,
  ...SLANG_CONTROL_AND_STATEMENT_KEYWORDS,
  ...SLANG_DECLARATION_AND_EXPRESSION_KEYWORDS,
  ...SLANG_MODIFIER_KEYWORDS,
  ...SLANG_LITERAL_KEYWORDS,
  ...SLANG_BUILTIN_TYPES,
  ...SLANG_VECTOR_TYPES,
  ...SLANG_MATRIX_TYPES,
]);

export function isShaderLanguageReservedTerm(name: string): boolean {
  return SHADER_LANGUAGE_RESERVED_TERMS.has(name)
    || name.startsWith("gl_")
    || name.includes("__");
}
