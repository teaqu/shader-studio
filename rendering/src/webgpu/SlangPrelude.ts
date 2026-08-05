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

export const SLANG_ENTRY_VERTEX = "vertexMain";
export const SLANG_ENTRY_FRAGMENT = "fragmentMain";
export const SLANG_ENTRY_COMPUTE = "computeMainEntry";

// Fixed uniform-buffer prefix. Offsets are bytes. iResolution/iMouse occupy a
// full vec4 each; iResolution only uses xyz. Script fields are appended after
// this prefix, and the total allocation is rounded to a multiple of 16.
export const SHADERTOY_UNIFORM_SIZE = 208;
export const DISPATCH_UNIFORM_SIZE = 16;
export const UNIFORM_OFFSETS = {
  iResolution: 0, // float4 (xyz used)
  iMouse: 16, // float4
  iTime: 32, // float
  iTimeDelta: 36, // float
  iFrameRate: 40, // float
  iFrame: 44, // int
  iChannelTime: 48, // float4
  iChannelLoaded: 64, // float4
  iSampleRate: 80, // float
  iDate: 96, // float4
  iChannelResolution: 112, // float4[4] (xyz used)
  iCameraPos: 176, // float4 (xyz used)
  iCameraDir: 192, // float4 (xyz used)
} as const;

// Struct fields are NOT named iResolution/iTime/… on purpose: those names are
// #define macros, and the Slang preprocessor would expand them inside the
// struct member accesses below (`_st.resolution`), corrupting the code.
export type SlangCustomUniformType = "float" | "vec2" | "vec3" | "vec4" | "bool";

export interface SlangCustomUniformInfo {
  name: string;
  type: string;
}

const CUSTOM_SLANG_TYPES: Record<SlangCustomUniformType, string> = {
  float: "float",
  vec2: "float2",
  vec3: "float3",
  vec4: "float4",
  bool: "int",
};

export function isSlangCustomUniformType(type: string): type is SlangCustomUniformType {
  return type in CUSTOM_SLANG_TYPES;
}

