import { getShaderSourceFunctions } from "./ShaderEntryPoints";
import { createNativeComputeSource, createNativeFragmentSource, createNativeRenderSource } from "./ShaderSourceTemplates";
import { createVertexHookSource } from "./VertexHookInsertion";
import type { ShaderLanguageId } from "./shader-environment/ShaderLanguages";

export interface ShaderInsertionOptions {
  fileType: string;
  authoringMode?: "hooks" | "native";
  passName?: string;
  geometryType?: string;
  vertexSpace?: string;
  outputCount?: number;
}
export interface ShaderInsertionResult {
  text: string;
  authoringMode: "hooks" | "native";
  entryPoints?: { vertex?: string; fragment?: string; compute?: string };
}

export function insertionLanguage(fileType: string): ShaderLanguageId {
  const match = /^(glsl|slang|wgsl)-(buffer|vertex|compute)$/.exec(fileType);
  if (!match) {
    throw new Error("Insert supports Buffer, Vertex, and Compute sources only.");
  }
  return match[1] as ShaderLanguageId;
}

/** Both hosts use identical templates and duplicate detection. */
export function createShaderInsertion(source: string, options: ShaderInsertionOptions): ShaderInsertionResult {
  const language = insertionLanguage(options.fileType);
  const native = options.authoringMode === "native";
  const vertex = options.fileType.endsWith("-vertex");
  if (native && language === "glsl") {
    throw new Error("Native insertion is supported for WGSL and Slang only.");
  }
  if (native && language !== "glsl") {
    if (options.fileType.endsWith("-compute")) {
      return { ...createNativeComputeSource(language, source, options.passName ?? "Compute"), authoringMode: "native" };
    }
    const generated = createNativeRenderSource(language, source, options.passName ?? "Buffer", options.outputCount);
    if (!vertex) {
      return { ...createNativeFragmentSource(language, source, options.passName ?? 'Buffer', options.outputCount), authoringMode: "native" };
    }
    return { text: nativeVertexSource(language, generated.entryPoints.vertex, options),
      authoringMode: "native", entryPoints: { vertex: generated.entryPoints.vertex } };
  }
  if (vertex) {
    return { text: createVertexHookSource(language, source, options.geometryType === "vertices"), authoringMode: "hooks" };
  }
  const functions = getShaderSourceFunctions(source, language === "glsl" ? "slang" : language);
  if (options.fileType.endsWith("-compute")) {
    if (language === "glsl") {
      throw new Error("Compute insertion is supported for WGSL and Slang only.");
    }
    const existing = functions.find(fn => fn.stage === "compute");
    if (existing) {
      return { text: "", authoringMode: "hooks", entryPoints: { compute: existing.name } };
    }
    const text = language === "wgsl"
      ? "\n\n@compute @workgroup_size(8, 8, 1)\nfn compute(@builtin(global_invocation_id) id: vec3u) {\n}\n"
      : '\n\n[shader("compute")]\n[numthreads(8, 8, 1)]\nvoid compute(uint3 id : SV_DispatchThreadID) {\n}\n';
    return { text, authoringMode: "hooks", entryPoints: { compute: "compute" } };
  }
  if (functions.some(fn => fn.name === "mainImage")) {
    return { text: "", authoringMode: "hooks" };
  }
  const text = language === "wgsl"
    ? "fn mainImage(coord: vec2f) -> vec4f {\n    return vec4f(coord / iResolution.xy, 0.5, 1.0);\n}\n"
    : language === "slang" ? "float4 mainImage(float2 coord) {\n    return float4(coord / iResolution.xy, 0.5, 1.0);\n}\n"
      : "void mainImage(out vec4 color, vec2 coord) {\n    color = vec4(coord / iResolution.xy, 0.5, 1.0);\n}\n";
  return { text: `\n\n${text}`, authoringMode: "hooks" };
}

function nativeVertexSource(language: "slang" | "wgsl", name: string, options: ShaderInsertionOptions): string {
  const mesh = options.geometryType && !["vertices", "fullscreen"].includes(options.geometryType);
  if (mesh) {
    const output = `${name}Output`;
    return language === "wgsl"
      ? `\n\nstruct ${output} { @builtin(position) position: vec4f, @location(0) uv: vec2f, @location(1) worldPosition: vec3f, @location(2) normal: vec3f, }\n@vertex fn ${name}(@location(0) position: vec3f, @location(1) normal: vec3f, @location(2) uv: vec2f) -> ${output} {\n    return ${output}(iViewProjectionMatrix * vec4f(position, 1.0), uv, position, normal);\n}\n`
      : `\n\nstruct ${output} { float4 position : SV_Position; float2 uv : TEXCOORD0; float3 worldPosition : TEXCOORD1; float3 normal : TEXCOORD2; };\n[shader("vertex")]\n${output} ${name}([[vk::location(0)]] float3 position : POSITION, [[vk::location(1)]] float3 normal : NORMAL, [[vk::location(2)]] float2 uv : TEXCOORD0) {\n    ${output} result; result.position = mul(iViewProjectionMatrix, float4(position, 1.0)); result.uv = uv; result.worldPosition = position; result.normal = normal; return result;\n}\n`;
  }
  const vertices = options.geometryType === "vertices";
  const corners = vertices ? [[-0.7, -0.6], [0.7, -0.6], [0, 0.7]] : [[-1, -1], [3, -1], [-1, 3]];
  const transform = vertices && options.vertexSpace !== "clip";
  if (language === "wgsl") {
    const points = corners.map(([x, y]) => `vec2f(${x}, ${y})`).join(", ");
    return `\n\n@vertex fn ${name}(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {\n    let points = array<vec2f, 3>(${points});\n    let position = vec4f(points[index % 3u], 0.0, 1.0);\n    return ${transform ? "iViewProjection * position" : "position"};\n}\n`;
  }
  const points = corners.map(([x, y]) => `float2(${x}, ${y})`).join(", ");
  return `\n\n[shader("vertex")]\nfloat4 ${name}(uint index : SV_VertexID) : SV_Position {\n    float2 points[3] = { ${points} };\n    float4 position = float4(points[index % 3], 0.0, 1.0);\n    return ${transform ? "mul(iViewProjection, position)" : "position"};\n}\n`;
}
