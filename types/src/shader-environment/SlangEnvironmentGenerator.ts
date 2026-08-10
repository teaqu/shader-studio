import {
  SHADER_STUDIO_BUILTIN_UNIFORMS,
  SLANG_RUNTIME_FIXED_UNIFORM_FIELD_LINES,
  SLANG_RUNTIME_UNIFORM_ALIAS_LINES,
} from "./BuiltinUniforms";
import {
  resolveAuthoringChannelBindings,
  type AuthoringChannelBinding,
  type GeneratedAuthoringSource,
  type ShaderAuthoringEnvironment,
} from "./ShaderAuthoringEnvironment";

export type SlangCustomUniformType = "float" | "vec2" | "vec3" | "vec4" | "bool";

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
  int: "int",
} as const;

const SLANG_RUNTIME_VALUE_TYPES: Record<SlangCustomUniformType, string> = {
  float: "float",
  vec2: "float2",
  vec3: "float3",
  vec4: "float4",
  bool: "int",
};

const SLANG_RESOURCE_TYPES = {
  "texture-2d": "Texture2D<float4>",
  "texture-cube": "TextureCube<float4>",
  "texture-3d": "Texture3D<float4>",
} as const;

function buildSlangChannelMetadata(
  channelBindings: readonly AuthoringChannelBinding[],
  stage: ShaderAuthoringEnvironment["stage"],
): string[] {
  const channels = channelBindings.filter(({ resource, slot }) => slot < 4 && resource.kind !== "texture-3d");
  const has2D = channels.some(({ resource }) => resource.kind !== "texture-cube");
  const hasCube = channels.some(({ resource }) => resource.kind === "texture-cube");
  const sample2D = stage === "compute"
    ? "texture.SampleLevel(state, float2(uv.x, 1.0 - uv.y), 0.0)"
    : "texture.Sample(state, float2(uv.x, 1.0 - uv.y))";
  const sampleCube = stage === "compute"
    ? "texture.SampleLevel(state, dir, 0.0)"
    : "texture.Sample(state, dir)";
  const lines = [
    ...(has2D ? [
      `struct ShaderToySampler2D
{
    Texture2D<float4> texture;
    SamplerState state;

    float4 Sample(float2 uv)
    {
        return ${sample2D};
    }
};

struct ShaderToyChannel2D
{
    ShaderToySampler2D sampler;
    float3 size;
    float time;
    int loaded;
};`,
    ] : []),
    ...(hasCube ? [
      `struct ShaderToySamplerCube
{
    TextureCube<float4> texture;
    SamplerState state;

    float4 Sample(float3 dir)
    {
        return ${sampleCube};
    }
};

struct ShaderToyChannelCube
{
    ShaderToySamplerCube sampler;
    float3 size;
    float time;
    int loaded;
};`,
    ] : []),
  ];
  for (const { resource, slot } of channels) {
    const type = resource.kind === "texture-cube" ? "Cube" : "2D";
    lines.push(
      `ShaderToyChannel${type} _getICh${slot}()
{
    ShaderToyChannel${type} channel;
    channel.sampler.texture = ${resource.name};
    channel.sampler.state = ${resource.name}Sampler;
    channel.size = iChannelResolution[${slot}];
    channel.time = iChannelTime[${slot}];
    channel.loaded = iChannelLoaded[${slot}] != 0.0 ? 1 : 0;
    return channel;
}`,
      `#define iCh${slot} (_getICh${slot}())`,
    );
  }
  return lines;
}

