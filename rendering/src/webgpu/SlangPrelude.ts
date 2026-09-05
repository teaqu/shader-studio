// Slang ShaderToy authoring convention for the WebGPU pipeline.
//
// A user `.slang` image shader defines:
//
//     float4 mainImage(float2 fragCoord) { ... }
//
// and may read the globals `iResolution` (float3), `iTime`, `iTimeDelta`,
// `iFrameRate`, `iFrame`, `iMouse` (float4) — same semantics as ShaderToy.
//
// We wrap that source with a prelude (the uniform block + #define aliases) and
// two entry points (a fullscreen-triangle vertex shader and a fragment shader
// that calls mainImage). A `#line 1` directive sits just before the user code
// so Slang's diagnostics report the user's real line numbers.

import type { StorageBindingNode } from "../types/PassGraph";
import {
  buildSlangRuntimePrelude,
  buildSlangChannels,
  type GeometryType,
  type SlangCustomUniformInfo,
} from "@shader-studio/types";
import { isMeshGeometry, MESH_FRAGMENT_CONTEXT } from "../preview3d/MeshFragmentContext";

export const SLANG_ENTRY_VERTEX = "vertexMain";
export const SLANG_ENTRY_FRAGMENT = "fragmentMain";

const SHADER_STUDIO_EDITOR_IMPORT = /^(\s*)(?:__exported\s+)?import\s+(?:shader_studio|"shader-studio(?:\.slang)?")\s*;[^\r\n]*$/gm;

export function stripShaderStudioEditorImport(source: string): string {
  return source.replace(
    SHADER_STUDIO_EDITOR_IMPORT,
    "$1// Shader Studio editor support import",
  );
}

// Uniform-buffer layout is pass-specific. Scalar arrays in uniform buffers
// have a 16-byte stride; float3 arrays likewise occupy one 16-byte slot.
export interface ShaderToyUniformLayout {
  channelCount: number;
  size: number;
  offsets: {
    iResolution: number;
    iMouse: number;
    iTime: number;
    iTimeDelta: number;
    iFrameRate: number;
    iFrame: number;
    iChannelTime: number;
    iChannelLoaded: number;
    iSampleRate: number;
    iDate: number;
    iChannelResolution: number;
    iCameraPos: number;
    iCameraDir: number;
  };
}

export function getShaderToyChannelCount(channels: readonly { slot: number }[] = []): number {
  return Math.max(4, ...channels.map(({ slot }) => slot + 1));
}

export function createShaderToyUniformLayout(channelCount: number): ShaderToyUniformLayout {
  const count = Math.max(4, channelCount);
  const iChannelTime = 48;
  const iChannelLoaded = iChannelTime + count * 16;
  const iSampleRate = iChannelLoaded + count * 16;
  const iDate = iSampleRate + 16;
  const iChannelResolution = iDate + 16;
  const iCameraPos = iChannelResolution + count * 16;
  const iCameraDir = iCameraPos + 16;
  return {
    channelCount: count,
    size: iCameraDir + 16,
    offsets: { iResolution: 0, iMouse: 16, iTime: 32, iTimeDelta: 36, iFrameRate: 40, iFrame: 44, iChannelTime, iChannelLoaded, iSampleRate, iDate, iChannelResolution, iCameraPos, iCameraDir },
  };
}

/** Backward-compatible base layout for unconfigured passes. */
export const SHADERTOY_UNIFORM_SIZE = createShaderToyUniformLayout(4).size;
export const DISPATCH_UNIFORM_SIZE = 16;
export const UNIFORM_OFFSETS = createShaderToyUniformLayout(4).offsets satisfies ShaderToyUniformLayout["offsets"];

// Struct fields are NOT named iResolution/iTime/… on purpose: those names are
// #define macros, and the Slang preprocessor would expand them inside the
// struct member accesses below (`_st.resolution`), corrupting the code.
export { isSlangCustomUniformType } from "@shader-studio/types";
export type { SlangCustomUniformInfo, SlangCustomUniformType } from "@shader-studio/types";

function buildPrelude(channelCount: number, customUniforms: SlangCustomUniformInfo[] = []): string {
  return buildSlangRuntimePrelude(customUniforms, MESH_FRAGMENT_CONTEXT, channelCount);
}

function buildMeshPrelude(binding: number): string {
  return `struct MeshUniforms
{
    column_major float4x4 model;
    column_major float4x4 viewProjection;
    column_major float4x4 normalMatrix;
    float4 cameraPosition;
};

[[vk::binding(${binding}, 0)]]
ConstantBuffer<MeshUniforms> _mesh;
`;
}