function buildPrelude(customUniforms: SlangCustomUniformInfo[] = []): string {
  const supported = customUniforms.filter(({ type }) => isSlangCustomUniformType(type));
  const fields = supported
    .map(({ name, type }) => `    ${CUSTOM_SLANG_TYPES[type as SlangCustomUniformType]} custom_${name};`)
    .join("\n");
  const aliases = supported
    .map(({ name, type }) => type === "bool"
      ? `#define ${name} (_st.custom_${name} != 0)`
      : `#define ${name} (_st.custom_${name})`)
    .join("\n");

  return `// ---- shader-studio Slang prelude (generated) ----
struct ShaderToyUniforms
{
    float4 resolution;
    float4 mouse;
    float time;
    float timeDelta;
    float frameRate;
    int frame;
    float4 channelTime;
    float4 channelLoaded;
    float sampleRate;
    float4 date;
    float3 channelResolution[4];
    float4 cameraPos;
    float4 cameraDir;
${fields}
};

[[vk::binding(0, 0)]]
ConstantBuffer<ShaderToyUniforms> _st;

#define iResolution (_st.resolution.xyz)
#define iMouse (_st.mouse)
#define iTime (_st.time)
#define iTimeDelta (_st.timeDelta)
#define iFrameRate (_st.frameRate)
#define iFrame (_st.frame)
#define iChannelTime (_st.channelTime)
#define iChannelLoaded (_st.channelLoaded)
#define iSampleRate (_st.sampleRate)
#define iDate (_st.date)
#define iChannelResolution (_st.channelResolution)
#define iCameraPos (_st.cameraPos.xyz)
#define iCameraDir (_st.cameraDir.xyz)
${aliases}
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

function buildChannelPrelude(
  channels: SlangChannelBinding[] = [],
  stage: "fragment" | "compute" = "fragment",
): string {
  const sortedChannels = [...channels].sort((a, b) => a.slot - b.slot);
  const objectChannels = sortedChannels.filter(({ slot }) => slot < 4);
  const has2DObject = objectChannels.some(({ kind }) => kind !== "cubemap");
  const hasCubeObject = objectChannels.some(({ kind }) => kind === "cubemap");
  const objectSampleMethod = stage === "compute" ? "SampleLevel" : "Sample";
  const objectExplicitLod = stage === "compute" ? ", 0.0" : "";
  const objectTypes = `${has2DObject ? `struct ShaderToySampler2D
{
    Texture2D<float4> texture;
    SamplerState state;

    float4 Sample(float2 uv)
    {
        return texture.${objectSampleMethod}(state, float2(uv.x, 1.0 - uv.y)${objectExplicitLod});
    }
};

struct ShaderToyChannel2D
{
    ShaderToySampler2D sampler;
    float3 size;
    float time;
    int loaded;
};
` : ""}${hasCubeObject ? `struct ShaderToySamplerCube
{
    TextureCube<float4> texture;
    SamplerState state;

    float4 Sample(float3 dir)
    {
        return texture.${objectSampleMethod}(state, dir${objectExplicitLod});
    }
};

struct ShaderToyChannelCube
{
    ShaderToySamplerCube sampler;
    float3 size;
    float time;
    int loaded;
};
` : ""}`;

  const bindings = sortedChannels
    .map((channel, index) => {
      // Bindings are position-based over the slot-sorted array (not derived
      // from the slot number), so sparse slots pack densely from binding 1.
      // Bind-group creation must use the same position-over-sorted-array
      // scheme when attaching textures/samplers.
      const textureBinding = 1 + index * 2;
      const samplerBinding = textureBinding + 1;
      const helperName = `sampleIChannel${channel.slot}`;
      const sampleMethod = stage === "compute" ? "SampleLevel" : "Sample";
      const explicitLod = stage === "compute" ? ", 0.0" : "";
      const customHelperName = channel.key === `iChannel${channel.slot}`
        ? null
        : `sample${channel.key[0].toUpperCase()}${channel.key.slice(1)}`;
      const objectAccessor = channel.slot < 4
        ? `
ShaderToyChannel${channel.kind === "cubemap" ? "Cube" : "2D"} _getICh${channel.slot}()
{
    ShaderToyChannel${channel.kind === "cubemap" ? "Cube" : "2D"} channel;
    channel.sampler.texture = ${channel.key};
    channel.sampler.state = ${channel.key}Sampler;
    channel.size = _st.channelResolution[${channel.slot}];
    channel.time = _st.channelTime[${channel.slot}];
    channel.loaded = _st.channelLoaded[${channel.slot}] != 0.0 ? 1 : 0;
    return channel;
}
#define iCh${channel.slot} (_getICh${channel.slot}())
`
        : "";
      if (channel.kind === "cubemap") {
        return `[[vk::binding(${textureBinding}, 0)]]
TextureCube<float4> ${channel.key};
[[vk::binding(${samplerBinding}, 0)]]
SamplerState ${channel.key}Sampler;
float4 ${helperName}(float3 dir)
{
    return ${channel.key}.${sampleMethod}(${channel.key}Sampler, dir${explicitLod});
}
${customHelperName ? `float4 ${customHelperName}(float3 dir)
{
    return ${helperName}(dir);
}
` : ""}${objectAccessor}
`;
      }
      return `[[vk::binding(${textureBinding}, 0)]]
Texture2D<float4> ${channel.key};
[[vk::binding(${samplerBinding}, 0)]]
SamplerState ${channel.key}Sampler;
float4 ${helperName}(float2 uv)
{
    // uv comes from the Y-flipped fragCoord (bottom-left origin, GL-style),
    // but WebGPU textures put v=0 at the top row, so flip v back to sample
    // the texel the caller expects.
    return ${channel.key}.${sampleMethod}(${channel.key}Sampler, float2(uv.x, 1.0 - uv.y)${explicitLod});
}
${customHelperName ? `float4 ${customHelperName}(float2 uv)
{
    return ${helperName}(uv);
}
` : ""}${objectAccessor}
`;
    })
    .join("\n");

  const claimedStandardHelpers = new Set(sortedChannels.map(({ slot }) => slot));
  for (const { key } of sortedChannels) {
    const match = /^iChannel([0-3])$/.exec(key);
    if (match) {
      claimedStandardHelpers.add(Number.parseInt(match[1], 10));
    }
  }
  const fallbackHelpers = [0, 1, 2, 3]
    .filter((slot) => !claimedStandardHelpers.has(slot))
    .map((slot) => `float4 sampleIChannel${slot}(float2 uv)
{
    return float4(0.0, 0.0, 0.0, 1.0);
}
`)
    .join("\n");

  return objectTypes + bindings + fallbackHelpers;
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
  const prelude = buildPrelude(options.customUniforms);
  const commonCode = options.commonCode?.trim() ? `${options.commonCode.trim()}\n` : "";
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
    return `${prelude}\n${channelPrelude}\n${storageDeclarations.beforeCommon}${commonCode}${storageDeclarations.afterCommon}${capturePrelude}\n#line 1\n${userSource}\n${CAPTURE_ENTRY_POINTS}`;
  }
  // `#line 1` renumbers the line that follows it, so it must sit directly
  // above the user source (after commonCode and custom storage declarations)
  // to keep user diagnostics on the user's real line numbers.
  return `${prelude}\n${channelPrelude}\n${storageDeclarations.beforeCommon}${commonCode}${storageDeclarations.afterCommon}#line 1\n${userSource}\n${ENTRY_POINTS}`;
}

function buildOutputPrelude(binding: number, outputLayers: number): string {
  if (outputLayers > 1) {
    return `// ---- shader-studio Slang compute output (generated) ----
[[vk::binding(${binding}, 0)]]
[[vk::image_format("rgba16f")]]
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
[[vk::image_format("rgba16f")]]
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

function buildComputeEntryPoint(workgroupSize: [number, number, number]): string {
  const [x, y, z] = workgroupSize;
  return `[shader("compute")]
[numthreads(${x}, ${y}, ${z})]
void ${SLANG_ENTRY_COMPUTE}(uint3 tid : SV_DispatchThreadID)
{
    computeMain(tid);
}
`;
}

/** Wrap a user compute-shader source into a full, compilable Slang module. */
export function wrapSlangComputeSource(userSource: string, options: SlangComputeWrapOptions): string {
  const prelude = buildPrelude(options.customUniforms);
  const channels = options.channels ?? [];
  const storage = options.storage ?? [];
  const commonCode = options.commonCode?.trim() ? `${options.commonCode.trim()}\n` : "";
  const channelPrelude = buildChannelPrelude(channels, "compute");
  const storageDeclarations = buildStorageDeclarations(storage, channels.length, "compute");
  const outputBinding = 1 + channels.length * 2 + storage.length;
  const outputPrelude = options.hasOutput
    ? buildOutputPrelude(outputBinding, options.outputLayers)
    : "";
  const dispatchBinding = outputBinding + (options.hasOutput ? 1 : 0);
  const dispatchPrelude = buildDispatchPrelude(dispatchBinding);
  const entryPoint = buildComputeEntryPoint(options.workgroupSize);

  return `${prelude}\n${channelPrelude}\n${storageDeclarations.beforeCommon}${commonCode}${storageDeclarations.afterCommon}${outputPrelude}${dispatchPrelude}#line 1\n${userSource}\n${entryPoint}`;
}
