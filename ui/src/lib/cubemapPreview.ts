import type { BufferPass, ConfigInput, ShaderConfig, ShaderLanguageId } from '@shader-studio/types';

export type CubemapPreviewMode = 'face' | 'layout' | 'environment';
export type CubemapFace = 'positive-x' | 'negative-x' | 'positive-y' | 'negative-y' | 'positive-z' | 'negative-z';

export interface CubemapPreviewRequest { config: ShaderConfig | null; passName: string; language: ShaderLanguageId; mode: CubemapPreviewMode; face: CubemapFace; }
export interface CubemapPreview { code: string; config: ShaderConfig; }

/** Creates a temporary Image pass that displays one generated cubemap buffer. */
export function createCubemapPreview(request: CubemapPreviewRequest): CubemapPreview | null {
  const source = request.config?.passes?.[request.passName];
  if (!request.config || !source || !isCubemapPass(source)) {
    return null;
  }
  const image = request.config.passes.Image;
  const input: ConfigInput = { type: 'buffer', source: request.passName, filter: 'linear', wrap: 'clamp' };
  const previewImage = { ...(image?.resolution ? { resolution: image.resolution } : {}), inputs: { iChannel0: input } };
  return { code: previewSource(request.language, request.mode, request.face), config: { ...request.config, passes: { ...request.config.passes, Image: previewImage } } };
}

function isCubemapPass(pass: unknown): pass is BufferPass {
  return typeof pass === 'object' && pass !== null && 'outputKind' in pass && (pass as BufferPass).outputKind === 'cubemap';
}

function previewSource(language: ShaderLanguageId, mode: CubemapPreviewMode, face: CubemapFace): string {
  if (language === 'glsl') {
    return glslSource(mode, face);
  }
  if (language === 'slang') {
    return slangSource(mode, face);
  }
  return wgslSource(mode, face);
}

function glslSource(mode: CubemapPreviewMode, face: CubemapFace): string {
  const sample = mode === 'face' ? `texture(iChannel0, faceDirection(uv, ${faceIndex(face)}))` : mode === 'layout' ? 'layoutSample(uv)' : 'texture(iChannel0, environmentDirection(uv))';
  return `vec3 faceDirection(vec2 uv, int face) { vec2 p = 2.0 * uv - 1.0; if (face == 0) return normalize(vec3(1.0, -p.y, -p.x)); if (face == 1) return normalize(vec3(-1.0, -p.y, p.x)); if (face == 2) return normalize(vec3(p.x, 1.0, p.y)); if (face == 3) return normalize(vec3(p.x, -1.0, -p.y)); if (face == 4) return normalize(vec3(p.x, -p.y, 1.0)); return normalize(vec3(-p.x, -p.y, -1.0)); }
vec4 layoutSample(vec2 uv) { vec2 tile = floor(uv * vec2(4.0, 3.0)); vec2 local = fract(uv * vec2(4.0, 3.0)); if (tile == vec2(2.0, 1.0)) return texture(iChannel0, faceDirection(local, 0)); if (tile == vec2(0.0, 1.0)) return texture(iChannel0, faceDirection(local, 1)); if (tile == vec2(1.0, 2.0)) return texture(iChannel0, faceDirection(local, 2)); if (tile == vec2(1.0, 0.0)) return texture(iChannel0, faceDirection(local, 3)); if (tile == vec2(1.0, 1.0)) return texture(iChannel0, faceDirection(local, 4)); if (tile == vec2(3.0, 1.0)) return texture(iChannel0, faceDirection(local, 5)); return vec4(0.0); }
vec3 environmentDirection(vec2 uv) { float phi = (uv.x * 2.0 - 1.0) * 3.14159265; float theta = (0.5 - uv.y) * 3.14159265; return vec3(cos(theta) * sin(phi), sin(theta), cos(theta) * cos(phi)); }
void mainImage(out vec4 color, vec2 coord) { vec2 uv = coord / iResolution.xy; color = ${sample}; }
`;
}

