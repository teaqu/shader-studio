export type ShaderStudioBuiltinStage = "fragment" | "vertex" | "compute" | "geometry" | "tess-control" | "tess-evaluation";

export interface ShaderStudioBuiltinUniform {
  readonly name: string;
  readonly glslType?: string;
  readonly slangType: string;
  /** Concrete declaration emitted into standalone GLSL authoring modules. */
  readonly glslDeclaration?: string;
  /** Concrete declaration emitted into standalone Slang authoring modules. */
  readonly slangDeclaration?: string;
  readonly languages: readonly ("glsl" | "slang")[];
  /** Stages that expose this symbol; omitted means every authoring stage. */
  readonly stages?: readonly ShaderStudioBuiltinStage[];
  readonly description: string;
}

export interface ShaderStudioFragmentContextSymbol extends ShaderStudioBuiltinUniform {
  readonly name: "iWorldPosition" | "iNormal" | "iCameraPosition";
  readonly glslType: "vec3";
  readonly slangType: "float3";
  readonly glslDeclaration: string;
  readonly slangDeclaration: string;
  readonly languages: readonly ["glsl", "slang"];
  readonly stages: readonly ["fragment"];
}

function deepFreezeBuiltin<T extends ShaderStudioBuiltinUniform>(builtin: T): Readonly<T> {
  return Object.freeze({
    ...builtin,
    languages: Object.freeze([...builtin.languages]),
    ...(builtin.stages ? { stages: Object.freeze([...builtin.stages]) } : {}),
  });
}

function deepFreezeBuiltinCatalog<T extends ShaderStudioBuiltinUniform>(
  builtins: readonly T[],
): readonly Readonly<T>[] {
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
  "uniform float iChannelTime[1024];",
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
  "uniform vec3 iChannelResolution[1024];",
] as const);

export const SHADER_STUDIO_FRAGMENT_CONTEXT_SYMBOLS: readonly Readonly<ShaderStudioFragmentContextSymbol>[] = deepFreezeBuiltinCatalog([
  {
    name: "iWorldPosition",
    glslType: "vec3",
    slangType: "float3",
    glslDeclaration: "vec3 iWorldPosition;",
    slangDeclaration: "float3 iWorldPosition;",
    languages: ["glsl", "slang"],
    stages: ["fragment"],
    description: "World-space position of the current fragment; zero for fullscreen geometry.",
  },
  {
    name: "iNormal",
    glslType: "vec3",
    slangType: "float3",
    glslDeclaration: "vec3 iNormal;",
    slangDeclaration: "float3 iNormal;",
    languages: ["glsl", "slang"],
    stages: ["fragment"],
    description: "World-space interpolated normal of the current fragment; zero for fullscreen geometry.",
  },
  {
    name: "iCameraPosition",
    glslType: "vec3",
    slangType: "float3",
    glslDeclaration: "vec3 iCameraPosition;",
    slangDeclaration: "float3 iCameraPosition;",
    languages: ["glsl", "slang"],
    stages: ["fragment"],
    description: "World-space camera position for mesh fragments; zero for fullscreen geometry.",
  },
] as const satisfies readonly ShaderStudioFragmentContextSymbol[]);

/** Semantic renderer keys backed by the same facts used for authoring and docs. */
export const SHADER_STUDIO_FRAGMENT_CONTEXT = Object.freeze({
  worldPosition: SHADER_STUDIO_FRAGMENT_CONTEXT_SYMBOLS[0]!,
  normal: SHADER_STUDIO_FRAGMENT_CONTEXT_SYMBOLS[1]!,
  cameraPosition: SHADER_STUDIO_FRAGMENT_CONTEXT_SYMBOLS[2]!,
});

