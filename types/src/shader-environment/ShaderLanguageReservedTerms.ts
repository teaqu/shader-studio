/**
 * Static GLSL ES 3.00 vocabulary rejected in a global declaration-name
 * position by the active compiler boundary. Compiler-backed tests keep later
 * and contextual vocabulary out of this grammar-only policy. See sections 3.7
 * (keywords/reserved words) and 4.1 (basic types) of the Khronos specification:
 * https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf
 */
const GLSL_ES_300_KEYWORDS = [
  "break", "case", "centroid", "const", "continue", "default", "discard", "do", "else", "flat", "for",
  "false", "highp", "if", "in", "inout", "invariant", "layout", "lowp", "mediump", "out", "precision",
  "return", "smooth", "struct", "switch", "true", "uniform", "while",
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
  "fvec3", "fvec4", "goto", "half", "hvec2", "hvec3", "hvec4", "image1D", "image1DArray", "image2D",
  "image2DArray", "image2DRect", "image3D", "imageBuffer", "imageCube", "iimage1D", "iimage1DArray",
  "iimage2D", "iimage2DArray", "iimage2DRect", "iimage3D", "iimageBuffer", "iimageCube", "inline", "input", "interface",
  "isampler1D", "isampler1DArray", "isampler2DMS", "isampler2DMSArray", "isampler2DRect", "isamplerBuffer",
  "isamplerCubeArray", "long",
  "namespace", "noinline", "noperspective", "output", "partition", "patch", "public", "readonly", "resource",
  "restrict", "sample", "sampler1D", "sampler1DArray", "sampler1DArrayShadow", "sampler1DShadow", "sampler2DMS",
  "sampler2DMSArray", "sampler2DRect", "sampler2DRectShadow", "sampler3DRect", "samplerBuffer", "samplerCubeArray",
  "samplerCubeArrayShadow", "short", "sizeof",
  "shared", "static", "subroutine", "superp", "template", "this", "typedef", "uimage1D", "uimage1DArray", "uimage2D",
  "uimage2DArray", "uimage2DRect", "uimage3D", "uimageBuffer", "uimageCube", "union", "unsigned", "usampler1D",
  "usampler1DArray", "usampler2DMS", "usampler2DMSArray",
  "usampler2DRect", "usamplerBuffer", "usamplerCubeArray", "using", "varying", "volatile", "writeonly",
] as const;

const GLSL_ES_300_RESERVED_IDENTIFIERS = new Set<string>([
  ...GLSL_ES_300_KEYWORDS,
  ...GLSL_ES_300_TYPES,
  ...GLSL_ES_300_FUTURE_RESERVED_WORDS,
]);

/**
 * Slang vocabulary is contextual and its predefined types are shadowable.
 * Keep only spellings the bundled compiler rejects in a declaration-name
 * position instead of treating completion/type catalogs as reserved words.
 */
const SLANG_RESERVED_IDENTIFIERS = new Set<string>(["new", "operator"]);

export function isShaderLanguageReservedTerm(
  languageId: "glsl" | "slang",
  name: string,
): boolean {
  if (languageId === "slang") {
    return SLANG_RESERVED_IDENTIFIERS.has(name);
  }
  return GLSL_ES_300_RESERVED_IDENTIFIERS.has(name)
    || name.startsWith("gl_")
    || name.includes("__");
}