function slangSource(mode: CubemapPreviewMode, face: CubemapFace): string {
  const sample = mode === 'face' ? `iChannel0.Sample(faceDirection(uv, ${faceIndex(face)}))` : mode === 'layout' ? 'layoutSample(uv)' : 'iChannel0.Sample(environmentDirection(uv))';
  return `float3 faceDirection(float2 uv, int face) { float2 p = 2.0 * uv - 1.0; if (face == 0) return normalize(float3(1.0, -p.y, -p.x)); if (face == 1) return normalize(float3(-1.0, -p.y, p.x)); if (face == 2) return normalize(float3(p.x, 1.0, p.y)); if (face == 3) return normalize(float3(p.x, -1.0, -p.y)); if (face == 4) return normalize(float3(p.x, -p.y, 1.0)); return normalize(float3(-p.x, -p.y, -1.0)); }
float4 layoutSample(float2 uv) { int2 tile = int2(floor(uv * float2(4.0, 3.0))); float2 local = frac(uv * float2(4.0, 3.0)); if (all(tile == int2(2, 1))) return iChannel0.Sample(faceDirection(local, 0)); if (all(tile == int2(0, 1))) return iChannel0.Sample(faceDirection(local, 1)); if (all(tile == int2(1, 2))) return iChannel0.Sample(faceDirection(local, 2)); if (all(tile == int2(1, 0))) return iChannel0.Sample(faceDirection(local, 3)); if (all(tile == int2(1, 1))) return iChannel0.Sample(faceDirection(local, 4)); if (all(tile == int2(3, 1))) return iChannel0.Sample(faceDirection(local, 5)); return float4(0.0); }
float3 environmentDirection(float2 uv) { float phi = (uv.x * 2.0 - 1.0) * 3.14159265; float theta = (0.5 - uv.y) * 3.14159265; return float3(cos(theta) * sin(phi), sin(theta), cos(theta) * cos(phi)); }
float4 mainImage(float2 coord) { float2 uv = coord / iResolution.xy; return ${sample}; }
`;
}

function wgslSource(mode: CubemapPreviewMode, face: CubemapFace): string {
  const sample = mode === 'face' ? `iChannel0Sample(faceDirection(uv, ${faceIndex(face)}))` : mode === 'layout' ? 'layoutSample(uv)' : 'iChannel0Sample(environmentDirection(uv))';
  return `fn faceDirection(uv: vec2f, face: i32) -> vec3f { let p = 2.0 * uv - 1.0; if (face == 0) { return normalize(vec3f(1.0, -p.y, -p.x)); } if (face == 1) { return normalize(vec3f(-1.0, -p.y, p.x)); } if (face == 2) { return normalize(vec3f(p.x, 1.0, p.y)); } if (face == 3) { return normalize(vec3f(p.x, -1.0, -p.y)); } if (face == 4) { return normalize(vec3f(p.x, -p.y, 1.0)); } return normalize(vec3f(-p.x, -p.y, -1.0)); }
fn layoutSample(uv: vec2f) -> vec4f { let tile = vec2i(floor(uv * vec2f(4.0, 3.0))); let local = fract(uv * vec2f(4.0, 3.0)); if (all(tile == vec2i(2, 1))) { return iChannel0Sample(faceDirection(local, 0)); } if (all(tile == vec2i(0, 1))) { return iChannel0Sample(faceDirection(local, 1)); } if (all(tile == vec2i(1, 2))) { return iChannel0Sample(faceDirection(local, 2)); } if (all(tile == vec2i(1, 0))) { return iChannel0Sample(faceDirection(local, 3)); } if (all(tile == vec2i(1, 1))) { return iChannel0Sample(faceDirection(local, 4)); } if (all(tile == vec2i(3, 1))) { return iChannel0Sample(faceDirection(local, 5)); } return vec4f(0.0); }
fn environmentDirection(uv: vec2f) -> vec3f { let phi = (uv.x * 2.0 - 1.0) * 3.14159265; let theta = (0.5 - uv.y) * 3.14159265; return vec3f(cos(theta) * sin(phi), sin(theta), cos(theta) * cos(phi)); }
fn mainImage(coord: vec2f) -> vec4f { let uv = coord / iResolution.xy; return ${sample}; }
`;
}

function faceIndex(face: CubemapFace): number {
  return ['positive-x', 'negative-x', 'positive-y', 'negative-y', 'positive-z', 'negative-z'].indexOf(face);
}
