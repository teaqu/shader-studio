import {
  SHADER_STUDIO_BUILTIN_UNIFORMS,
  SHADER_STUDIO_FRAGMENT_CONTEXT,
  SLANG_RUNTIME_UNIFORM_ALIAS_LINES,
  SLANG_RUNTIME_UNIFORM_BUFFER_NAME,
} from "./BuiltinUniforms";
import {
  deriveSlangChannelGeneratedIdentifiers,
  isAuthoringValueType,
  isValidShaderIdentifier,
  resolveAuthoringChannelBindings,
  type AuthoringValueType,
  type AuthoringChannelBinding,
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

const SLANG_RESOURCE_TYPES = {
  "texture-2d": "Texture2D<float4>",
  "texture-cube": "TextureCube<float4>",
  "texture-3d": "Texture3D<float4>",
} as const;

function buildSlangChannelMetadata(
  channelBindings: readonly AuthoringChannelBinding[],
  stage: ShaderAuthoringEnvironment["stage"],
): string[] {
  const channels = channelBindings.filter(({ resource }) => resource.kind !== "texture-3d");
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
  for (const binding of channels) {
    const { resource, slot } = binding;
    const type = resource.kind === "texture-cube" ? "Cube" : "2D";
    const identifiers = deriveSlangChannelGeneratedIdentifiers(binding);
    lines.push(
      `ShaderToyChannel${type} ${identifiers.metadataAccessor!}()
{
    ShaderToyChannel${type} channel;
    channel.sampler.texture = ${resource.name};
    channel.sampler.state = ${identifiers.sampler};
    channel.size = iChannelResolution[${slot}];
    channel.time = iChannelTime[${slot}];
    channel.loaded = iChannelLoaded[${slot}] != 0.0 ? 1 : 0;
    return channel;
}`,
      `#define ${identifiers.metadataAlias!} (${identifiers.metadataAccessor!}())`,
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
      const { sampler } = deriveSlangChannelGeneratedIdentifiers({ resource, slot });
      return [`${type} ${resource.name};`, `SamplerState ${sampler};`];
    }
    const isCube = resource.kind === "texture-cube";
    const argument = isCube ? "float3 dir" : "float2 uv";
    const sampledArgument = isCube ? "dir" : "float2(uv.x, 1.0 - uv.y)";
    const identifiers = deriveSlangChannelGeneratedIdentifiers({ resource, slot });
    const helperName = identifiers.slotHelper!;
    const vertexHelperName = identifiers.slotVertexHelper!;
    const customHelperName = identifiers.aliasHelper;
    const customVertexHelperName = identifiers.aliasVertexHelper;
    return [
      `${type} ${resource.name};`,
      `SamplerState ${identifiers.sampler};`,
      `float4 ${helperName}(${argument})\n{\n    return ${resource.name}.${sampleMethod}(${identifiers.sampler}, ${sampledArgument}${explicitLod});\n}`,
      `float4 ${vertexHelperName}(${argument})\n{\n    return ${resource.name}.SampleLevel(${identifiers.sampler}, ${sampledArgument}, 0.0);\n}`,
      ...(customHelperName && customVertexHelperName ? [
        `float4 ${customHelperName}(${argument})\n{\n    return ${helperName}(${isCube ? "dir" : "uv"});\n}`,
        `float4 ${customVertexHelperName}(${argument})\n{\n    return ${vertexHelperName}(${isCube ? "dir" : "uv"});\n}`,
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
      && !/^iChannel\d+$/.test(resource.name)
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
  const channelLines = buildSlangChannelDeclarations(channelBindings, environment.stage);
  const computeOutputLines = environment.stage !== "compute"
    ? []
    : environment.outputLayers && environment.outputLayers > 1
      ? ["void writeOutput(uint2 coord, uint layer, float4 color)\n{\n}"]
      : ["void writeOutput(uint2 coord, float4 color)\n{\n}"];
  const channelCount = Math.max(4, ...channelBindings.map(({ slot }) => slot + 1));
  const lines = [
    ...SHADER_STUDIO_BUILTIN_UNIFORMS
      .flatMap((uniform) => {
        const declaration = uniform.name === "iChannelTime" ? `float iChannelTime[${channelCount}];`
          : uniform.name === "iChannelLoaded" ? `float iChannelLoaded[${channelCount}];`
            : uniform.name === "iChannelResolution" ? `float3 iChannelResolution[${channelCount}];`
              : uniform.slangDeclaration;
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
    ...channelLines,
    ...buildSlangChannelMetadata(channelBindings, environment.stage),
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
