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

function assetConfig(type: 'texture' | 'cubemap', path: string): ShaderConfig {
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

const SOURCES: ReadonlyArray<{
  path: string;
  code: string;
  config: ShaderConfig;
  buffers?: ReadonlyArray<{ path: string; code: string }>;
}> = [
  {
    path: '/shaders/aurora.glsl',
    code: `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
	vec2 uv = fragCoord / iResolution.xy;
	vec2 p = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;
	float wave = sin(p.x * 3.0 + iTime) + sin(p.y * 4.0 - iTime * 0.7);
	vec3 sky = 0.5 + 0.5 * cos(iTime + uv.xyx * 3.0 + vec3(0.0, 2.0, 4.0));
	fragColor = vec4(sky + 0.15 * wave, 1.0);
}`,
    config: EMPTY_CONFIG,
  },
  {
    path: '/shaders/aurora-slang.slang',
    code: `float4 mainImage(float2 fragCoord)
{
	float2 uv = fragCoord / iResolution.xy;
	float3 colour = 0.5 + 0.5 * cos(iTime + uv.xyx * 4.0 + float3(0.0, 2.0, 4.0));
	return float4(colour, 1.0);
}`,
    config: EMPTY_CONFIG,
  },
  {
    path: '/shaders/nebula-texture.glsl',
    code: `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
	vec2 uv = fragCoord / iResolution.xy;
	fragColor = vec4(texture(iChannel0, uv).rgb, 1.0);
}`,
    config: assetConfig('texture', SHADER_STUDIO_DEFAULT_ASSETS.nebulaTexture),
  },
  {
    path: '/shaders/desert-cubemap.glsl',
    code: `// Drag in the preview to look around.
// Cubemap: Rogland Sunset by Greg Zaal / Poly Haven, released under CC0.
// https://polyhaven.com/a/rogland_sunset

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
  {
    path: '/shaders/glow-trails.glsl',
    code: `// Glow Trails: Trails (feedback) -> Glow (blur) -> Image.
// Open Config to inspect the buffers. Drag in the preview to paint.

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec3 trails = texture(iChannel0, uv).rgb;
    vec3 glow = texture(iChannel1, uv).rgb;
    vec3 color = vec3(0.008, 0.012, 0.025) + trails + glow * 1.5;
    fragColor = vec4(pow(1.0 - exp(-color), vec3(1.0 / 2.2)), 1.0);
}`,
    config: {
      version: '1.0',
      passes: {
        Trails: {
          path: 'glow-trails/trails.buffer.glsl',
          inputs: { iChannel0: { type: 'buffer', source: 'Trails' } },
        },
        Glow: {
          path: 'glow-trails/glow.buffer.glsl',
          inputs: { iChannel0: { type: 'buffer', source: 'Trails' } },
        },
        Image: {
          inputs: {
            iChannel0: { type: 'buffer', source: 'Trails' },
            iChannel1: { type: 'buffer', source: 'Glow' },
          },
        },
      },
    },
    buffers: [
      {
        path: '/shaders/glow-trails/trails.buffer.glsl',
        code: `// Trails reads its own previous frame through iChannel0.
// Clear on restart; fade old ink before adding moving lights or mouse input.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec2 p = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    float dt = clamp(iTimeDelta, 0.0, 0.1);
    vec3 ink = vec3(0.0);
    if (iFrame > 0) {
        ink = texture(iChannel0, uv).rgb * exp(-dt * 1.8);
    }
    for (int i = 0; i < 3; i++) {
        float phase = float(i) * 2.094395;
        vec2 center = 0.28 * vec2(sin(iTime * 0.9 + phase), cos(iTime * 1.3 + phase));
        vec3 tint = 0.5 + 0.5 * cos(phase + vec3(0.0, 2.0, 4.0));
        ink += tint * exp(-dot(p - center, p - center) * 2200.0) * dt * 45.0;
    }
    if (iMouse.z > 0.0) {
        vec2 mouse = (iMouse.xy - 0.5 * iResolution.xy) / iResolution.y;
        ink += vec3(0.3, 0.8, 1.0) * exp(-dot(p - mouse, p - mouse) * 1800.0) * dt * 45.0;
    }
    fragColor = vec4(ink, 1.0);
}`,
      },
      {
        path: '/shaders/glow-trails/glow.buffer.glsl',
        code: `// Glow samples this frame's Trails output with a small blur kernel.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec2 stepUV = vec2(3.0) / iResolution.xy;
    vec3 glow = vec3(0.0);
    float total = 0.0;
    for (int y = -2; y <= 2; y++) {
        for (int x = -2; x <= 2; x++) {
            float weight = exp(-float(x * x + y * y) * 0.5);
            vec2 sampleUV = clamp(uv + vec2(float(x), float(y)) * stepUV, vec2(0.0), vec2(1.0));
            glow += texture(iChannel0, sampleUV).rgb * weight;
            total += weight;
        }
    }
    fragColor = vec4(glow / total, 1.0);
}`,
      },
    ],
  },
];

export function createDefaultWorkspaceFiles(): VirtualWorkspaceFile[] {
  return SOURCES.flatMap(({ path, code, config, buffers = [] }, index) => {
    const timestamp = index + 1;
    return [
      { path, contents: code, createdAt: timestamp, modifiedAt: timestamp },
      {
        path: path.replace(/\.(glsl|slang)$/i, '.sha.json'),
        contents: JSON.stringify(config, null, 2),
        createdAt: timestamp,
        modifiedAt: timestamp,
      },
      ...buffers.map((buffer) => ({
        path: buffer.path,
        contents: buffer.code,
        createdAt: timestamp,
        modifiedAt: timestamp,
      })),
    ];
  });
}

export function resolveDefaultAssetUrl(path: string, baseUrl = document.baseURI): string | null {
  const relativePath = shaderStudioDefaultAssetRelativePath(path);
  return relativePath ? new URL(relativePath, baseUrl).toString() : null;
}
