import { GLSL_STABLE_NAMES, SHADER_STUDIO_BUILTIN_UNIFORMS } from "./BuiltinUniforms";

export type ShaderStage = "fragment" | "vertex" | "compute" | "geometry" | "tess-control" | "tess-evaluation";

export type AuthoringValueType = "float" | "vec2" | "vec3" | "vec4" | "bool" | "int";

export interface CustomUniformDeclaration {
  readonly name: string;
  readonly type: AuthoringValueType;
}

export interface AuthoringResource {
  readonly name: string;
  readonly kind: "texture-2d" | "texture-cube" | "texture-3d" | "storage";
  readonly elementType?: string;
  /** Renderer channel slot; omitted input resources use their insertion-order slot. */
  readonly slot?: number;
}

export interface VirtualShaderFile {
  readonly uri: string;
  readonly text: string;
  readonly version: number;
}

export interface ShaderAuthoringEnvironment {
  readonly documentUri: string;
  readonly languageId: "glsl" | "slang";
  readonly generation: number;
  readonly passName: string;
  readonly stage: ShaderStage;
  readonly entryPoint?: string;
  readonly customUniforms: readonly Readonly<CustomUniformDeclaration>[];
  readonly resources: readonly Readonly<AuthoringResource>[];
  readonly virtualFiles: readonly Readonly<VirtualShaderFile>[];
}

export interface GeneratedAuthoringSource {
  readonly uri: string;
  readonly text: string;
  readonly generatedLineCount: number;
}

export interface ShaderAuthoringEnvironmentValidationIssue {
  readonly code: "invalid-identifier" | "duplicate-identifier" | "reserved-identifier" | "invalid-element-type" | "invalid-channel-slot" | "duplicate-channel-slot" | "channel-alias-collision";
  readonly message: string;
}

export interface AuthoringChannelBinding {
  readonly resource: Readonly<AuthoringResource>;
  readonly slot: number;
}

/** Bounds generated declaration size while exceeding the renderer's compatibility minimum. */
export const MAX_AUTHORING_CHANNEL_SLOTS = 1024;

const SHADER_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SHADER_STUDIO_RESERVED_NAMES = new Set([
  ...GLSL_STABLE_NAMES,
  ...SHADER_STUDIO_BUILTIN_UNIFORMS.map(({ name }) => name),
  "iWorldPosition",
  "iNormal",
  "iCameraPosition",
]);
const SHADER_LANGUAGE_KEYWORDS = new Set([
  "asm", "atomic_uint", "attribute", "bool", "break", "buffer", "bvec2", "bvec3", "bvec4", "case",
  "cbuffer", "centroid", "class", "coherent", "common", "const", "continue", "dmat2", "dmat3", "dmat4",
  "double", "do", "dvec2", "dvec3", "dvec4", "default", "discard", "else", "enum", "extern", "false",
  "flat", "float", "for", "fvec2", "fvec3", "fvec4", "groupshared", "half", "highp", "if", "image2D",
  "image3D", "imageCube", "import", "in", "inout", "int", "interface", "layout", "lowp", "mat2", "mat2x2",
  "mat2x3", "mat2x4", "mat3", "mat3x2", "mat3x3", "mat3x4", "mat4", "mat4x2", "mat4x3", "mat4x4",
  "module", "namespace", "nointerpolation", "out", "packoffset", "precision", "public", "readonly", "return",
  "RWStructuredBuffer", "RWTexture2D", "RWTexture2DArray", "SamplerComparisonState", "SamplerState", "sampler2D",
  "sampler2DArray", "sampler2DArrayShadow", "sampler2DMS", "sampler2DMSArray", "sampler2DRect", "sampler2DShadow",
  "sampler3D", "samplerCube", "samplerCubeArray", "samplerCubeArrayShadow", "static", "struct", "StructuredBuffer",
  "switch", "Texture2D", "Texture2DArray", "Texture3D", "TextureCube", "true", "typedef", "uint", "uvec2", "uvec3",
  "uvec4", "uniform", "varying", "vec2", "vec3", "vec4", "void", "volatile", "while", "writeonly",
  "export", "invariant", "isampler2D", "isampler2DArray", "isampler2DArray", "isampler3D", "isamplerCube",
  "noperspective", "samplerCubeShadow", "smooth", "subroutine",
]);
const STORAGE_ELEMENT_TYPE = /^[A-Za-z_][A-Za-z0-9_]*(?:\s*<\s*[A-Za-z_][A-Za-z0-9_]*\s*>)?$/;
const BUILTIN_STORAGE_ELEMENT_TYPES = new Set([
  "float", "float2", "float3", "float4", "int", "int2", "int3", "int4", "uint", "uint2", "uint3", "uint4",
  "float2x2", "float3x3", "float4x4", "Atomic<uint>", "Atomic<int>",
]);

