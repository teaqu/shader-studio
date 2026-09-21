# Uniforms

Uniforms are how a shader reads values that change per frame or per setup: time, resolution, mouse state, input channels, and your own custom parameters. Shader Studio declares the built-ins for you and can read custom ones from a Script pass.

## Built-in uniforms

These are always available — no declaration needed. Types differ slightly between GLSL, Slang, and WGSL:

| Uniform | GLSL | Slang | WGSL | Meaning |
|---|---|---|---|---|
| `iResolution` | `vec3` | `float3` | `vec3f` | Canvas size in xy, aspect ratio in z |
| `iTime` | `float` | `float` | `f32` | Elapsed time in seconds |
| `iTimeDelta` | `float` | `float` | `f32` | Time since the previous frame |
| `iFrameRate` | `float` | `float` | `f32` | Current frames per second |
| `iMouse` | `vec4` | `float4` | `vec4f` | As on Shadertoy: xy = pointer position while a button is held, zw = click position; z > 0 while held, w > 0 only on the click frame |
| `iFrame` | `int` | `int` | `i32` | Frame counter starting at zero |
| `iDate` | `vec4` | `float4` | `vec4f` | Year, month, day, seconds since midnight |
| `iChannelTime` | `float[1024]` | — | — | Playback time per input channel |
| `iChannelResolution` | `vec3[1024]` | — | — | Resolution per input channel |
| `iSampleRate` | `float` | `float` | `f32` | Audio sample rate in hertz |
| `iCameraPos` | `vec3` | `float3` | `vec3f` | Camera position in world space |
| `iCameraDir` | `vec3` | `float3` | `vec3f` | Normalised camera look direction |
| `iChannel0`–`iChannel3` | `sampler2D` (or cube/3D) | `ShaderStudioChannel2D` / `…Cube` / `…3D` | Metadata object; use `iChannel0Texture` and `iChannel0Sampler` to sample | Input channel textures in configured slot order |
| `iCh0`–`iCh3` | channel metadata struct | — | — | Input channel with sampler, size, playback time, and loaded state |
| `<name>` | named channel object | `ShaderStudioChannel2D` / `…Cube` / `…3D` | Metadata object; use `<name>Texture` and `<name>Sampler` to sample | Input channel configured with that name |
| `iDispatch` | — | `int` | `i32` | Compute only: zero-based dispatch index |
| `iWorldPosition` | `vec3` | `float3` | `vec3f` | Fragment only: world-space position of the fragment; zero for fullscreen geometry |
| `iNormal` | `vec3` | `float3` | `vec3f` | Fragment only: world-space interpolated normal; zero for fullscreen geometry |
| `iCameraPosition` | `vec3` | `float3` | `vec3f` | Fragment only: world-space camera position for mesh fragments; zero for fullscreen geometry |

`iWorldPosition`, `iNormal`, and `iCameraPosition` carry values only when the pass renders 3D geometry — see [Vertex Shaders](vertex-shaders.md#fragment-shader-access).

Slang has no `iChN`, `iChannelTime`, or `iChannelResolution` symbols. Each
configured channel is a direct global named by its exact configuration key —
`iChannel0` stays `iChannel0`, and a channel named `noise` is `noise` — with
metadata such as `noise.size`, `noise.time`, and `noise.loaded`. The former
`inputs.<name>` syntax was removed; only the `.sha.json` configuration still
uses its `inputs` field.

WGSL also has no `iChN`, `iChannelTime`, or `iChannelResolution` symbols. Its
direct channel global provides metadata such as `noise.size`, `noise.time`, and
`noise.loaded`; native handles are separate (`noiseTexture` and `noiseSampler`).
Use `sample2D(noiseTexture, noiseSampler, uv)` or the legacy
`noiseSample(uv)` helper. See [Channels](channels.md) for the complete channel
API and stage-specific sampling rules.

## Custom uniforms

Add a [Script pass](config-buffers.md#the-script-pass) in the config panel to compute custom uniform values each frame from TypeScript or JavaScript:

```ts
// shader.uniforms.ts
export function uniforms(ctx: { time: number }) {
  return {
    uSpeed: 1.5,
    uOffset: [0.1, 0.2],
  };
}
```

Types are inferred from the return value on the first call. Supported types: `float`, `vec2`, `vec3`, `vec4`, `bool` — in Slang they arrive as `float`, `float2`, `float3`, `float4`, and `bool`; in WGSL, as `f32`, `vec2f`, `vec3f`, `vec4f`, and `bool`. The values are available automatically — use `uSpeed` and `uOffset` in your shader with no declaration. See [The Script Pass](config-buffers.md#the-script-pass) for exporting, polling, and Node.js APIs.

## Next

[Time And Playback Controls](time-controls.md) — scrub, loop, and drive `iTime`
