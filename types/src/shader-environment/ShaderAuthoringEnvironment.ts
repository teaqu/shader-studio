import { GLSL_STABLE_NAMES, SHADER_STUDIO_BUILTIN_UNIFORMS } from "./BuiltinUniforms";
import { isShaderLanguageReservedTerm } from "./ShaderLanguageReservedTerms";

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
const SHADER_STUDIO_RESERVED_NAMES = new Set([
  ...GLSL_STABLE_NAMES,
  ...SHADER_STUDIO_BUILTIN_UNIFORMS.map(({ name }) => name),
  "iWorldPosition",
  "iNormal",
  "iCameraPosition",
]);
const STORAGE_ELEMENT_TYPE = /^[A-Za-z_][A-Za-z0-9_]*(?:\s*<\s*[A-Za-z_][A-Za-z0-9_]*\s*>)?$/;
const BUILTIN_STORAGE_ELEMENT_TYPES = new Set([
  "float", "float2", "float3", "float4", "int", "int2", "int3", "int4", "uint", "uint2", "uint3", "uint4",
  "float2x2", "float3x3", "float4x4", "Atomic<uint>", "Atomic<int>",
]);

function isReservedShaderStudioIdentifier(name: string): boolean {
  return SHADER_STUDIO_RESERVED_NAMES.has(name)
    || isShaderLanguageReservedTerm(name)
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
  if (!outer || isShaderLanguageReservedTerm(outer)) {
    return false;
  }
  return !inner
    || (outer === "Atomic" && (inner === "uint" || inner === "int"))
    || !isShaderLanguageReservedTerm(inner);
}

export interface SlangChannelGeneratedIdentifiers {
  readonly sampler: string;
  readonly slotHelper?: string;
  readonly slotVertexHelper?: string;
  readonly aliasHelper?: string;
  readonly aliasVertexHelper?: string;
  readonly metadataAccessor?: string;
}

/** Derives the global Slang identifiers emitted for one renderer channel binding. */
export function deriveSlangChannelGeneratedIdentifiers(
  binding: AuthoringChannelBinding,
): SlangChannelGeneratedIdentifiers {
  const { resource, slot } = binding;
  const sampler = `${resource.name}Sampler`;
  if (resource.kind === "storage" || resource.kind === "texture-3d") {
    return { sampler };
  }
  const slotHelper = `sampleIChannel${slot}`;
  const aliasHelper = resource.name === `iChannel${slot}`
    ? undefined
    : `sample${resource.name[0]!.toUpperCase()}${resource.name.slice(1)}`;
  return {
    sampler,
    slotHelper,
    slotVertexHelper: `${slotHelper}Vertex`,
    aliasHelper,
    aliasVertexHelper: aliasHelper ? `${aliasHelper}Vertex` : undefined,
    metadataAccessor: slot < 4 ? `_getICh${slot}` : undefined,
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
  const validate = (name: string, noun: "custom uniform" | "resource", allowChannelName = false): void => {
    const displayName = noun === "custom uniform" ? "Custom uniform" : "Resource";
    if (!SHADER_IDENTIFIER.test(name)) {
      issues.push({
        code: "invalid-identifier",
        message: `${displayName} "${name}" is not a valid shader identifier.`,
      });
      return;
    }
    if (isReservedShaderStudioIdentifier(name) && !allowChannelName) {
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
    validate(resource.name, "resource", resource.kind !== "storage" && /^iChannel\d+$/.test(resource.name));
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

  if (environment.languageId === "slang") {
    const claims = new Map<string, string>(
      [...names].map(([name, noun]) => [name, `${noun} "${name}"`] as const),
    );
    const claimGeneratedIdentifier = (identifier: string, owner: string): void => {
      const existing = claims.get(identifier);
      if (existing) {
        issues.push({
          code: "generated-identifier-collision",
          message: `Generated Slang identifier "${identifier}" collides between ${existing} and ${owner}.`,
        });
        return;
      }
      claims.set(identifier, owner);
    };
    const channelBindings = resolveAuthoringChannelBindings(environment.resources);

    for (const binding of channelBindings) {
      const identifiers = deriveSlangChannelGeneratedIdentifiers(binding);
      const owner = `resource "${binding.resource.name}"`;
      for (const identifier of [
        identifiers.sampler,
        identifiers.slotHelper,
        identifiers.slotVertexHelper,
        identifiers.aliasHelper,
        identifiers.aliasVertexHelper,
        identifiers.metadataAccessor,
      ]) {
        if (identifier) {
          claimGeneratedIdentifier(identifier, owner);
        }
      }
    }

    const metadataBindings = channelBindings
      .filter(({ resource, slot }) => slot < 4 && resource.kind !== "texture-3d");
    if (metadataBindings.some(({ resource }) => resource.kind === "texture-cube")) {
      claimGeneratedIdentifier("ShaderToySamplerCube", "generated channel metadata");
      claimGeneratedIdentifier("ShaderToyChannelCube", "generated channel metadata");
    }
    if (metadataBindings.some(({ resource }) => resource.kind !== "texture-cube")) {
      claimGeneratedIdentifier("ShaderToySampler2D", "generated channel metadata");
      claimGeneratedIdentifier("ShaderToyChannel2D", "generated channel metadata");
    }

    const claimedSlots = new Set(channelBindings.map(({ slot }) => slot));
    for (const slot of [0, 1, 2, 3]) {
      if (!claimedSlots.has(slot)) {
        claimGeneratedIdentifier(`sampleIChannel${slot}`, `fallback channel slot ${slot}`);
      }
    }
  }

  return issues;
}
