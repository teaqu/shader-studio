import { getShaderSourceFunctions, tokenizeShaderSource } from "./ShaderEntryPoints";

export interface NativeRenderTemplate {
  text: string;
  entryPoints: { vertex: string; fragment: string };
}

export interface NativeComputeTemplate {
  text: string;
  entryPoints: { compute: string };
}

/** Leave vertex generation to the viewer unless the user explicitly inserts that stage. */
export function createNativeFragmentSource(language: 'wgsl' | 'slang', source: string, passName: string, outputCount = 1) {
  const generated = createNativeRenderSource(language, source, passName, outputCount);
  const entryPoints = { fragment: generated.entryPoints.fragment };
  if (outputCount <= 1) {
    const body = animatedFragmentBody(language);
    const text = language === 'wgsl'
      ? `\n@fragment\nfn ${entryPoints.fragment}(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {\n${body}\n}\n`
      : `\n[shader("fragment")]\nfloat4 ${entryPoints.fragment}(float4 fragCoord : SV_Position) : SV_Target0 {\n${body}\n}\n`;
    return { text, entryPoints };
  }
  const vertex = getShaderSourceFunctions(generated.text, language).find(fn => fn.stage === 'vertex')!;
  return { text: generated.text.slice(0, vertex.start) + generated.text.slice(vertex.end),
    entryPoints };
}

function animatedFragmentBody(language: 'wgsl' | 'slang'): string {
  const wgsl = language === 'wgsl';
  return `    ${wgsl ? 'let' : 'float2'} coord = fragCoord.xy;

    // Normalized pixel coordinates (from 0 to 1)
    ${wgsl ? 'let' : 'float2'} uv = coord / iResolution.xy;

    // Time varying pixel color
    ${wgsl ? 'let' : 'float3'} col = 0.5 + 0.5 * cos(iTime + uv.xyx + ${wgsl ? 'vec3f' : 'float3'}(0.0, 2.0, 4.0));

    // Output to screen
    return ${wgsl ? 'vec4f' : 'float4'}(col, 1.0);`;
}

function sourceIdentifiers(source: string): Set<string> {
  return new Set(tokenizeShaderSource(source)
    .filter((token) => token.kind === "identifier")
    .map((token) => token.text));
}

function nameStem(passName: string, fallback: string): string {
  return (passName.replace(/[^A-Za-z0-9_]/g, "") || fallback).replace(/^\d/, "_$&");
}

export function createNativeRenderSource(language: "wgsl" | "slang", source: string, passName: string, outputCount = 1): NativeRenderTemplate {
  const identifiers = sourceIdentifiers(source);
  const stem = nameStem(passName, "Pass");
  let suffix = "";
  let index = 2;
  while (identifiers.has(`${stem}Vertex${suffix}`) || identifiers.has(`${stem}Fragment${suffix}`)) {
    suffix = String(index++);
  }
  const entryPoints = { vertex: `${stem}Vertex${suffix}`, fragment: `${stem}Fragment${suffix}` };
  const attachments = Math.max(1, Math.min(8, Math.floor(outputCount)));
  if (language === "slang") {
    if (attachments > 1) {
      const result = `${entryPoints.fragment}Outputs`;
      const fields = Array.from({ length: attachments }, (_, index) => `    float4 output${index} : SV_Target${index};`).join("\n");
      const assignments = Array.from({ length: attachments }, (_, index) => `    result.output${index} = float4(frac(fragCoord.xy * 0.01), ${index}.0 / ${attachments - 1}.0, 1.0);`).join("\n");
      return { entryPoints, text: `\n[shader("vertex")]\nfloat4 ${entryPoints.vertex}(uint vertexId : SV_VertexID) : SV_Position {\n    float2 positions[3] = { float2(-1.0, -1.0), float2(3.0, -1.0), float2(-1.0, 3.0) };\n    return float4(positions[vertexId], 0.0, 1.0);\n}\n\nstruct ${result} {\n${fields}\n};\n\n[shader("fragment")]\n${result} ${entryPoints.fragment}(float4 fragCoord : SV_Position) {\n    ${result} result;\n${assignments}\n    return result;\n}\n` };
    }
    return { entryPoints, text: `\n[shader("vertex")]\nfloat4 ${entryPoints.vertex}(uint vertexId : SV_VertexID) : SV_Position {\n    float2 positions[3] = { float2(-1.0, -1.0), float2(3.0, -1.0), float2(-1.0, 3.0) };\n    return float4(positions[vertexId], 0.0, 1.0);\n}\n\n[shader("fragment")]\nfloat4 ${entryPoints.fragment}(float4 fragCoord : SV_Position) : SV_Target0 {\n    return float4(frac(fragCoord.xy * 0.01), 0.0, 1.0);\n}\n` };
  }
  if (attachments > 1) {
    const result = `${entryPoints.fragment}Outputs`;
    const fields = Array.from({ length: attachments }, (_, index) => `    @location(${index}) output${index}: vec4f,`).join("\n");
    const values = Array.from({ length: attachments }, (_, index) => `vec4f(fract(fragCoord.xy * 0.01), ${index}.0 / ${attachments - 1}.0, 1.0)`).join(", ");
    return { entryPoints, text: `\n@vertex\nfn ${entryPoints.vertex}(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {\n    var positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));\n    return vec4f(positions[vertexIndex], 0.0, 1.0);\n}\n\nstruct ${result} {\n${fields}\n}\n\n@fragment\nfn ${entryPoints.fragment}(@builtin(position) fragCoord: vec4f) -> ${result} {\n    return ${result}(${values});\n}\n` };
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