function buildMeshEntryPoints(vertexCode: string): string {
  return `${vertexCode}
struct MeshVertexOut { float4 position : SV_Position; float2 uv : TEXCOORD0; float3 worldPosition : TEXCOORD1; float3 normal : TEXCOORD2; };
[shader("vertex")]
MeshVertexOut ${SLANG_ENTRY_VERTEX}([[vk::location(0)]] float3 position : POSITION, [[vk::location(1)]] float3 normal : NORMAL, [[vk::location(2)]] float2 uv : TEXCOORD0) { mainVertex(position, normal, uv); MeshVertexOut output; float4 worldPosition = mul(_mesh.model, float4(position, 1)); output.position = mul(_mesh.viewProjection, worldPosition); output.uv = uv; output.worldPosition = worldPosition.xyz; output.normal = mul(_mesh.normalMatrix, float4(normal, 0)).xyz; return output; }
[shader("fragment")]
float4 ${SLANG_ENTRY_FRAGMENT}(MeshVertexOut input) : SV_Target {
    ${MESH_FRAGMENT_CONTEXT.worldPosition} = input.worldPosition;
    ${MESH_FRAGMENT_CONTEXT.normal} = input.normal;
    ${MESH_FRAGMENT_CONTEXT.cameraPosition} = _mesh.cameraPosition.xyz;
    float4 color = mainImage(input.uv * _st.resolution.xy);
    return color;
}
`;
}

function buildFullscreenEntryPoints(vertexCode: string): string {
  if (!vertexCode.trim()) {
    return ENTRY_POINTS;
  }
  return `${vertexCode}
[shader("vertex")]
float4 ${SLANG_ENTRY_VERTEX}(uint vertexID : SV_VertexID) : SV_Position { float2 verts[3] = { float2(-1, -1), float2(3, -1), float2(-1, 3) }; float3 position = float3(verts[vertexID], 0); float3 normal = float3(0, 0, 1); float2 uv = verts[vertexID] * 0.5 + 0.5; mainVertex(position, normal, uv); return float4(position, 1); }
[shader("fragment")]
float4 ${SLANG_ENTRY_FRAGMENT}(float4 fragCoord : SV_Position) : SV_Target { return mainImage(float2(fragCoord.x, _st.resolution.y - fragCoord.y)); }
`;
}

const ENTRY_POINTS = `
// ---- shader-studio Slang entry points (generated) ----
[shader("vertex")]
float4 ${SLANG_ENTRY_VERTEX}(uint vertexID : SV_VertexID) : SV_Position
{
    float2 verts[3] = { float2(-1, -1), float2(3, -1), float2(-1, 3) };
    return float4(verts[vertexID], 0, 1);
}

[shader("fragment")]
float4 ${SLANG_ENTRY_FRAGMENT}(float4 fragCoord : SV_Position) : SV_Target
{
    // Flip Y so fragCoord origin is bottom-left, matching ShaderToy.
    float2 coord = float2(fragCoord.x, _st.resolution.y - fragCoord.y);
    return mainImage(coord);
}
`;

export interface SlangChannelBinding {
  slot: number;
  key: string;
  kind?: "texture" | "video" | "cubemap" | "audio" | "buffer" | "keyboard";
}

export interface SlangWrapOptions {
  passName?: string;
  commonCode?: string;
  channels?: SlangChannelBinding[];
  storage?: StorageBindingNode[];
  passKind?: "render" | "compute";
  geometry?: GeometryType;
  vertexCode?: string;
  customUniforms?: SlangCustomUniformInfo[];
  /**
   * Variable-capture mode: adds the capture uniform block (selector index,
   * capture coordinate, grid size) and swaps the fragment entry for one that
   * remaps fragCoord before calling mainImage — Slang parameters are
   * immutable, so the remap cannot be injected into the user body like GLSL.
   */
  captureMode?: boolean;
}

export interface SlangComputeWrapOptions {
  passName?: string;
  commonCode?: string;
  channels?: SlangChannelBinding[];
  storage?: StorageBindingNode[];
  workgroupSize: [number, number, number];
  outputLayers: number;
  hasOutput: boolean;
  customUniforms?: SlangCustomUniformInfo[];
  /** WGSL image format for compute output texture: "rgba16f" (default) or "rgba32f". */
  outputImageFormat?: "rgba16f" | "rgba32f";
}

// Capture uniform block layout (bytes): coordGrid float4 @0
// (xy = capture coord in ShaderToy fragCoord space, zw = grid size),
// varIndex int @16, isPixelMode int @20, padding to 32.
export const DBG_CAPTURE_UNIFORM_SIZE = 32;
export const DBG_CAPTURE_OFFSETS = {
  coordGrid: 0,
  varIndex: 16,
  isPixelMode: 20,
} as const;

