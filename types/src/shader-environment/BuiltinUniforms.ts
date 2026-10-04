import type { ShaderLanguageId } from "./ShaderLanguages";

export type ShaderStudioBuiltinStage = "fragment" | "vertex" | "compute" | "geometry" | "tess-control" | "tess-evaluation";

export interface ShaderStudioBuiltinUniform {
  readonly name: string;
  readonly glslType?: string;
  readonly slangType: string;
  /** WGSL spelling; required for every entry whose `languages` includes "wgsl". */
  readonly wgslType?: string;
  /** Concrete declaration emitted into standalone GLSL authoring modules. */
  readonly glslDeclaration?: string;
  /** Concrete declaration emitted into standalone Slang authoring modules. */
  readonly slangDeclaration?: string;
  readonly languages: readonly ShaderLanguageId[];
  /** Stages that expose this symbol; omitted means every authoring stage. */
  readonly stages?: readonly ShaderStudioBuiltinStage[];
  readonly description: string;
}

export interface ShaderStudioFragmentContextSymbol extends ShaderStudioBuiltinUniform {
  readonly name: "iWorldPosition" | "iNormal" | "iCameraPosition" | "iVertexUv" | "iFrontFacing";
  readonly glslType: "vec2" | "vec3" | "bool";
  readonly slangType: "float2" | "float3" | "bool";
  readonly wgslType: "vec2f" | "vec3f" | "bool";
  readonly glslDeclaration: string;
  readonly slangDeclaration: string;
  readonly languages: readonly ["glsl", "slang", "wgsl"];
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
  "uniform int iVertexCount;",
  "uniform int iInstanceCount;",
  "uniform mat4 iViewMatrix;",
  "uniform mat4 iProjectionMatrix;",
  "uniform mat4 iViewProjection;",
] as const);

export const GLSL_STABLE_NAMES: ReadonlySet<string> = new Set([
  "fragColor", "HW_PERFORMANCE", "iResolution", "iTime", "iTimeDelta",
  "iFrameRate", "iMouse", "iFrame", "iDate", "iChannelTime",
  "iSampleRate", "iCameraPos", "iCameraDir", "iVertexCount", "iInstanceCount",
  "iViewMatrix", "iProjectionMatrix", "iViewProjection",
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
    wgslType: "vec3f",
    glslDeclaration: "vec3 iWorldPosition;",
    slangDeclaration: "float3 iWorldPosition;",
    languages: ["glsl", "slang", "wgsl"],
    stages: ["fragment"],
    description: "World-space position of the current fragment; zero for fullscreen geometry.",
  },
  {
    name: "iNormal",
    glslType: "vec3",
    slangType: "float3",
    wgslType: "vec3f",
    glslDeclaration: "vec3 iNormal;",
    slangDeclaration: "float3 iNormal;",
    languages: ["glsl", "slang", "wgsl"],
    stages: ["fragment"],
    description: "World-space interpolated normal of the current fragment; zero for fullscreen geometry.",
  },
  {
    name: "iCameraPosition",
    glslType: "vec3",
    slangType: "float3",
    wgslType: "vec3f",
    glslDeclaration: "vec3 iCameraPosition;",
    slangDeclaration: "float3 iCameraPosition;",
    languages: ["glsl", "slang", "wgsl"],
    stages: ["fragment"],
    description: "World-space camera position for mesh fragments; zero for fullscreen geometry.",
  },
  {
    name: "iVertexUv",
    glslType: "vec2",
    slangType: "float2",
    wgslType: "vec2f",
    glslDeclaration: "vec2 iVertexUv;",
    slangDeclaration: "float2 iVertexUv;",
    languages: ["glsl", "slang", "wgsl"],
    stages: ["fragment"],
    description: "Perspective-correct interpolated UV written by mainVertex for the current fragment.",
  },
  {
    name: "iFrontFacing",
    glslType: "bool",
    slangType: "bool",
    wgslType: "bool",
    glslDeclaration: "bool iFrontFacing;",
    // A macro avoids colliding with the supported custom uniform named `bool`
    // in standalone authoring modules. Runtime wrappers declare a mutable bool.
    slangDeclaration: "#define iFrontFacing true",
    languages: ["glsl", "slang", "wgsl"],
    stages: ["fragment"],
    description: "Whether the current primitive is front-facing; always true for fullscreen geometry.",
  },
] as const satisfies readonly ShaderStudioFragmentContextSymbol[]);

