import {
  GLSL_STABLE_NAMES,
  SLANG_RUNTIME_INTERNAL_NAMES,
  shaderStudioBuiltinUniformNames,
  type ShaderStudioBuiltinStage,
} from "./BuiltinUniforms";
import { isShaderLanguageReservedTerm } from "./ShaderLanguageReservedTerms";
import type { ShaderLanguageId } from "./ShaderLanguages";
import { WGSL_NATIVE_STORAGE_ELEMENT_TYPES } from "../wgslStorage";

export type ShaderStage = ShaderStudioBuiltinStage;

export type AuthoringValueType = "float" | "vec2" | "vec3" | "vec4" | "bool";

const AUTHORING_VALUE_TYPES: ReadonlySet<string> = new Set([
  "float",
  "vec2",
  "vec3",
  "vec4",
  "bool",
]);

export function isAuthoringValueType(value: unknown): value is AuthoringValueType {
  return typeof value === "string" && AUTHORING_VALUE_TYPES.has(value);
}

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
  readonly languageId: ShaderLanguageId;
  readonly generation: number;
  readonly passName: string;
  readonly stage: ShaderStage;
  readonly entryPoint?: string;
  /** Compute output texture layer count; omitted and one select the 2D output helper. */
  readonly outputLayers?: number;
  readonly customUniforms: readonly Readonly<CustomUniformDeclaration>[];
  readonly resources: readonly Readonly<AuthoringResource>[];
  /** Shader Studio Common source implicitly prepended to configured render passes. */
  readonly commonFile?: Readonly<VirtualShaderFile>;
  readonly virtualFiles: readonly Readonly<VirtualShaderFile>[];
  /** Workspace search snapshots; these are independent compilation units, not includes. */
  readonly workspaceDocuments?: readonly (Readonly<VirtualShaderFile> & {
    readonly stage: ShaderStage;
    readonly commonUri?: string;
  })[];
}

export interface GeneratedAuthoringSource {
  readonly uri: string;
  readonly text: string;
  readonly generatedLineCount: number;
}

export interface ShaderAuthoringEnvironmentValidationIssue {
  readonly code: "invalid-identifier" | "duplicate-identifier" | "reserved-identifier" | "invalid-element-type" | "invalid-channel-slot" | "duplicate-channel-slot" | "channel-alias-collision" | "generated-identifier-collision";
  readonly message: string;
}

export interface AuthoringChannelBinding {
  readonly resource: Readonly<AuthoringResource>;
  readonly slot: number;
}

/** Bounds generated declaration size while exceeding the renderer's compatibility minimum. */
export const MAX_AUTHORING_CHANNEL_SLOTS = 1024;

const SHADER_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function collectFixedRendererNames(
  languageId: ShaderAuthoringEnvironment["languageId"],
): ReadonlySet<string> {
  const names = new Set<string>();
  if (languageId === "glsl") {
    for (const name of GLSL_STABLE_NAMES) {
      names.add(name);
    }
  } else if (languageId === "wgsl") {
    // The WGSL prelude's deliberate public API: hooks, entry points, and the
    // compute output helper. Builtins (iTime, ...) arrive via
    // shaderStudioBuiltinUniformNames; keywords, aliases, and per-channel
    // accessors via isShaderLanguageReservedTerm.
    names.add("mainImage");
    names.add("mainVertex");
    names.add("vertexMain");
    names.add("fragmentMain");
    names.add("writeOutput");
  } else {
    for (const name of SLANG_RUNTIME_INTERNAL_NAMES) {
      names.add(name);
    }
    names.add("writeOutput");
  }
  if (languageId !== 'glsl') {
    for (const shape of ['2D', 'Cube', '3D']) {
      for (const operation of ['', 'Level', 'Grad']) {
        names.add(`sample${shape}${operation}`);
      }
    }
  } else {
    for (const shape of ['2D', 'Cube', '3D']) {
      names.add(`ShaderStudioChannel${shape}`);
    }
  }
  for (const name of shaderStudioBuiltinUniformNames(languageId)) {
    names.add(name);
  }
  return names;
}

