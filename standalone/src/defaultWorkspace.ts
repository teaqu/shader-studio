import {
  SHADER_STUDIO_DEFAULT_ASSETS,
  configPathForShader,
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
    path: '/shaders/aurora-wgsl.wgsl',
    code: `fn mainImage(coord: vec2f) -> vec4f {
	let st = coord / vec2f(iResolution.x, iResolution.y);
	let uv = vec2f(st.x * iResolution.x / iResolution.y, st.y);
	let wave = sin(uv.x * 6.0 + iTime) + sin(uv.y * 8.0 - iTime * 0.7);
	let sky = vec3f(0.5) + vec3f(0.5) * cos(iTime + vec3f(uv.x, uv.y, uv.x) * 3.0 + vec3f(0.0, 2.0, 4.0));
	return vec4f(sky + 0.15 * wave, 1.0);
}`,
    config: EMPTY_CONFIG,
  },
  {
    path: '/shaders/particle-swarm.wgsl',
    code: `// Particle Swarm: WGSL compute passes push 16384 particles through a
// flow field and tally them into an atomic density grid; this Image pass
// only reads that grid. Open Config to see the storage buffers and passes.
// Drag in the preview to pull the swarm towards the pointer.
fn cellDensity(cell: vec2i) -> f32 {
	let size = vec2i(GRID);
	let wrapped = vec2u((cell % size + size) % size);
	return f32(atomicLoad(&density[wrapped.y * GRID.x + wrapped.x]));
}

fn mainImage(coord: vec2f) -> vec4f {
	// Bilinear read of the grid, so cells do not show up as hard squares.
	let gridPosition = coord / iResolution.xy * vec2f(GRID) - 0.5;
	let base = vec2i(floor(gridPosition));
	let f = fract(gridPosition);
	let packed = mix(
		mix(cellDensity(base), cellDensity(base + vec2i(1, 0)), f.x),
		mix(cellDensity(base + vec2i(0, 1)), cellDensity(base + vec2i(1, 1)), f.x),
		f.y);

	let intensity = 1.0 - exp(-packed * 0.4);
	let colour = mix(vec3f(0.02, 0.03, 0.07), vec3f(0.2, 0.7, 1.0), intensity)
		+ vec3f(1.0, 0.55, 0.2) * pow(intensity, 5.0);
	return vec4f(colour, 1.0);
}`,
    config: {
      version: '1.0',
      storage: {
        particles: { count: 16384, elementType: 'vec4<f32>' },
        density: { count: 36864, elementType: 'atomic<u32>' },
      },
      passes: {
        common: { path: 'particle-swarm/common.buffer.wgsl' },
        Seed: {
          type: 'compute',
          path: 'particle-swarm/swarm.buffer.wgsl',
          entryPoint: 'seedParticles',
          dispatch: { cover: 'particles' },
          dispatchOnce: true,
        },
        Clear: {
          type: 'compute',
          path: 'particle-swarm/swarm.buffer.wgsl',
          entryPoint: 'clearDensity',
          dispatch: { cover: 'density' },
        },
        Advect: {
          type: 'compute',
          path: 'particle-swarm/swarm.buffer.wgsl',
          entryPoint: 'advectParticles',
          dispatch: { cover: 'particles' },
        },
        Image: { inputs: {} },
      },
    },
    buffers: [
      {
        path: '/shaders/particle-swarm/common.buffer.wgsl',
        code: `// Shared by every pass. The storage buffers themselves (particles,
// density) are declared in the Storage tab of the config, so no pass has
// to declare them. GRID must stay in step with the density count there.
const GRID = vec2u(256u, 144u);
const PARTICLE_COUNT = 16384u;

fn hash21(p: vec2f) -> f32 {
	var h = fract(p * vec2f(0.1031, 0.1030));
	h += dot(h, h.yx + 33.33);
	return fract((h.x + h.y) * h.x);
}

fn valueNoise(p: vec2f) -> f32 {
	let cell = floor(p);
	let f = fract(p);
	let blend = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(hash21(cell), hash21(cell + vec2f(1.0, 0.0)), blend.x),
		mix(hash21(cell + vec2f(0.0, 1.0)), hash21(cell + vec2f(1.0, 1.0)), blend.x),
		blend.y);
}

// Curl of a drifting noise field: a divergence-free flow, so the swarm
// keeps swirling instead of collapsing into sinks.
fn flowField(p: vec2f, t: f32) -> vec2f {
	let e = 0.015;
	let drift = vec2f(0.0, t * 0.06);
	let centre = valueNoise(p * 2.0 + drift);
	let dx = valueNoise((p + vec2f(e, 0.0)) * 2.0 + drift) - centre;
	let dy = valueNoise((p + vec2f(0.0, e)) * 2.0 + drift) - centre;
	return vec2f(-dy, dx) / e;
}

fn densityIndex(position: vec2f) -> u32 {
	let cell = vec2u(clamp(position * vec2f(GRID), vec2f(0.0), vec2f(GRID) - 1.0));
	return cell.y * GRID.x + cell.x;
}`,
      },
      {
        path: '/shaders/particle-swarm/swarm.buffer.wgsl',
        code: `// Three compute kernels in one file. Each pass in the config picks its
// kernel with entryPoint, and they run in config order every frame:
// Seed (once) -> Clear -> Advect.

// Run once per compile and on Reset: scatter the particles, no velocity.
@compute @workgroup_size(64, 1, 1)
fn seedParticles(@builtin(global_invocation_id) id: vec3u) {
	if (id.x >= PARTICLE_COUNT) {
		return;
	}
	let n = f32(id.x);
	particles[id.x] = vec4f(hash21(vec2f(n, 1.7)), hash21(vec2f(n, 9.3)), 0.0, 0.0);
}

// Zero the grid before this frame's particles are counted into it.
@compute @workgroup_size(64, 1, 1)
fn clearDensity(@builtin(global_invocation_id) id: vec3u) {
	if (id.x >= GRID.x * GRID.y) {
		return;
	}
	atomicStore(&density[id.x], 0u);
}

// Move each particle along the flow field, then tally it into the grid.
// Many particles land in the same cell, so the counter has to be atomic.
@compute @workgroup_size(64, 1, 1)
fn advectParticles(@builtin(global_invocation_id) id: vec3u) {
	if (id.x >= PARTICLE_COUNT) {
		return;
	}

	let particle = particles[id.x];
	let dt = clamp(iTimeDelta, 0.0, 0.05);
	let aspect = vec2f(iResolution.x / iResolution.y, 1.0);
	var position = particle.xy;
	var velocity = particle.zw;

	// Chase the flow rather than accumulating momentum: the field is
	// divergence-free, so tracking it keeps the swarm spread out instead of
	// piling every particle into the same few streams.
	var desired = flowField(position * aspect, iTime) * 0.08;
	if (iMouse.z > 0.0) {
		let toPointer = iMouse.xy / iResolution.xy - position;
		let distance = length(toPointer);
		if (distance > 0.0001) {
			desired += toPointer / distance * 0.25 * exp(-distance * 4.0);
		}
	}
	velocity = mix(desired, velocity, exp(-dt * 6.0));

	// fract() wraps negatives too, so particles re-enter on the far edge.
	position = fract(position + velocity * dt);
	particles[id.x] = vec4f(position, velocity);
	atomicAdd(&density[densityIndex(position)], 1u);
}`,
      },
    ],
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
        path: configPathForShader(path),
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
