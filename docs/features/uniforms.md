# Uniforms

Uniforms are how a shader reads values that change per frame or per setup: time, resolution, mouse state, input channels, and your own custom parameters. Shader Studio declares the built-ins for you and can inject custom ones from a script pass.

## Built-in uniforms

These are always available — no declaration needed. Types differ slightly between GLSL and Slang:

| Uniform | GLSL | Slang | Meaning |
|---|---|---|---|
| `iResolution` | `vec3` | `float3` | Canvas size in xy, aspect ratio in z |
| `iTime` | `float` | `float` | Elapsed time in seconds |
| `iTimeDelta` | `float` | `float` | Time since the previous frame |
| `iFrameRate` | `float` | `float` | Current frames per second |
| `iMouse` | `vec4` | `float4` | Mouse position in xy, click position in zw |
| `iFrame` | `int` | `int` | Frame counter starting at zero |
| `iDate` | `vec4` | `float4` | Year, month, day, seconds since midnight |
| `iChannelTime` | `float[1024]` | — | Playback time per input channel |
| `iChannelResolution` | `vec3[1024]` | — | Resolution per input channel |
| `iSampleRate` | `float` | `float` | Audio sample rate in hertz |
| `iCameraPos` | `vec3` | `float3` | Camera position in world space |
| `iCameraDir` | `vec3` | `float3` | Normalised camera look direction |
| `iChannel0`–`iChannel3` | `sampler2D` (or cube/3D) | — | Input channel textures in configured slot order |
| `iCh0`–`iCh3` | channel metadata struct | — | Input channel with sampler, size, playback time, and loaded state |
| `inputs.<name>` | — | `ShaderStudioChannel2D` / `…Cube` / `…3D` | Input channel object: sampling, size, playback time, loaded state, native texture and sampler |
| `iDispatch` | — | `int` | Compute only: zero-based dispatch index |
| `iWorldPosition` | `vec3` | `float3` | Fragment only: world-space position of the fragment; zero for fullscreen geometry |
| `iNormal` | `vec3` | `float3` | Fragment only: world-space interpolated normal; zero for fullscreen geometry |
| `iCameraPosition` | `vec3` | `float3` | Fragment only: world-space camera position for mesh fragments; zero for fullscreen geometry |

`iWorldPosition`, `iNormal`, and `iCameraPosition` carry values only when the pass renders 3D geometry — see [Vertex Shaders](vertex-shaders.md#fragment-shader-access).

Slang has no `iChannelN`, `iChN`, `iChannelTime`, or `iChannelResolution` symbols. Channels are members of `inputs`, named by the exact configuration key — `iChannel0` becomes `inputs.iChannel0`, a channel named `noise` becomes `inputs.noise` — and per-channel metadata comes from that object (`inputs.noise.size`, `.time`, `.loaded`). See [Channels](channels.md) for configuring input slots.

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

Types are inferred from the return value on the first call. Supported types: `float`, `vec2`, `vec3`, `vec4`, `bool` — in Slang they arrive as `float`, `float2`, `float3`, `float4`, and `bool`. The values are injected as uniforms automatically — use `uSpeed` and `uOffset` in your shader with no declaration. See [The Script Pass](config-buffers.md#the-script-pass) for exporting, polling, and Node.js APIs.

## Next

[Time And Playback Controls](time-controls.md) — scrub, loop, and drive `iTime`
