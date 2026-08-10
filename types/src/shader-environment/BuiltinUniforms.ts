export interface ShaderStudioBuiltinUniform {
  readonly name: string;
  readonly glslType?: string;
  readonly slangType: string;
  readonly languages: readonly ("glsl" | "slang")[];
  readonly description: string;
}

function deepFreezeBuiltin<T extends ShaderStudioBuiltinUniform>(builtin: T): Readonly<T> {
  return Object.freeze({ ...builtin, languages: Object.freeze([...builtin.languages]) });
}

function deepFreezeBuiltinCatalog(
  builtins: readonly ShaderStudioBuiltinUniform[],
): readonly Readonly<ShaderStudioBuiltinUniform>[] {
  return Object.freeze(builtins.map(deepFreezeBuiltin));
}

export const GLSL_STABLE_DECLARATION_LINES = Object.freeze([
  "precision highp float;",
  "out vec4 fragColor;",
  "#define HW_PERFORMANCE 1",
  "uniform vec3 iResolution;",
  "uniform float iTime;",
  "uniform float iTimeDelta;",
  "uniform float iFrameRate;",
  "uniform vec4 iMouse;",
  "uniform int iFrame;",
  "uniform vec4 iDate;",
  "uniform float iChannelTime[16];",
  "uniform float iSampleRate;",
  "uniform vec3 iCameraPos;",
  "uniform vec3 iCameraDir;",
] as const);

export const GLSL_STABLE_NAMES: ReadonlySet<string> = new Set([
  "fragColor", "HW_PERFORMANCE", "iResolution", "iTime", "iTimeDelta",
  "iFrameRate", "iMouse", "iFrame", "iDate", "iChannelTime",
  "iSampleRate", "iCameraPos", "iCameraDir",
]);

/** Renderer-compatible baseline channel declarations for editor analysis. */
export const GLSL_DEFAULT_CHANNEL_DECLARATION_LINES = Object.freeze([
  "uniform sampler2D iChannel0;",
  "uniform sampler2D iChannel1;",
  "uniform sampler2D iChannel2;",
  "uniform sampler2D iChannel3;",
  "uniform vec3 iChannelResolution[16];",
] as const);