/** Semantic renderer keys backed by the same facts used for authoring and docs. */
export const SHADER_STUDIO_FRAGMENT_CONTEXT = Object.freeze({
  worldPosition: SHADER_STUDIO_FRAGMENT_CONTEXT_SYMBOLS[0]!,
  normal: SHADER_STUDIO_FRAGMENT_CONTEXT_SYMBOLS[1]!,
  cameraPosition: SHADER_STUDIO_FRAGMENT_CONTEXT_SYMBOLS[2]!,
  vertexUv: SHADER_STUDIO_FRAGMENT_CONTEXT_SYMBOLS[3]!,
  frontFacing: SHADER_STUDIO_FRAGMENT_CONTEXT_SYMBOLS[4]!,
});

export const SHADER_STUDIO_BUILTIN_UNIFORMS: readonly Readonly<ShaderStudioBuiltinUniform>[] = deepFreezeBuiltinCatalog([
  { name: "iResolution", glslType: "vec3", slangType: "float3", wgslType: "vec3f", slangDeclaration: "float3 iResolution;", languages: ["glsl", "slang", "wgsl"], description: "Canvas dimensions: xy is width and height, z is the aspect ratio." },
  { name: "iTime", glslType: "float", slangType: "float", wgslType: "f32", slangDeclaration: "float iTime;", languages: ["glsl", "slang", "wgsl"], description: "Elapsed time in seconds." },
  { name: "iTimeDelta", glslType: "float", slangType: "float", wgslType: "f32", slangDeclaration: "float iTimeDelta;", languages: ["glsl", "slang", "wgsl"], description: "Time since the previous frame in seconds." },
  { name: "iFrameRate", glslType: "float", slangType: "float", wgslType: "f32", slangDeclaration: "float iFrameRate;", languages: ["glsl", "slang", "wgsl"], description: "Current frames per second." },
  { name: "iMouse", glslType: "vec4", slangType: "float4", wgslType: "vec4f", slangDeclaration: "float4 iMouse;", languages: ["glsl", "slang", "wgsl"], description: "Mouse position in xy and click position in zw." },
  { name: "iFrame", glslType: "int", slangType: "int", wgslType: "i32", slangDeclaration: "int iFrame;", languages: ["glsl", "slang", "wgsl"], description: "Frame counter starting at zero." },
  { name: "iDate", glslType: "vec4", slangType: "float4", wgslType: "vec4f", slangDeclaration: "float4 iDate;", languages: ["glsl", "slang", "wgsl"], description: "Year, month, day, and seconds since midnight." },
  { name: "iChannelTime", glslType: "float[1024]", slangType: "float[1024]", languages: ["glsl"], description: "Playback time for each configured input channel." },
  { name: "iChannelResolution", glslType: "vec3[1024]", slangType: "float3[1024]", languages: ["glsl"], description: "Resolution of each configured input channel." },
  { name: "iSampleRate", glslType: "float", slangType: "float", wgslType: "f32", slangDeclaration: "float iSampleRate;", languages: ["glsl", "slang", "wgsl"], description: "Audio sample rate in hertz." },
  { name: "iCameraPos", glslType: "vec3", slangType: "float3", wgslType: "vec3f", slangDeclaration: "float3 iCameraPos;", languages: ["glsl", "slang", "wgsl"], description: "Camera position in world space." },
  { name: "iCameraDir", glslType: "vec3", slangType: "float3", wgslType: "vec3f", slangDeclaration: "float3 iCameraDir;", languages: ["glsl", "slang", "wgsl"], description: "Normalised camera look direction." },
  { name: "iVertexCount", glslType: "int", slangType: "uint", wgslType: "u32", slangDeclaration: "uint32_t iVertexCount;", languages: ["glsl", "slang", "wgsl"], stages: ["fragment", "vertex"], description: "Vertices drawn by this pass: the configured vertexCount for vertices geometry (default 3), 3 for fullscreen, or the mesh vertex count for plane, cube, sphere, and model geometry. vertexIndex ranges from 0 to iVertexCount - 1." },
  { name: "iInstanceCount", glslType: "int", slangType: "uint", wgslType: "u32", slangDeclaration: "uint32_t iInstanceCount;", languages: ["glsl", "slang", "wgsl"], stages: ["fragment", "vertex"], description: "Instances drawn by this pass: the configured instanceCount (default 1), or 1 for fullscreen geometry. iInstanceIndex ranges from 0 to iInstanceCount - 1." },
  { name: "iViewMatrix", glslType: "mat4", slangType: "float4x4", wgslType: "mat4x4f", slangDeclaration: "float4x4 iViewMatrix;", languages: ["glsl", "slang", "wgsl"], stages: ["fragment", "vertex"], description: "The orbit camera's view matrix: world space to view space, the camera looking down -z. The model matrix is the identity, so world space is the space mainVertex writes for meshes and world-space vertices." },
  { name: "iProjectionMatrix", glslType: "mat4", slangType: "float4x4", wgslType: "mat4x4f", slangDeclaration: "float4x4 iProjectionMatrix;", languages: ["glsl", "slang", "wgsl"], stages: ["fragment", "vertex"], description: "The orbit camera's perspective projection for this pass's aspect ratio: 45° vertical field of view, near 0.01, far 100. Clip-space depth follows the renderer: -1 to 1 in WebGL (GLSL), 0 to 1 in WebGPU (Slang, WGSL)." },
  { name: "iViewProjection", glslType: "mat4", slangType: "float4x4", wgslType: "mat4x4f", slangDeclaration: "float4x4 iViewProjection;", languages: ["glsl", "slang", "wgsl"], stages: ["fragment", "vertex"], description: "iProjectionMatrix * iViewMatrix: takes a world-space point to clip space exactly as meshes and world-space vertices are drawn. Divide by w to get the clip-space position a clip-space vertex writes." },
  { name: "iInstanceIndex", glslType: "int", slangType: "uint", wgslType: "u32", glslDeclaration: "int iInstanceIndex;", slangDeclaration: "uint32_t iInstanceIndex;", languages: ["glsl", "slang", "wgsl"], stages: ["fragment", "vertex"], description: "Zero-based index of the instance being drawn; always 0 for fullscreen geometry. Fragments receive the value of the instance that produced their primitive." },
  { name: "iDispatch", slangType: "int", wgslType: "i32", slangDeclaration: "int iDispatch;", languages: ["slang", "wgsl"], stages: ["compute"], description: "Zero-based repetition index for the current compute pass dispatch." },
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

function collectBuiltinUniformNames(language: ShaderLanguageId): readonly string[] {
  return Object.freeze(
    SHADER_STUDIO_BUILTIN_UNIFORMS
      .filter((uniform) => (
        uniform.languages.includes(language)
        && !SHADER_STUDIO_DOCUMENTATION_ONLY_BUILTIN_NAMES.has(uniform.name)
      ))
      .map((uniform) => uniform.name),
  );
}

const BUILTIN_UNIFORM_NAMES_BY_LANGUAGE: Record<ShaderLanguageId, readonly string[]> = {
  glsl: collectBuiltinUniformNames("glsl"),
  slang: collectBuiltinUniformNames("slang"),
  wgsl: collectBuiltinUniformNames("wgsl"),
};

/** Every renderer-declared uniform an editor should colour for the language. */
export function shaderStudioBuiltinUniformNames(
  language: ShaderLanguageId,
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
  `#define iVertexCount (${SLANG_RUNTIME_UNIFORM_BUFFER_NAME}.vertexCount.x)`,
  `#define iInstanceCount (${SLANG_RUNTIME_UNIFORM_BUFFER_NAME}.vertexCount.y)`,
  `#define iViewMatrix (${SLANG_RUNTIME_UNIFORM_BUFFER_NAME}.viewMatrix)`,
  `#define iProjectionMatrix (${SLANG_RUNTIME_UNIFORM_BUFFER_NAME}.projectionMatrix)`,
  `#define iViewProjection (${SLANG_RUNTIME_UNIFORM_BUFFER_NAME}.viewProjection)`,
] as const);