export const SHADER_STUDIO_BUILTIN_UNIFORMS: readonly Readonly<ShaderStudioBuiltinUniform>[] = deepFreezeBuiltinCatalog([
  { name: "iResolution", glslType: "vec3", slangType: "float3", slangDeclaration: "float3 iResolution;", languages: ["glsl", "slang"], description: "Canvas dimensions: xy is width and height, z is the aspect ratio." },
  { name: "iTime", glslType: "float", slangType: "float", slangDeclaration: "float iTime;", languages: ["glsl", "slang"], description: "Elapsed time in seconds." },
  { name: "iTimeDelta", glslType: "float", slangType: "float", slangDeclaration: "float iTimeDelta;", languages: ["glsl", "slang"], description: "Time since the previous frame in seconds." },
  { name: "iFrameRate", glslType: "float", slangType: "float", slangDeclaration: "float iFrameRate;", languages: ["glsl", "slang"], description: "Current frames per second." },
  { name: "iMouse", glslType: "vec4", slangType: "float4", slangDeclaration: "float4 iMouse;", languages: ["glsl", "slang"], description: "Mouse position in xy and click position in zw." },
  { name: "iFrame", glslType: "int", slangType: "int", slangDeclaration: "int iFrame;", languages: ["glsl", "slang"], description: "Frame counter starting at zero." },
  { name: "iDate", glslType: "vec4", slangType: "float4", slangDeclaration: "float4 iDate;", languages: ["glsl", "slang"], description: "Year, month, day, and seconds since midnight." },
  { name: "iChannelTime", glslType: "float[1024]", slangType: "float[1024]", languages: ["glsl"], description: "Playback time for each configured input channel." },
  { name: "iChannelResolution", glslType: "vec3[1024]", slangType: "float3[1024]", languages: ["glsl"], description: "Resolution of each configured input channel." },
  { name: "iSampleRate", glslType: "float", slangType: "float", slangDeclaration: "float iSampleRate;", languages: ["glsl", "slang"], description: "Audio sample rate in hertz." },
  { name: "iCameraPos", glslType: "vec3", slangType: "float3", slangDeclaration: "float3 iCameraPos;", languages: ["glsl", "slang"], description: "Camera position in world space." },
  { name: "iCameraDir", glslType: "vec3", slangType: "float3", slangDeclaration: "float3 iCameraDir;", languages: ["glsl", "slang"], description: "Normalised camera look direction." },
  { name: "iDispatch", slangType: "int", slangDeclaration: "int iDispatch;", languages: ["slang"], stages: ["compute"], description: "Zero-based repetition index for the current compute pass dispatch." },
  { name: "iChannelN", glslType: "sampler2D | samplerCube | sampler3D", slangType: "Texture2D<float4> | TextureCube<float4>", languages: ["glsl"], description: "Any renderer-assigned input channel. Slots follow configured input order and are not inferred from resource names." },
  { name: "iChannel0", glslType: "sampler2D | samplerCube | sampler3D", slangType: "Texture2D<float4> | TextureCube<float4>", languages: ["glsl"], description: "First input channel; its texture shape follows the configured resource." },
  { name: "iChannel1", glslType: "sampler2D | samplerCube | sampler3D", slangType: "Texture2D<float4> | TextureCube<float4>", languages: ["glsl"], description: "Second input channel; its texture shape follows the configured resource." },
  { name: "iChannel2", glslType: "sampler2D | samplerCube | sampler3D", slangType: "Texture2D<float4> | TextureCube<float4>", languages: ["glsl"], description: "Third input channel; its texture shape follows the configured resource." },
  { name: "iChannel3", glslType: "sampler2D | samplerCube | sampler3D", slangType: "Texture2D<float4> | TextureCube<float4>", languages: ["glsl"], description: "Fourth input channel; its texture shape follows the configured resource." },
  { name: "iCh0", glslType: "ShaderToy channel metadata struct", slangType: "ShaderToyChannel2D | ShaderToyChannelCube", languages: ["glsl"], description: "First input channel with sampler, size, playback time, and loaded state metadata." },
  { name: "iCh1", glslType: "ShaderToy channel metadata struct", slangType: "ShaderToyChannel2D | ShaderToyChannelCube", languages: ["glsl"], description: "Second input channel with sampler, size, playback time, and loaded state metadata." },
  { name: "iCh2", glslType: "ShaderToy channel metadata struct", slangType: "ShaderToyChannel2D | ShaderToyChannelCube", languages: ["glsl"], description: "Third input channel with sampler, size, playback time, and loaded state metadata." },
  { name: "iCh3", glslType: "ShaderToy channel metadata struct", slangType: "ShaderToyChannel2D | ShaderToyChannelCube", languages: ["glsl"], description: "Fourth input channel with sampler, size, playback time, and loaded state metadata." },
  ...SHADER_STUDIO_FRAGMENT_CONTEXT_SYMBOLS,
] as const satisfies readonly ShaderStudioBuiltinUniform[]);

