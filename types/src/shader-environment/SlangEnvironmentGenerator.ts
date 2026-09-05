import { buildSlangChannels } from './SlangChannels';
import {
  SHADER_STUDIO_BUILTIN_UNIFORMS,
  SHADER_STUDIO_FRAGMENT_CONTEXT,
  SLANG_RUNTIME_UNIFORM_ALIAS_LINES,
  SLANG_RUNTIME_UNIFORM_BUFFER_NAME,
} from "./BuiltinUniforms";
import {
  isAuthoringValueType,
  isValidShaderIdentifier,
  resolveAuthoringChannelBindings,
  type AuthoringValueType,
  type GeneratedAuthoringSource,
  type ShaderAuthoringEnvironment,
} from "./ShaderAuthoringEnvironment";

export type SlangCustomUniformType = AuthoringValueType;

export interface SlangCustomUniformInfo {
  name: string;
  type: string;
}

const SLANG_AUTHORING_VALUE_TYPES = {
  float: "float",
  vec2: "float2",
  vec3: "float3",
  vec4: "float4",
  bool: "bool",
} as const satisfies Record<AuthoringValueType, string>;

const SLANG_RUNTIME_VALUE_TYPES: Record<SlangCustomUniformType, string> = {
  float: "float",
  vec2: "float2",
  vec3: "float3",
  vec4: "float4",
  bool: "int",
};

export function isSlangCustomUniformType(type: string): type is SlangCustomUniformType {
  return isAuthoringValueType(type);
}

/** Builds a standalone Slang declaration module for authoring tools. */
export function buildSlangAuthoringModule(
  environment: ShaderAuthoringEnvironment,
): GeneratedAuthoringSource {
  const channelBindings = resolveAuthoringChannelBindings(environment.resources)
    .filter(({ resource }) => isValidShaderIdentifier(resource.name));
  const resourceLines = environment.resources
    .filter((resource) => (
      resource.kind === "storage"
      && isValidShaderIdentifier(resource.name)
    ))
    .flatMap((resource) => {
      if (resource.kind === "storage") {
        const elementType = resource.elementType ?? "float4";
        const bufferType = environment.stage === "compute" ? "RWStructuredBuffer" : "StructuredBuffer";
        const renderElementType = environment.stage === "compute"
          ? elementType
          : elementType === "Atomic<uint>" ? "uint" : elementType === "Atomic<int>" ? "int" : elementType;
        return [`${bufferType}<${renderElementType}> ${resource.name};`];
      }
      return [];
    });
  const channelLines = buildSlangChannels(channelBindings.flatMap(({ resource, slot }) => resource.kind === "storage"
    ? []
    : [{ name: resource.name, kind: resource.kind, slot }]));
  const computeOutputLines = environment.stage !== "compute"
    ? []
    : environment.outputLayers && environment.outputLayers > 1
      ? ["void writeOutput(uint2 coord, uint layer, float4 color)\n{\n}"]
      : ["void writeOutput(uint2 coord, float4 color)\n{\n}"];
  const lines = [
    ...SHADER_STUDIO_BUILTIN_UNIFORMS
      .flatMap((uniform) => {
        const declaration = uniform.slangDeclaration;
        return declaration
          && uniform.languages.includes("slang")
          && (!uniform.stages || uniform.stages.includes(environment.stage))
          ? [declaration]
          : [];
      }),
    ...environment.customUniforms
      .filter((uniform) => isValidShaderIdentifier(uniform.name))
      .flatMap((uniform) => {
        if (!isAuthoringValueType(uniform.type)) {
          return [];
        }
        const typeName = SLANG_AUTHORING_VALUE_TYPES[uniform.type];
        return [`${typeName} ${uniform.name};`];
      }),
    ...resourceLines,
    channelLines,
    ...computeOutputLines,
  ];

  const text = lines.join("\n");

  return {
    uri: environment.documentUri,
    text,
    generatedLineCount: text.split("\n").length,
  };
}

/** Builds the renderer-owned fixed uniform block with the existing Slang ABI. */
export interface SlangRuntimeContextNames {
  worldPosition: string;
  normal: string;
  cameraPosition: string;
}

/**
 * Builds the renderer-owned fixed uniform block with the existing Slang ABI.
 * Context variable names stay renderer-owned because mesh wrapping selects them.
 */
export function buildSlangRuntimePrelude(
  customUniforms: readonly SlangCustomUniformInfo[] = [],
  contextNames: SlangRuntimeContextNames = {
    worldPosition: "_shaderStudioWorldPosition",
    normal: "_shaderStudioNormal",
    cameraPosition: "_shaderStudioCameraPosition",
  },
  channelCount = 4,
): string {
  const fields = customUniforms
    .flatMap(({ name, type }) => isSlangCustomUniformType(type)
      ? [`    ${SLANG_RUNTIME_VALUE_TYPES[type]} custom_${name};`]
      : [])
    .join("\n");
  const aliases = customUniforms
    .flatMap(({ name, type }) => !isSlangCustomUniformType(type)
      ? []
      : [type === "bool"
        ? `#define ${name} (${SLANG_RUNTIME_UNIFORM_BUFFER_NAME}.custom_${name} != 0)`
        : `#define ${name} (${SLANG_RUNTIME_UNIFORM_BUFFER_NAME}.custom_${name})`])
    .join("\n");
  const contextDeclarations = [
    { symbol: SHADER_STUDIO_FRAGMENT_CONTEXT.worldPosition, contextName: contextNames.worldPosition },
    { symbol: SHADER_STUDIO_FRAGMENT_CONTEXT.normal, contextName: contextNames.normal },
    { symbol: SHADER_STUDIO_FRAGMENT_CONTEXT.cameraPosition, contextName: contextNames.cameraPosition },
  ].map(({ symbol, contextName }) => `static ${symbol.slangType} ${contextName};`).join("\n");

  return `// ---- shader-studio Slang prelude (generated) ----
struct ShaderToyUniforms
{
    float4 resolution;
    float4 mouse;
    float time;
    float timeDelta;
    float frameRate;
    int frame;
    float channelTime[${channelCount}];
    float channelLoaded[${channelCount}];
    float sampleRate;
    float4 date;
    float3 channelResolution[${channelCount}];
    float4 cameraPos;
    float4 cameraDir;
${fields}
};

[[vk::binding(0, 0)]]
ConstantBuffer<ShaderToyUniforms> ${SLANG_RUNTIME_UNIFORM_BUFFER_NAME};

${SLANG_RUNTIME_UNIFORM_ALIAS_LINES.join("\n")}
${aliases}
${contextDeclarations}
`;
}
