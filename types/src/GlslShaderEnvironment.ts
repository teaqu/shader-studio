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
  const channelCount = Math.max(4, samplerTypes.length);
  return Array.from({ length: channelCount }, (_, slot) => [
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

/** Named structs retain the same uniform field layout as the numbered iCh API. */
export function buildGlslNamedChannelDeclarations(bindings: readonly GlslInputBinding[], fragmentStage = true): string {
  const named = bindings.filter(binding => binding.isCustomName && !/^iChannel\d+$/.test(binding.key));
  const definitions = [...new Set(named.map(binding => binding.samplerType))].map(sampler => {
    const shape = sampler.slice('sampler'.length);
    const type = `ShaderStudioChannel${shape}`;
    const coord = sampler === 'sampler2D' ? 'vec2' : 'vec3';
    const size = sampler === 'sampler3D' ? 'ivec3' : 'ivec2';
    return `struct ${type} { ${sampler} sampler; vec3 size; float time; int loaded; };
vec4 texture(${type} channel, ${coord} uv) { return texture(channel.sampler, uv); }
${fragmentStage ? `vec4 texture(${type} channel, ${coord} uv, float bias) { return texture(channel.sampler, uv, bias); }` : ''}
vec4 textureLod(${type} channel, ${coord} uv, float lod) { return textureLod(channel.sampler, uv, lod); }
vec4 textureGrad(${type} channel, ${coord} uv, ${coord} dx, ${coord} dy) { return textureGrad(channel.sampler, uv, dx, dy); }
${size} textureSize(${type} channel, int lod) { return textureSize(channel.sampler, lod); }
${sampler === 'samplerCube' ? '' : `vec4 texelFetch(${type} channel, ${size} coord, int lod) { return texelFetch(channel.sampler, coord, lod); }
${sampler === 'sampler2D' ? `vec4 load2D(${type} channel, ivec2 pixel) { return texelFetch(channel.sampler, pixel, 0); }` : ''}`}`;
  });
  const load2D = bindings.some(binding => binding.samplerType === 'sampler2D')
    ? 'vec4 load2D(sampler2D textureHandle, ivec2 pixel) { return texelFetch(textureHandle, pixel, 0); }'
    : '';
  return [load2D, ...definitions, ...named.map(binding => `uniform ShaderStudioChannel${binding.samplerType.slice('sampler'.length)} ${binding.key};`)].filter(Boolean).join('\n');
}