/** Catalog entries that document a family of symbols instead of naming a real one. */
export const SHADER_STUDIO_DOCUMENTATION_ONLY_BUILTIN_NAMES: ReadonlySet<string> = new Set(["iChannelN"]);

/**
 * Channel aliases are declared per configured slot rather than from a fixed list,
 * so editors match the index instead of enumerating names.
 */
export const SHADER_STUDIO_INDEXED_CHANNEL_PATTERN_SOURCE = "iChannel\\d+";

/** Legacy ShaderToy channel-metadata accessors are generated per configured slot. */
export const SHADER_STUDIO_INDEXED_CHANNEL_METADATA_PATTERN_SOURCE = "iCh\\d+";

function collectBuiltinUniformNames(language: "glsl" | "slang"): readonly string[] {
  return Object.freeze(
    SHADER_STUDIO_BUILTIN_UNIFORMS
      .filter((uniform) => (
        uniform.languages.includes(language)
        && !SHADER_STUDIO_DOCUMENTATION_ONLY_BUILTIN_NAMES.has(uniform.name)
      ))
      .map((uniform) => uniform.name),
  );
}

const BUILTIN_UNIFORM_NAMES_BY_LANGUAGE = {
  glsl: collectBuiltinUniformNames("glsl"),
  slang: collectBuiltinUniformNames("slang"),
} as const;

/** Every renderer-declared uniform an editor should colour for the language. */
export function shaderStudioBuiltinUniformNames(
  language: "glsl" | "slang",
): readonly string[] {
  return BUILTIN_UNIFORM_NAMES_BY_LANGUAGE[language];
}

export const SLANG_RUNTIME_UNIFORM_BUFFER_NAME = "_st";
export const SLANG_RUNTIME_INTERNAL_NAMES = Object.freeze([
  SLANG_RUNTIME_UNIFORM_BUFFER_NAME,
] as const);

export const SLANG_RUNTIME_UNIFORM_ALIAS_LINES = Object.freeze([
  `#define iResolution (${SLANG_RUNTIME_UNIFORM_BUFFER_NAME}.resolution.xyz)`,
  `#define iMouse (${SLANG_RUNTIME_UNIFORM_BUFFER_NAME}.mouse)`,
  `#define iTime (${SLANG_RUNTIME_UNIFORM_BUFFER_NAME}.time)`,
  `#define iTimeDelta (${SLANG_RUNTIME_UNIFORM_BUFFER_NAME}.timeDelta)`,
  `#define iFrameRate (${SLANG_RUNTIME_UNIFORM_BUFFER_NAME}.frameRate)`,
  `#define iFrame (${SLANG_RUNTIME_UNIFORM_BUFFER_NAME}.frame)`,
  `#define iSampleRate (${SLANG_RUNTIME_UNIFORM_BUFFER_NAME}.sampleRate)`,
  `#define iDate (${SLANG_RUNTIME_UNIFORM_BUFFER_NAME}.date)`,
  `#define iCameraPos (${SLANG_RUNTIME_UNIFORM_BUFFER_NAME}.cameraPos.xyz)`,
  `#define iCameraDir (${SLANG_RUNTIME_UNIFORM_BUFFER_NAME}.cameraDir.xyz)`,
] as const);