function buildCapturePrelude(captureBinding: number): string {
  return `// ---- shader-studio Slang capture prelude (generated) ----
struct DbgCaptureUniforms
{
    float4 coordGrid;
    int varIndex;
    int isPixelMode;
    int2 _dbgPad;
};

[[vk::binding(${captureBinding}, 0)]]
ConstantBuffer<DbgCaptureUniforms> _dbgCapU;

#define _dbgVarIndex (_dbgCapU.varIndex)
`;
}

// The capture fragment entry renders either a 1×1 pixel probe (isPixelMode:
// mainImage gets the exact requested fragCoord) or an N×M grid whose texels
// spread over the full canvas. Texture row 0 maps to fragCoord.y≈0 (bottom of
// the canvas in ShaderToy space), so the readback buffer has the same
// bottom-to-top row order as WebGL's readPixels and decodes identically.
const CAPTURE_ENTRY_POINTS = `
// ---- shader-studio Slang capture entry points (generated) ----
[shader("vertex")]
float4 ${SLANG_ENTRY_VERTEX}(uint vertexID : SV_VertexID) : SV_Position
{
    float2 verts[3] = { float2(-1, -1), float2(3, -1), float2(-1, 3) };
    return float4(verts[vertexID], 0, 1);
}

[shader("fragment")]
float4 ${SLANG_ENTRY_FRAGMENT}(float4 fragCoord : SV_Position) : SV_Target
{
    float2 coord = _dbgCapU.isPixelMode != 0
        ? _dbgCapU.coordGrid.xy
        : fragCoord.xy / _dbgCapU.coordGrid.zw * _st.resolution.xy;
    return mainImage(coord);
}
`;

function buildChannelPrelude(channels: SlangChannelBinding[] = []): string {
  return buildSlangChannels(channels.map(({ key, slot, kind }) => ({
    name: key, slot, kind: kind === "cubemap" ? "texture-cube" : "texture-2d",
  })), { runtime: true });
}

/** Build storage declarations split around common code by their type dependency. */
export function buildStorageDeclarations(
  storage: StorageBindingNode[],
  channelCount: number,
  passKind: "render" | "compute",
): { beforeCommon: string; afterCommon: string } {
  const bufferType = passKind === "compute" ? "RWStructuredBuffer" : "StructuredBuffer";
  const renderElementType = (elementType: string): string => {
    if (passKind === "compute") {
      return elementType;
    }
    if (elementType === "Atomic<uint>") {
      return "uint";
    }
    if (elementType === "Atomic<int>") {
      return "int";
    }
    return elementType;
  };
  const declaration = (node: StorageBindingNode) => `[[vk::binding(${1 + channelCount * 2 + node.binding}, 0)]]
${bufferType}<${renderElementType(node.elementType)}> ${node.name};
`;

  return {
    beforeCommon: storage.filter((node) => node.builtin).map(declaration).join(""),
    afterCommon: storage.filter((node) => !node.builtin).map(declaration).join(""),
  };
}

/** Wrap a user image-shader source into a full, compilable Slang module. */
export function wrapSlangImageSource(userSource: string, options: SlangWrapOptions = {}): string {
  const prelude = buildPrelude(getShaderToyChannelCount(options.channels), options.customUniforms);
  const strippedCommonCode = stripShaderStudioEditorImport(options.commonCode ?? "").trim();
  const commonCode = strippedCommonCode ? `${strippedCommonCode}\n` : "";
  const strippedUserSource = stripShaderStudioEditorImport(userSource);
  const channelPrelude = buildChannelPrelude(options.channels);
  const storageDeclarations = buildStorageDeclarations(
    options.storage ?? [],
    options.channels?.length ?? 0,
    options.passKind ?? "render",
  );
  if (options.captureMode) {
    // Capture uniforms bind after the channel texture/sampler pairs and storage buffers.
    const captureBinding = 1 + (options.channels?.length ?? 0) * 2 + (options.storage?.length ?? 0);
    const capturePrelude = buildCapturePrelude(captureBinding);
    return `${prelude}\n${channelPrelude}\n${storageDeclarations.beforeCommon}${commonCode}${storageDeclarations.afterCommon}${capturePrelude}\n#line 1\n${strippedUserSource}\n${CAPTURE_ENTRY_POINTS}`;
  }
  // `#line 1` renumbers the line that follows it, so it must sit directly
  // above the user source (after commonCode and custom storage declarations)
  // to keep user diagnostics on the user's real line numbers.
  const vertexCode = options.vertexCode?.trim() ?? "";
  if (isMeshGeometry(options.geometry)) {
    const meshBinding = 1 + (options.channels?.length ?? 0) * 2 + (options.storage?.length ?? 0);
    return `${prelude}\n${channelPrelude}\n${storageDeclarations.beforeCommon}${commonCode}${storageDeclarations.afterCommon}${buildMeshPrelude(meshBinding)}#line 1\n${strippedUserSource}\n${buildMeshEntryPoints(vertexCode || "void mainVertex(inout float3 position, inout float3 normal, inout float2 uv) {}")}`;
  }
  return `${prelude}\n${channelPrelude}\n${storageDeclarations.beforeCommon}${commonCode}${storageDeclarations.afterCommon}#line 1\n${strippedUserSource}\n${buildFullscreenEntryPoints(vertexCode)}`;
}