const FIXED_RENDERER_NAMES_BY_LANGUAGE: Record<ShaderLanguageId, ReadonlySet<string>> = {
  glsl: collectFixedRendererNames("glsl"),
  slang: collectFixedRendererNames("slang"),
  wgsl: collectFixedRendererNames("wgsl"),
};
const STORAGE_ELEMENT_TYPE = /^[A-Za-z_][A-Za-z0-9_]*(?:\s*<\s*[A-Za-z_][A-Za-z0-9_]*\s*>)?$/;
const BUILTIN_STORAGE_ELEMENT_TYPES = new Set([
  "float", "float2", "float3", "float4", "int", "int2", "int3", "int4", "uint", "uint2", "uint3", "uint4",
  "float2x2", "float3x3", "float4x4", "Atomic<uint>", "Atomic<int>",
]);
const FORBIDDEN_STORAGE_ELEMENT_TYPE_TOKENS = new Set(["uniform"]);
const SLANG_BASE_GENERATED_TYPE_DEPENDENCIES = new Set([
  "float", "float2", "float3", "float4", "int",
  "ShaderStudioChannel2D", "ShaderStudioChannelCube", "ShaderStudioChannel3D",
]);
const SLANG_CHANNEL_RESOURCE_TYPE_DEPENDENCIES = {
  "texture-2d": "Texture2D",
  "texture-cube": "TextureCube",
  "texture-3d": "Texture3D",
} as const;

function isReservedShaderStudioIdentifier(
  name: string,
  languageId: ShaderAuthoringEnvironment["languageId"],
): boolean {
  return FIXED_RENDERER_NAMES_BY_LANGUAGE[languageId].has(name)
    || isShaderLanguageReservedTerm(languageId, name)
    // iChannelN remains GLSL's public compatibility surface.
    || (languageId === "glsl" && /^iChannel\d+$/.test(name));
}

function isValidStorageElementType(
  elementType: string,
  languageId: ShaderAuthoringEnvironment["languageId"],
): boolean {
  const normalized = elementType.replace(/\s+/g, "");
  if (BUILTIN_STORAGE_ELEMENT_TYPES.has(normalized)) {
    return true;
  }
  // A WGSL config spells element types in WGSL (`f32`, `vec4<f32>`) as often as
  // it uses the shared aliases; the renderer passes those through untouched, so
  // treating them as reserved words warned on valid shaders.
  if (languageId === "wgsl" && WGSL_NATIVE_STORAGE_ELEMENT_TYPES.has(normalized)) {
    return true;
  }
  if (!STORAGE_ELEMENT_TYPE.test(elementType)) {
    return false;
  }
  const tokens = elementType.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  const [outer, inner] = tokens;
  if (!outer || FORBIDDEN_STORAGE_ELEMENT_TYPE_TOKENS.has(outer) || isShaderLanguageReservedTerm(languageId, outer)) {
    return false;
  }
  // WGSL has no user-defined generic types. The native and shared generic
  // spellings returned above are the complete supported set.
  if (languageId === "wgsl" && inner) {
    return false;
  }
  return !inner
    || (outer === "Atomic" && (inner === "uint" || inner === "int"))
    || (!FORBIDDEN_STORAGE_ELEMENT_TYPE_TOKENS.has(inner) && !isShaderLanguageReservedTerm(languageId, inner));
}

function collectSlangGeneratedTypeDependencies(
  environment: ShaderAuthoringEnvironment,
): ReadonlySet<string> {
  const dependencies = new Set(SLANG_BASE_GENERATED_TYPE_DEPENDENCIES);
  if (environment.customUniforms.some((uniform) => (
    uniform.type === "bool"
    && uniform.name !== "bool"
    && isValidShaderIdentifier(uniform.name)
  ))) {
    dependencies.add("bool");
  }

  for (const { resource } of resolveAuthoringChannelBindings(environment.resources)) {
    if (!isValidShaderIdentifier(resource.name) || resource.kind === "storage") {
      continue;
    }
    const resourceType = SLANG_CHANNEL_RESOURCE_TYPE_DEPENDENCIES[resource.kind];
    dependencies.add(resourceType);
    dependencies.add("SamplerState");
  }

  for (const resource of environment.resources) {
    if (
      resource.kind !== "storage"
      || !isValidShaderIdentifier(resource.name)
    ) {
      continue;
    }
    const bufferType = environment.stage === "compute" ? "RWStructuredBuffer" : "StructuredBuffer";
    if (resource.name !== bufferType) {
      dependencies.add(bufferType);
    }
    const elementType = resource.elementType ?? "float4";
    if (!isValidStorageElementType(elementType, "slang")) {
      continue;
    }
    const renderedElementType = environment.stage !== "compute" && elementType === "Atomic<uint>"
      ? "uint"
      : environment.stage !== "compute" && elementType === "Atomic<int>"
        ? "int"
        : elementType;
    for (const token of renderedElementType.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
      if (resource.name !== token) {
        dependencies.add(token);
      }
    }
  }

  return dependencies;
}