function buildSlangChannelDeclarations(
  channelBindings: readonly AuthoringChannelBinding[],
  stage: ShaderAuthoringEnvironment["stage"],
): string[] {
  const sampleMethod = stage === "compute" ? "SampleLevel" : "Sample";
  const explicitLod = stage === "compute" ? ", 0.0" : "";
  const declarations = channelBindings.flatMap(({ resource, slot }) => {
    if (resource.kind === "storage") {
      return [];
    }
    const type = SLANG_RESOURCE_TYPES[resource.kind];
    if (resource.kind === "texture-3d") {
      // The runtime channel prelude only exposes two-dimensional and cube sampling helpers.
      return [`${type} ${resource.name};`, `SamplerState ${resource.name}Sampler;`];
    }
    const isCube = resource.kind === "texture-cube";
    const argument = isCube ? "float3 dir" : "float2 uv";
    const sampledArgument = isCube ? "dir" : "float2(uv.x, 1.0 - uv.y)";
    const helperName = `sampleIChannel${slot}`;
    const customHelperName = resource.name === `iChannel${slot}`
      ? null
      : `sample${resource.name[0]!.toUpperCase()}${resource.name.slice(1)}`;
    return [
      `${type} ${resource.name};`,
      `SamplerState ${resource.name}Sampler;`,
      `float4 ${helperName}(${argument})\n{\n    return ${resource.name}.${sampleMethod}(${resource.name}Sampler, ${sampledArgument}${explicitLod});\n}`,
      `float4 ${helperName}Vertex(${argument})\n{\n    return ${resource.name}.SampleLevel(${resource.name}Sampler, ${sampledArgument}, 0.0);\n}`,
      ...(customHelperName ? [
        `float4 ${customHelperName}(${argument})\n{\n    return ${helperName}(${isCube ? "dir" : "uv"});\n}`,
        `float4 ${customHelperName}Vertex(${argument})\n{\n    return ${helperName}Vertex(${isCube ? "dir" : "uv"});\n}`,
      ] : []),
    ];
  });
  const claimedSlots = new Set(channelBindings.map(({ slot }) => slot));
  const fallbackHelpers = [0, 1, 2, 3]
    .filter((slot) => !claimedSlots.has(slot))
    .map((slot) => `float4 sampleIChannel${slot}(float2 uv)\n{\n    return float4(0.0, 0.0, 0.0, 1.0);\n}`);

  return [...declarations, ...fallbackHelpers];
}

export function isSlangCustomUniformType(type: string): type is SlangCustomUniformType {
  return type in SLANG_RUNTIME_VALUE_TYPES;
}

/** Builds a standalone Slang declaration module for authoring tools. */
export function buildSlangAuthoringModule(
  environment: ShaderAuthoringEnvironment,
): GeneratedAuthoringSource {
  const channelBindings = resolveAuthoringChannelBindings(environment.resources);
  const resourceLines = environment.resources
    .filter((resource) => resource.kind === "storage" && !/^iChannel\d+$/.test(resource.name))
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
  const channelLines = buildSlangChannelDeclarations(channelBindings, environment.stage);
  const lines = [
    ...SHADER_STUDIO_BUILTIN_UNIFORMS
      .filter((uniform) => !/^iChannel[0-3]$/.test(uniform.name) && !/^iCh[0-3]$/.test(uniform.name))
      .map((uniform) => uniform.name === "iChannelResolution"
      ? "float3 iChannelResolution[4];"
      : `${uniform.slangType} ${uniform.name};`),
    ...environment.customUniforms.map((uniform) => `${SLANG_AUTHORING_VALUE_TYPES[uniform.type]} ${uniform.name};`),
    ...resourceLines,
    ...channelLines,
    ...buildSlangChannelMetadata(channelBindings, environment.stage),
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
        ? `#define ${name} (_st.custom_${name} != 0)`
        : `#define ${name} (_st.custom_${name})`])
    .join("\n");

  return `// ---- shader-studio Slang prelude (generated) ----
struct ShaderToyUniforms
{
${SLANG_RUNTIME_FIXED_UNIFORM_FIELD_LINES.join("\n")}
${fields}
};

[[vk::binding(0, 0)]]
ConstantBuffer<ShaderToyUniforms> _st;

${SLANG_RUNTIME_UNIFORM_ALIAS_LINES.join("\n")}
${aliases}
static float3 ${contextNames.worldPosition};
static float3 ${contextNames.normal};
static float3 ${contextNames.cameraPosition};
`;
}