function buildOutputPrelude(binding: number, outputLayers: number, imageFormat: "rgba16f" | "rgba32f" = "rgba16f"): string {
  if (outputLayers > 1) {
    return `// ---- shader-studio Slang compute output (generated) ----
[[vk::binding(${binding}, 0)]]
[[vk::image_format("${imageFormat}")]]
WTexture2DArray<float4> _outTex;

void writeOutput(uint2 coord, uint layer, float4 color)
{
    uint w;
    uint h;
    uint layers;
    _outTex.GetDimensions(w, h, layers);
    if (coord.x >= w || coord.y >= h || layer >= layers)
    {
        return;
    }
    _outTex.Store(uint3(coord.x, h - 1 - coord.y, layer), color);
}
`;
  }

  return `// ---- shader-studio Slang compute output (generated) ----
[[vk::binding(${binding}, 0)]]
[[vk::image_format("${imageFormat}")]]
WTexture2D<float4> _outTex;

void writeOutput(uint2 coord, float4 color)
{
    uint w;
    uint h;
    _outTex.GetDimensions(w, h);
    if (coord.x >= w || coord.y >= h)
    {
        return;
    }
    _outTex.Store(uint2(coord.x, h - 1 - coord.y), color);
}
`;
}

function buildDispatchPrelude(binding: number): string {
  return `struct DispatchUniforms
{
    int4 dispatch;
};

[[vk::binding(${binding}, 0)]]
ConstantBuffer<DispatchUniforms> _dsp;

#define iDispatch (_dsp.dispatch.x)
`;
}

/** Returns a shader-owned compute entrypoint annotated with stage and workgroup metadata. */
export function getNativeComputeEntryPoint(source: string): { name: string; workgroupSize: [number, number, number] } | null {
  return getNativeComputeEntryPoints(source)[0] ?? null;
}

export function getNativeComputeEntryPoints(source: string): Array<{ name: string; workgroupSize: [number, number, number] }> {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const entries: Array<{ name: string; workgroupSize: [number, number, number] }> = [];
  const pattern = /\[\s*shader\s*\(\s*["']compute["']\s*\)\s*\]\s*\[\s*numthreads\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)\s*\]\s*void\s+([A-Za-z_]\w*)\s*\(/gi;
  for (const match of withoutComments.matchAll(pattern)) {
    const values = match.slice(1, 4).map(Number);
    if (values.every((value) => Number.isInteger(value) && value > 0)) {
      entries.push({ name: match[4]!, workgroupSize: [values[0]!, values[1]!, values[2]!] });
    }
  }
  return entries;
}

export function getNativeComputeWorkgroupSize(source: string): [number, number, number] | null {
  return getNativeComputeEntryPoint(source)?.workgroupSize ?? null;
}

/** Wrap a user compute-shader source into a full, compilable Slang module. */
export function wrapSlangComputeSource(userSource: string, options: SlangComputeWrapOptions): string {
  const prelude = buildPrelude(getShaderToyChannelCount(options.channels), options.customUniforms);
  const channels = options.channels ?? [];
  const storage = options.storage ?? [];
  const strippedCommonCode = stripShaderStudioEditorImport(options.commonCode ?? "").trim();
  const commonCode = strippedCommonCode ? `${strippedCommonCode}\n` : "";
  const strippedUserSource = stripShaderStudioEditorImport(userSource);
  const channelPrelude = buildChannelPrelude(channels);
  const storageDeclarations = buildStorageDeclarations(storage, channels.length, "compute");
  const outputBinding = 1 + channels.length * 2 + storage.length;
  const outputPrelude = options.hasOutput
    ? buildOutputPrelude(outputBinding, options.outputLayers, options.outputImageFormat ?? "rgba16f")
    : "";
  const dispatchBinding = outputBinding + (options.hasOutput ? 1 : 0);
  const dispatchPrelude = buildDispatchPrelude(dispatchBinding);
  return `${prelude}\n${channelPrelude}\n${storageDeclarations.beforeCommon}${commonCode}${storageDeclarations.afterCommon}${outputPrelude}${dispatchPrelude}#line 1\n${strippedUserSource}`;
}
