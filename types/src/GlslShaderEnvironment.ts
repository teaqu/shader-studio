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
  "uniform float iChannelTime[4];",
  "uniform float iSampleRate;",
  "uniform vec3 iCameraPos;",
  "uniform vec3 iCameraDir;",
] as const);

export const GLSL_STABLE_NAMES: ReadonlySet<string> = new Set([
  "fragColor", "HW_PERFORMANCE", "iResolution", "iTime", "iTimeDelta",
  "iFrameRate", "iMouse", "iFrame", "iDate", "iChannelTime",
  "iSampleRate", "iCameraPos", "iCameraDir",
]);

export interface GlslInputLike {
  type: string;
}

export type GlslSamplerType = "sampler2D" | "samplerCube" | "sampler3D";

export interface GlslInputBinding {
  slot: number;
  key: string;
  isCustomName: boolean;
  samplerType: GlslSamplerType;
}

export function glslSamplerType(type: "2D" | "Cube" | "3D"): GlslSamplerType {
  return type === "Cube" ? "samplerCube" : type === "3D" ? "sampler3D" : "sampler2D";
}

export function buildGlslCompatibilityUniformDeclarationLines(
  samplerTypes: readonly GlslSamplerType[] = [],
): string[] {
  return Array.from({ length: 4 }, (_, slot) => [
    "uniform struct {",
    `  ${samplerTypes[slot] ?? "sampler2D"} sampler;`,
    "  vec3 size;",
    "  float time;",
    "  int loaded;",
    `} iCh${slot};`,
  ]).flat();
}

export function resolveGlslInputBindings(
  inputs: Readonly<Record<string, GlslInputLike>> = {},
): GlslInputBinding[] {
  return Object.keys(inputs).map((key, slot) => ({
    slot,
    key,
    isCustomName: key !== `iChannel${slot}`,
    samplerType: inputs[key]?.type === "cubemap" ? "samplerCube" : "sampler2D",
  }));
}
