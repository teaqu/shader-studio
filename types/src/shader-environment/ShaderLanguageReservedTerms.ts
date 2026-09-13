import type { ShaderLanguageId } from "./ShaderLanguages";

/**
 * Static GLSL ES 3.00 vocabulary rejected in a global declaration-name
 * position by the active compiler boundary. Compiler-backed tests keep later
 * and contextual vocabulary out of this grammar-only policy. See sections 3.8
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

/**
 * WGSL keywords and reserved words from sections 3.6 and 16 of the spec
 * (https://www.w3.org/TR/WGSL/). An identifier must not share their spelling.
 */
const WGSL_KEYWORDS = [
  "alias", "break", "case", "const", "const_assert", "continue", "continuing", "default",
  "diagnostic", "discard", "else", "enable", "false", "fn", "for", "if", "let", "loop",
  "override", "requires", "return", "struct", "switch", "true", "var", "while",
] as const;

const WGSL_RESERVED_WORDS = [
  "NULL", "Self", "abstract", "active", "alignas", "alignof", "as", "asm", "asm_fragment",
  "async", "attribute", "auto", "await", "become", "cast", "catch", "class", "co_await",
  "co_return", "co_yield", "coherent", "column_major", "common", "compile", "compile_fragment",
  "concept", "const_cast", "consteval", "constexpr", "constinit", "crate", "debugger", "decltype",
  "delete", "demote", "demote_to_helper", "do", "dynamic_cast", "enum", "explicit", "export",
  "extends", "extern", "external", "fallthrough", "filter", "final", "finally", "friend", "from",
  "fxgroup", "get", "goto", "groupshared", "highp", "impl", "implements", "import", "inline",
  "instanceof", "interface", "layout", "lowp", "macro", "macro_rules", "match", "mediump", "meta",
  "mod", "module", "move", "mut", "mutable", "namespace", "new", "nil", "noexcept", "noinline",
  "nointerpolation", "non_coherent", "noncoherent", "noperspective", "null", "nullptr", "of",
  "operator", "package", "packoffset", "partition", "pass", "patch", "pixelfragment", "precise",
  "precision", "premerge", "priv", "protected", "pub", "public", "readonly", "ref", "regardless",
  "register", "reinterpret_cast", "require", "resource", "restrict", "self", "set", "shared",
  "sizeof", "smooth", "snorm", "static", "static_assert", "static_cast", "std", "subroutine",
  "super", "target", "template", "this", "thread_local", "throw", "trait", "try", "type",
  "typedef", "typeid", "typename", "typeof", "union", "unless", "unorm", "unsafe", "unsized",
  "use", "using", "varying", "virtual", "volatile", "wgsl", "where", "with", "writeonly", "yield",
] as const;

/**
 * Predeclared scalar, vector, and matrix aliases (vec4f, mat3x3f, ...) that a
 * generated `var<private>` declaration would collide with.
 */
const WGSL_PREDECLARED_TYPE_ALIASES = [
  "bool", "f16", "f32", "i32", "u32",
  "vec2f", "vec2h", "vec2i", "vec2u", "vec3f", "vec3h", "vec3i", "vec3u",
  "vec4f", "vec4h", "vec4i", "vec4u",
  "mat2x2f", "mat2x2h", "mat2x3f", "mat2x3h", "mat2x4f", "mat2x4h",
  "mat3x2f", "mat3x2h", "mat3x3f", "mat3x3h", "mat3x4f", "mat3x4h",
  "mat4x2f", "mat4x2h", "mat4x3f", "mat4x3h", "mat4x4f", "mat4x4h",
] as const;

/**
 * Deliberately unprefixed generated names from `rendering/src/webgpu/WgslPrelude.ts`:
 * the `i*` builtins users read, the fragment/vertex hooks, the entry points the
 * pipelines look up, and the compute output helper. A config-provided uniform,
 * storage buffer, or channel with one of these spellings would collide with the
 * prelude, so config parsing rejects them with a config error instead.
 */
const WGSL_GENERATED_API_NAMES = [
  "iResolution", "iMouse", "iTime", "iTimeDelta", "iFrameRate", "iFrame",
  "iSampleRate", "iDate", "iCameraPos", "iCameraDir", "iDispatch",
  "mainImage", "mainVertex", "vertexMain", "fragmentMain", "writeOutput",
] as const;

/**
 * Per-channel free-function accessors (`iChannel0Sample`, `iChannel1Size`, …).
 * The slot is parametric, so a pattern covers every slot; the fixed names above
 * stay a plain set like the other vocabularies in this file.
 */
const WGSL_GENERATED_ACCESSOR_PATTERN = /^iChannel\d+(Sample|SampleLevel|SampleGrad|Size|Time|Loaded)$/;

const WGSL_RESERVED_IDENTIFIERS = new Set<string>([
  ...WGSL_KEYWORDS,
  ...WGSL_RESERVED_WORDS,
  ...WGSL_PREDECLARED_TYPE_ALIASES,
  ...WGSL_GENERATED_API_NAMES,
]);

const WGSL_KEYWORDS_AND_RESERVED_WORDS = new Set<string>([...WGSL_KEYWORDS, ...WGSL_RESERVED_WORDS]);

/**
 * Spellings the WGSL specification never allows as an identifier. Narrower than
 * {@link isShaderLanguageReservedTerm}, which also covers predeclared aliases and
 * generated names that WGSL itself lets a declaration use or shadow.
 */
export function isWgslReservedWord(name: string): boolean {
  return WGSL_KEYWORDS_AND_RESERVED_WORDS.has(name);
}

export function isShaderLanguageReservedTerm(
  languageId: ShaderLanguageId,
  name: string,
): boolean {
  if (languageId === "slang") {
    return SLANG_RESERVED_IDENTIFIERS.has(name);
  }
  if (languageId === "wgsl") {
    return WGSL_RESERVED_IDENTIFIERS.has(name) || WGSL_GENERATED_ACCESSOR_PATTERN.test(name);
  }
  return GLSL_ES_300_RESERVED_IDENTIFIERS.has(name)
    || name.startsWith("gl_")
    || name.includes("__");
}