function isReservedShaderStudioIdentifier(name: string): boolean {
  return SHADER_STUDIO_RESERVED_NAMES.has(name)
    || SHADER_LANGUAGE_KEYWORDS.has(name)
    || name.startsWith("gl_")
    || /^iChannel\d+$/.test(name)
    || /^iCh[0-3]$/.test(name);
}

function isValidStorageElementType(elementType: string): boolean {
  if (BUILTIN_STORAGE_ELEMENT_TYPES.has(elementType)) {
    return true;
  }
  if (!STORAGE_ELEMENT_TYPE.test(elementType)) {
    return false;
  }
  const tokens = elementType.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  const [outer, inner] = tokens;
  if (!outer || SHADER_LANGUAGE_KEYWORDS.has(outer) || outer.startsWith("gl_")) {
    return false;
  }
  return !inner
    || (outer === "Atomic" && (inner === "uint" || inner === "int"))
    || (!SHADER_LANGUAGE_KEYWORDS.has(inner) && !inner.startsWith("gl_"));
}

/** Resolves non-storage resources to renderer channel slots without inferring slots from names. */
export function resolveAuthoringChannelBindings(
  resources: readonly Readonly<AuthoringResource>[],
): AuthoringChannelBinding[] {
  return resources
    .filter((resource) => resource.kind !== "storage")
    .map((resource, index) => ({ resource, slot: resource.slot ?? index }))
    .filter(({ slot }) => Number.isInteger(slot) && slot >= 0 && slot < MAX_AUTHORING_CHANNEL_SLOTS);
}

/** Returns validation diagnostics for generated declarations without mutating or throwing. */
export function validateShaderAuthoringEnvironment(
  environment: ShaderAuthoringEnvironment,
): ShaderAuthoringEnvironmentValidationIssue[] {
  const issues: ShaderAuthoringEnvironmentValidationIssue[] = [];
  const names = new Map<string, "custom uniform" | "resource">();
  const validate = (name: string, noun: "custom uniform" | "resource"): void => {
    const displayName = noun === "custom uniform" ? "Custom uniform" : "Resource";
    if (!SHADER_IDENTIFIER.test(name)) {
      issues.push({
        code: "invalid-identifier",
        message: `${displayName} "${name}" is not a valid shader identifier.`,
      });
      return;
    }
    if (isReservedShaderStudioIdentifier(name) && !(noun === "resource" && /^iChannel\d+$/.test(name))) {
      issues.push({
        code: "reserved-identifier",
        message: `${displayName} "${name}" conflicts with a Shader Studio built-in.`,
      });
      return;
    }
    const existing = names.get(name);
    if (existing) {
      issues.push({
        code: "duplicate-identifier",
        message: `${displayName} "${name}" duplicates a ${existing}.`,
      });
      return;
    }
    names.set(name, noun);
  };

  for (const uniform of environment.customUniforms) {
    validate(uniform.name, "custom uniform");
  }
  for (const resource of environment.resources) {
    validate(resource.name, "resource");
    if (resource.kind === "storage" && resource.elementType && !isValidStorageElementType(resource.elementType)) {
      issues.push({
        code: "invalid-element-type",
        message: `Storage resource "${resource.name}" has an invalid element type.`,
      });
    }
  }

  const channelSlots = new Set<number>();
  for (const { resource, slot } of environment.resources
    .filter((resource) => resource.kind !== "storage")
    .map((resource, index) => ({ resource, slot: resource.slot ?? index }))) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_AUTHORING_CHANNEL_SLOTS) {
      issues.push({
        code: "invalid-channel-slot",
        message: `Resource "${resource.name}" has an invalid channel slot.`,
      });
    } else {
      const canonicalChannel = /^iChannel(0|[1-9]\d*)$/.exec(resource.name);
      if (canonicalChannel && Number.parseInt(canonicalChannel[1]!, 10) !== slot) {
        issues.push({
          code: "channel-alias-collision",
          message: `Resource "${resource.name}" conflicts with canonical channel slot ${canonicalChannel[1]}.`,
        });
      }
      if (channelSlots.has(slot)) {
        issues.push({
          code: "duplicate-channel-slot",
          message: `Resource "${resource.name}" duplicates channel slot ${slot}.`,
        });
      } else {
        channelSlots.add(slot);
      }
    }
  }

  return issues;
}
