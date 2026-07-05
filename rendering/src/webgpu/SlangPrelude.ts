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

export const SLANG_ENTRY_VERTEX = "vertexMain";
export const SLANG_ENTRY_FRAGMENT = "fragmentMain";

// Uniform buffer layout (WGSL std140 — every field is naturally aligned, so
// there is no interior padding). Offsets are bytes. iResolution/iMouse occupy a
// full vec4 each; iResolution only uses xyz. Total size is a multiple of 16, as
// required for the uniform address space.
export const SHADERTOY_UNIFORM_SIZE = 48;
export const UNIFORM_OFFSETS = {
  iResolution: 0, // float4 (xyz used)
  iMouse: 16, // float4
  iTime: 32, // float
  iTimeDelta: 36, // float
  iFrameRate: 40, // float
  iFrame: 44, // int
} as const;

// Struct fields are NOT named iResolution/iTime/… on purpose: those names are
// #define macros, and the Slang preprocessor would expand them inside the
// struct member accesses below (`_st.resolution`), corrupting the code.
const PRELUDE = `// ---- shader-studio Slang prelude (generated) ----
struct ShaderToyUniforms
{
    float4 resolution;
    float4 mouse;
    float time;
    float timeDelta;
    float frameRate;
    int frame;
};

[[vk::binding(0, 0)]]
ConstantBuffer<ShaderToyUniforms> _st;

#define iResolution (_st.resolution.xyz)
#define iMouse (_st.mouse)
#define iTime (_st.time)
#define iTimeDelta (_st.timeDelta)
#define iFrameRate (_st.frameRate)
#define iFrame (_st.frame)
`;

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
}

export interface SlangWrapOptions {
  passName?: string;
  commonCode?: string;
  channels?: SlangChannelBinding[];
}

function buildChannelPrelude(channels: SlangChannelBinding[] = []): string {
  return [...channels]
    .sort((a, b) => a.slot - b.slot)
    .map((channel, index) => {
      // Bindings are position-based over the slot-sorted array (not derived
      // from the slot number), so sparse slots pack densely from binding 1.
      // Bind-group creation must use the same position-over-sorted-array
      // scheme when attaching textures/samplers.
      const textureBinding = 1 + index * 2;
      const samplerBinding = textureBinding + 1;
      const helperName = `sampleIChannel${channel.slot}`;
      return `[[vk::binding(${textureBinding}, 0)]]
Texture2D<float4> ${channel.key};
[[vk::binding(${samplerBinding}, 0)]]
SamplerState ${channel.key}Sampler;
float4 ${helperName}(float2 uv)
{
    return ${channel.key}.Sample(${channel.key}Sampler, uv);
}
`;
    })
    .join("\n");
}

/** Wrap a user image-shader source into a full, compilable Slang module. */
export function wrapSlangImageSource(userSource: string, options: SlangWrapOptions = {}): string {
  const commonCode = options.commonCode?.trim() ? `${options.commonCode.trim()}\n` : "";
  const channelPrelude = buildChannelPrelude(options.channels);
  // `#line 1` renumbers the line that follows it, so it must sit directly
  // above the user source (after commonCode) to keep user diagnostics on the
  // user's real line numbers.
  return `${PRELUDE}\n${channelPrelude}\n${commonCode}#line 1\n${userSource}\n${ENTRY_POINTS}`;
}