export const SHADER_STUDIO_BUILTIN_UNIFORMS = deepFreezeBuiltinCatalog([
  { name: "iResolution", glslType: "vec3", slangType: "float3", languages: ["glsl", "slang"], description: "Canvas dimensions: xy is width and height, z is the aspect ratio." },
  { name: "iTime", glslType: "float", slangType: "float", languages: ["glsl", "slang"], description: "Elapsed time in seconds." },
  { name: "iTimeDelta", glslType: "float", slangType: "float", languages: ["glsl", "slang"], description: "Time since the previous frame in seconds." },
  { name: "iFrameRate", glslType: "float", slangType: "float", languages: ["glsl", "slang"], description: "Current frames per second." },
  { name: "iMouse", glslType: "vec4", slangType: "float4", languages: ["glsl", "slang"], description: "Mouse position in xy and click position in zw." },
  { name: "iFrame", glslType: "int", slangType: "int", languages: ["glsl", "slang"], description: "Frame counter starting at zero." },
  { name: "iDate", glslType: "vec4", slangType: "float4", languages: ["glsl", "slang"], description: "Year, month, day, and seconds since midnight." },
  { name: "iChannelTime", glslType: "float[16]", slangType: "float[16]", languages: ["glsl", "slang"], description: "Playback time for each input channel." },
  { name: "iChannelLoaded", slangType: "float[16]", languages: ["slang"], description: "Loaded state for each input channel in Slang." },
  { name: "iChannelResolution", glslType: "vec3[16]", slangType: "float3[16]", languages: ["glsl", "slang"], description: "Resolution of each input channel." },
  { name: "iSampleRate", glslType: "float", slangType: "float", languages: ["glsl", "slang"], description: "Audio sample rate in hertz." },
  { name: "iCameraPos", glslType: "vec3", slangType: "float3", languages: ["glsl", "slang"], description: "Camera position in world space." },
  { name: "iCameraDir", glslType: "vec3", slangType: "float3", languages: ["glsl", "slang"], description: "Normalised camera look direction." },
  { name: "iChannelN", glslType: "sampler2D | samplerCube | sampler3D", slangType: "sampleIChannelN(float2 | float3) helper", languages: ["glsl", "slang"], description: "Any renderer-assigned input channel; GLSL exposes the sampler, while Slang exposes the matching sampling helper. Slots follow configured input order and are not inferred from resource names." },
  { name: "iChannel0", glslType: "sampler2D | samplerCube | sampler3D", slangType: "Texture2D<float4> | TextureCube<float4>", languages: ["glsl", "slang"], description: "First input channel; its texture shape follows the configured resource." },
  { name: "iChannel1", glslType: "sampler2D | samplerCube | sampler3D", slangType: "Texture2D<float4> | TextureCube<float4>", languages: ["glsl", "slang"], description: "Second input channel; its texture shape follows the configured resource." },
  { name: "iChannel2", glslType: "sampler2D | samplerCube | sampler3D", slangType: "Texture2D<float4> | TextureCube<float4>", languages: ["glsl", "slang"], description: "Third input channel; its texture shape follows the configured resource." },
  { name: "iChannel3", glslType: "sampler2D | samplerCube | sampler3D", slangType: "Texture2D<float4> | TextureCube<float4>", languages: ["glsl", "slang"], description: "Fourth input channel; its texture shape follows the configured resource." },
  { name: "iCh0", glslType: "ShaderToy channel metadata struct", slangType: "ShaderToyChannel2D | ShaderToyChannelCube", languages: ["glsl", "slang"], description: "First input channel with sampler, size, playback time, and loaded state metadata." },
  { name: "iCh1", glslType: "ShaderToy channel metadata struct", slangType: "ShaderToyChannel2D | ShaderToyChannelCube", languages: ["glsl", "slang"], description: "Second input channel with sampler, size, playback time, and loaded state metadata." },
  { name: "iCh2", glslType: "ShaderToy channel metadata struct", slangType: "ShaderToyChannel2D | ShaderToyChannelCube", languages: ["glsl", "slang"], description: "Third input channel with sampler, size, playback time, and loaded state metadata." },
  { name: "iCh3", glslType: "ShaderToy channel metadata struct", slangType: "ShaderToyChannel2D | ShaderToyChannelCube", languages: ["glsl", "slang"], description: "Fourth input channel with sampler, size, playback time, and loaded state metadata." },
] as const satisfies readonly ShaderStudioBuiltinUniform[]);

export const SLANG_RUNTIME_FIXED_UNIFORM_FIELD_LINES = Object.freeze([
  "    float4 resolution;",
  "    float4 mouse;",
  "    float time;",
  "    float timeDelta;",
  "    float frameRate;",
  "    int frame;",
  "    float channelTime[16];",
  "    float channelLoaded[16];",
  "    float sampleRate;",
  "    float4 date;",
  "    float3 channelResolution[16];",
  "    float4 cameraPos;",
  "    float4 cameraDir;",
] as const);

export const SLANG_RUNTIME_UNIFORM_ALIAS_LINES = Object.freeze([
  "#define iResolution (_st.resolution.xyz)",
  "#define iMouse (_st.mouse)",
  "#define iTime (_st.time)",
  "#define iTimeDelta (_st.timeDelta)",
  "#define iFrameRate (_st.frameRate)",
  "#define iFrame (_st.frame)",
  "#define iChannelTime (_st.channelTime)",
  "#define iChannelLoaded (_st.channelLoaded)",
  "#define iSampleRate (_st.sampleRate)",
  "#define iDate (_st.date)",
  "#define iChannelResolution (_st.channelResolution)",
  "#define iCameraPos (_st.cameraPos.xyz)",
  "#define iCameraDir (_st.cameraDir.xyz)",
] as const);
