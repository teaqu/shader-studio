import { tokenizeShaderSource } from "./ShaderEntryPoints";

export interface NativeRenderTemplate {
  text: string;
  entryPoints: { vertex: string; fragment: string };
}

export interface NativeComputeTemplate {
  text: string;
  entryPoints: { compute: string };
}

function sourceIdentifiers(source: string): Set<string> {
  return new Set(tokenizeShaderSource(source)
    .filter((token) => token.kind === "identifier")
    .map((token) => token.text));
}

function nameStem(passName: string, fallback: string): string {
  return (passName.replace(/[^A-Za-z0-9_]/g, "") || fallback).replace(/^\d/, "_$&");
}

export function createNativeRenderSource(language: "wgsl" | "slang", source: string, passName: string): NativeRenderTemplate {
  const identifiers = sourceIdentifiers(source);
  const stem = nameStem(passName, "Pass");
  let suffix = "";
  let index = 2;
  while (identifiers.has(`${stem}Vertex${suffix}`) || identifiers.has(`${stem}Fragment${suffix}`)) {
    suffix = String(index++);
  }
  const entryPoints = { vertex: `${stem}Vertex${suffix}`, fragment: `${stem}Fragment${suffix}` };
  if (language === "slang") {
    return { entryPoints, text: `\n[shader("vertex")]\nfloat4 ${entryPoints.vertex}(uint vertexId : SV_VertexID) : SV_Position {\n    float2 positions[3] = { float2(-1.0, -1.0), float2(3.0, -1.0), float2(-1.0, 3.0) };\n    return float4(positions[vertexId], 0.0, 1.0);\n}\n\n[shader("fragment")]\nfloat4 ${entryPoints.fragment}(float4 fragCoord : SV_Position) : SV_Target0 {\n    return float4(frac(fragCoord.xy * 0.01), 0.0, 1.0);\n}\n` };
  }
  return { entryPoints, text: `\n@vertex\nfn ${entryPoints.vertex}(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {\n    var positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));\n    return vec4f(positions[vertexIndex], 0.0, 1.0);\n}\n\n@fragment\nfn ${entryPoints.fragment}(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {\n    return vec4f(fract(fragCoord.xy * 0.01), 0.0, 1.0);\n}\n` };
}

export function createNativeComputeSource(language: "wgsl" | "slang", source: string, passName: string): NativeComputeTemplate {
  const identifiers = sourceIdentifiers(source);
  const stem = nameStem(passName, "Compute");
  let compute = `${stem}Compute`;
  let index = 2;
  while (identifiers.has(compute)) {
    compute = `${stem}Compute${index++}`;
  }
  return language === "slang"
    ? { entryPoints: { compute }, text: `\n[shader("compute")]\n[numthreads(8, 8, 1)]\nvoid ${compute}(uint3 dispatchThreadID : SV_DispatchThreadID) {\n}\n` }
    : { entryPoints: { compute }, text: `\n@compute @workgroup_size(8, 8, 1)\nfn ${compute}(@builtin(global_invocation_id) dispatchThreadID: vec3u) {\n}\n` };
}
