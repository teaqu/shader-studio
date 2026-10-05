import { getShaderSourceFunctions } from "./ShaderEntryPoints";
import type { ShaderLanguageId } from "./shader-environment/ShaderLanguages";

/** Reuse an authored hook; comments mentioning it do not count as definitions. */
export function createVertexHookSource(language: ShaderLanguageId, source: string, vertices = false): string {
  // GLSL hook declarations use the same C-style function syntax as Slang.
  if (getShaderSourceFunctions(source, language === "glsl" ? "slang" : language).some(fn => fn.name === "mainVertex")) {
    return "";
  }
  const body = vertices ? language === "wgsl"
    ? "    let corners = array<vec2f, 3>(vec2f(-0.7, -0.6), vec2f(0.7, -0.6), vec2f(0.0, 0.7));\n    *position = vec3f(corners[vertexIndex % 3u], 0.0);\n    *uv = (*position).xy * 0.5 + 0.5;\n"
    : language === "slang"
      ? "    float2 corners[3] = { float2(-0.7, -0.6), float2(0.7, -0.6), float2(0.0, 0.7) };\n    position = float3(corners[vertexIndex % 3], 0.0);\n    uv = position.xy * 0.5 + 0.5;\n"
      : "    vec2 corners[3] = vec2[3](vec2(-0.7, -0.6), vec2(0.7, -0.6), vec2(0.0, 0.7));\n    position = vec3(corners[vertexIndex % 3], 0.0);\n    uv = position.xy * 0.5 + 0.5;\n"
    : "";
  const signature = language === "wgsl"
    ? "fn mainVertex(vertexIndex: u32, position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>)"
    : language === "slang"
      ? "void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv)"
      : "void mainVertex(int vertexIndex, inout vec3 position, inout vec3 normal, inout vec2 uv)";
  return `\n\n${signature} {\n${body}}\n`;
}
