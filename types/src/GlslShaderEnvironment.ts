export { GLSL_STABLE_DECLARATION_LINES, GLSL_STABLE_NAMES } from "./shader-environment/BuiltinUniforms";

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