export interface SlangChannelGeneratedIdentifiers {
  readonly texture: string;
  readonly sampler: string;
  readonly channelName: string;
}

export function isValidShaderIdentifier(name: string): boolean {
  return SHADER_IDENTIFIER.test(name);
}

/** Derives implementation-only Slang identifiers emitted for one renderer channel binding. */
export function deriveSlangChannelGeneratedIdentifiers(
  binding: AuthoringChannelBinding,
): SlangChannelGeneratedIdentifiers {
  const { resource, slot } = binding;
  return {
    texture: `_ssTexture${slot}`,
    sampler: `_ssSampler${slot}`,
    channelName: resource.name,
  };
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
  const generatedTypeDependencies = environment.languageId === "slang"
    ? collectSlangGeneratedTypeDependencies(environment)
    : new Set<string>();
  const validate = (
    name: string,
    noun: "custom uniform" | "resource",
    isGlslCanonicalChannel = false,
    isSlangChannel = false,
  ): boolean => {
    const displayName = noun === "custom uniform" ? "Custom uniform" : "Resource";
    if (!isValidShaderIdentifier(name)) {
      issues.push({
        code: "invalid-identifier",
        message: `${displayName} "${name}" is not a valid shader identifier.`,
      });
      return false;
    }
    const isGeneratedTypeDependency = generatedTypeDependencies.has(name);
    const isBuiltinOrLanguageReserved = isReservedShaderStudioIdentifier(name, environment.languageId);
    const isSlangInternalGlobal = environment.languageId === "slang"
      && name.startsWith("_ss");
    // The WGSL prelude shares the `_ss` implementation namespace (Phase 7), so
    // a config-provided `_ss` name would collide with generated declarations.
    // GLSL keeps its own `gl_`/`__` rule inside isShaderLanguageReservedTerm.
    const isWgslInternalGlobal = environment.languageId === "wgsl"
      && name.startsWith("_ss");
    if (
      (isBuiltinOrLanguageReserved && !isGlslCanonicalChannel)
      || isSlangInternalGlobal
      || isWgslInternalGlobal
      || isGeneratedTypeDependency
    ) {
      issues.push({
        code: "reserved-identifier",
        message: `${displayName} "${name}" conflicts with a Shader Studio built-in.${isSlangChannel ? " Rename the .sha.json input key to use direct Slang channel syntax." : ""}`,
      });
      return false;
    }
    const existing = names.get(name);
    if (existing) {
      issues.push({
        code: "duplicate-identifier",
        message: `${displayName} "${name}" duplicates a ${existing}.`,
      });
      return false;
    }
    names.set(name, noun);
    return true;
  };

  for (const uniform of environment.customUniforms) {
    validate(uniform.name, "custom uniform");
  }
  for (const resource of environment.resources) {
    const isGlslCanonicalChannel = environment.languageId === "glsl"
      && resource.kind !== "storage"
      && /^iChannel\d+$/.test(resource.name);
    const valid = validate(
      resource.name,
      "resource",
      isGlslCanonicalChannel,
      environment.languageId === "slang" && resource.kind !== "storage",
    );
    if (resource.kind === "storage" && resource.elementType && !isValidStorageElementType(resource.elementType, environment.languageId)) {
      issues.push({
        code: "invalid-element-type",
        message: `Storage resource "${resource.name}" has an invalid element type.`,
      });
    }
  }

  if (environment.languageId === 'wgsl') {
    const generated = new Set<string>();
    for (const resource of environment.resources.filter(resource => resource.kind !== 'storage')) {
      for (const suffix of ['Texture', 'Sampler', 'Sample', 'SampleLevel', 'SampleGrad', 'Load', 'Size', 'Time', 'Loaded']) {
        const name = `${resource.name}${suffix}`;
        if (names.has(name) || generated.has(name)) {
          issues.push({ code: 'generated-identifier-collision', message: `Generated channel identifier "${name}" conflicts with another declaration.` });
        }
        generated.add(name);
      }
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
      if (environment.languageId === "glsl" && canonicalChannel && Number.parseInt(canonicalChannel[1]!, 10) !== slot) {
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
