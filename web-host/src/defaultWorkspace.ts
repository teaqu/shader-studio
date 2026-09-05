import {
  SHADER_STUDIO_DEFAULT_ASSETS,
  shaderStudioDefaultAssetRelativePath,
  type ShaderConfig,
} from '@shader-studio/types';
import type { VirtualWorkspaceFile } from './VirtualWorkspace';

const EMPTY_CONFIG: ShaderConfig = {
  version: '1.0',
  passes: { Image: { inputs: {} } },
};

function assetConfig(type: 'texture' | 'video' | 'cubemap', path: string): ShaderConfig {
  return {
    version: '1.0',
    passes: {
      Image: {
        inputs: {
          iChannel0: { type, path, filter: 'linear', wrap: 'repeat' },
        },
      },
    },
  };
}

const SOURCES: ReadonlyArray<{ path: string; code: string; config: ShaderConfig }> = [
  {
    path: '/shaders/aurora.glsl',
    code: `// Shader Studio Aurora
// Edit this shader and see the preview update live.

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
	vec2 uv = fragCoord / iResolution.xy;
	vec2 p = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;
	float wave = sin(p.x * 3.0 + iTime) + sin(p.y * 4.0 - iTime * 0.7);
	vec3 sky = 0.5 + 0.5 * cos(iTime + uv.xyx * 3.0 + vec3(0.0, 2.0, 4.0));
	fragColor = vec4(sky + 0.15 * wave, 1.0);
}`,
    config: EMPTY_CONFIG,
  },
  {
    path: '/shaders/aurora.slang',
    code: `// Shader Studio Aurora Slang / WebGPU

float4 mainImage(float2 fragCoord)
{
	float2 uv = fragCoord / iResolution.xy;
	float3 colour = 0.5 + 0.5 * cos(iTime + uv.xyx * 4.0 + float3(0.0, 2.0, 4.0));
	return float4(colour, 1.0);
}`,
    config: EMPTY_CONFIG,
  },
  {
    path: '/shaders/nebula-texture.glsl',
    code: `// Shader Studio default texture

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
	vec2 uv = fragCoord / iResolution.xy;
	fragColor = vec4(texture(iChannel0, uv).rgb, 1.0);
}`,
    config: assetConfig('texture', SHADER_STUDIO_DEFAULT_ASSETS.nebulaTexture),
  },
  {
    path: '/shaders/nebula-video.glsl',
    code: `// Shader Studio default video

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
	vec2 uv = fragCoord / iResolution.xy;
	fragColor = vec4(texture(iChannel0, uv).rgb, 1.0);
}`,
    config: assetConfig('video', SHADER_STUDIO_DEFAULT_ASSETS.nebulaVideo),
  },
  {
    path: '/shaders/desert-cubemap.glsl',
    code: `// Shader Studio default cubemap
// Drag in the preview to look around.

mat2 rotate(float angle) {
	float c = cos(angle);
	float s = sin(angle);
	return mat2(c, -s, s, c);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
	vec2 p = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;
	vec3 direction = normalize(vec3(p, 1.5));
	vec2 orbit = iMouse.z == 0.0 ? vec2(0.0) : iMouse.xy / iResolution.xy - 0.5;
	direction.xz = rotate(-orbit.x * 6.283185) * direction.xz;
	direction.yz = rotate(orbit.y * 3.141593) * direction.yz;
	fragColor = vec4(texture(iChannel0, direction).rgb, 1.0);
}`,
    config: assetConfig('cubemap', SHADER_STUDIO_DEFAULT_ASSETS.desertCubemap),
  },
];

export function createDefaultWorkspaceFiles(): VirtualWorkspaceFile[] {
  return SOURCES.flatMap(({ path, code, config }, index) => {
    const timestamp = index + 1;
    return [
      { path, contents: code, createdAt: timestamp, modifiedAt: timestamp },
      {
        path: path.replace(/\.(glsl|slang)$/i, '.sha.json'),
        contents: JSON.stringify(config, null, 2),
        createdAt: timestamp,
        modifiedAt: timestamp,
      },
    ];
  });
}

export function resolveDefaultAssetUrl(path: string, baseUrl = document.baseURI): string | null {
  const relativePath = shaderStudioDefaultAssetRelativePath(path);
  return relativePath ? new URL(relativePath, baseUrl).toString() : null;
}
