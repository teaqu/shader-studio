import {
  SHADER_STUDIO_BUILTIN_UNIFORMS,
  SLANG_RUNTIME_FIXED_UNIFORM_FIELD_LINES,
  SLANG_RUNTIME_UNIFORM_ALIAS_LINES,
} from "./BuiltinUniforms";
import type { GeneratedAuthoringSource, ShaderAuthoringEnvironment } from "./ShaderAuthoringEnvironment";

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

export function isSlangCustomUniformType(type: string): type is SlangCustomUniformType {
  return type in SLANG_RUNTIME_VALUE_TYPES;
}

/** Builds a standalone Slang declaration module for authoring tools. */
export function buildSlangAuthoringModule(
  environment: ShaderAuthoringEnvironment,
): GeneratedAuthoringSource {
  const lines = [
    ...SHADER_STUDIO_BUILTIN_UNIFORMS.map((uniform) => `${uniform.slangType} ${uniform.name};`),
    ...environment.customUniforms.map((uniform) => `${SLANG_AUTHORING_VALUE_TYPES[uniform.type]} ${uniform.name};`),
    ...environment.resources.map((resource) => resource.kind === "storage"
      ? `StructuredBuffer<${resource.elementType ?? "float4"}> ${resource.name};`
      : `${SLANG_RESOURCE_TYPES[resource.kind]} ${resource.name};`),
  ];

  return {
    uri: environment.documentUri,
    text: lines.join("\n"),
    generatedLineCount: lines.length,
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
