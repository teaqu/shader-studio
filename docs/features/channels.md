# Channels

![Channels](../assets/images/channels.png)

Channels let a pass read images, video, audio, buffers, cubemaps, or keyboard state.
Each pass has its own configured names. A channel named `albedo` exposes
`albedo.size`, `albedo.time`, and `albedo.loaded` in GLSL, Slang, and WGSL.

GLSL and Slang also expose `albedo.sampler`. Slang has `albedo.texture` and
sampling methods. WGSL keeps native handles separate: `albedoTexture` and
`albedoSampler`. Slang and WGSL share the `sample2D` and `sampleCube` function
families described below. These are Shader Studio conveniences, not language built-ins.

Vertex hooks share the pass's channel configuration. In Slang and WGSL vertex
or compute code, use explicit levels or gradients; implicit derivative sampling
is fragment-only. See [Vertex Shaders](vertex-shaders.md) for each hook signature.

## What Channels Can Do

Channels are useful in a few different ways:

- Add source media, such as images, videos, audio files, and cubemaps.
- Connect passes together by reading the output of a buffer.
- Build feedback effects by letting a buffer read its own previous frame.
- Make shaders interactive by sampling keyboard state.
- Use per-input metadata such as resolution and playback time.

## Adding a Channel

Open the pass you want to configure, then use the channel grid:

1. Click **+** on an empty slot to add an input.
2. Choose what the channel should read: texture, video, audio, cubemap, buffer, or keyboard.
3. Set the file, source pass, or options for that input.
4. Sample it with the matching channel name using the examples below.

Click an existing channel to edit or remove it. Channels can also be renamed, as long as the name is a valid identifier for the shader language.

!!! note
    Channel uniforms are available automatically. For most channel types, you do not need to declare `uniform sampler2D iChannelN;` in your shader.

## Sampling Channels in GLSL

The channel slot tells you which uniform to sample. If you add a texture to `iChannel0`, sample `iChannel0`. If you add keyboard state to `iChannel1`, sample `iChannel1`.

```glsl
vec2 uv = fragCoord / iResolution.xy;
vec4 inputColor = texture(iChannel0, uv);
```

Use `iChannelResolution[N].xy` when the input has a different size than the canvas:

```glsl
vec2 inputUV = fragCoord / iChannelResolution[0].xy;
vec4 inputColor = texture(iChannel0, inputUV);
```

Named GLSL channels group their combined sampler and metadata:

```glsl
vec4 color = texture(albedo.sampler, uv);
vec2 dimensions = albedo.size.xy;
bool ready = albedo.loaded != 0;
float playbackSeconds = albedo.time;
```

The numbered `iChannelN`, `iChN`, `iChannelResolution`, `iChannelTime` and
`sampleIChannelN` APIs remain available. Existing named calls to `texture`,
`textureLod`, `textureGrad`, `textureSize` and `texelFetch` also accept the channel
object through compatibility overloads (where the texture shape and shader stage
support the operation). For other native operations or your own functions taking
a sampler parameter, pass `albedo.sampler` explicitly.

## Sampling Channels in Slang

```slang
float4 color = sample2D(albedo.texture, albedo.sampler, uv);
float4 sharp = sample2DLevel(albedo.texture, albedo.sampler, uv, 0.0);
float4 gradient = sample2DGrad(albedo.texture, albedo.sampler, uv, ddx(uv), ddy(uv));

// Optional methods use the channel's configured sampler.
float4 same = albedo.Sample(uv);
float4 level = albedo.SampleLevel(uv, 2.0);
float4 grad = albedo.SampleGrad(uv, ddx(uv), ddy(uv));

uint2 dimensions = albedo.size;
float playbackSeconds = albedo.time;
bool ready = albedo.loaded;
```

Slang channel objects are direct globals. `inputs.albedo` is no longer
available: migrate it to `albedo` (and likewise change `inputs.iChannel0` to
`iChannel0`). The configured name must be a valid, non-reserved Slang global;
Shader Studio reports a diagnostic when it is not. This does not change the
`.sha.json` `inputs` field, which continues to hold channel configuration.
A local variable with the same name shadows the channel; rename that local
if you need to sample the channel from that scope.

The methods also accept an explicit sampler as their first argument:
`albedo.Sample(reference.sampler, uv)`. The spelling is `SampleLevel`, not `SampleLod`.

## Sampling Channels in WGSL

```wgsl
let color = sample2D(albedoTexture, albedoSampler, uv);
let sharp = sample2DLevel(albedoTexture, albedoSampler, uv, 0.0);
let gradient = sample2DGrad(albedoTexture, albedoSampler, uv, dpdx(uv), dpdy(uv));

let dimensions = albedo.size; // vec2u
let playbackSeconds = albedo.time; // f32
let ready = albedo.loaded; // bool
```

Use `albedoTexture` and `albedoSampler` for sampling, and `albedo` for metadata. Legacy `albedoSample`, `albedoSampleLevel`, `albedoSampleGrad`,
`albedoSize()`, `albedoTime()` and `albedoLoaded()` remain supported.

## Shared Sampling Rules

| Slang and WGSL function | Arguments after texture and sampler |
|---|---|
| `sample2D` | `uv` |
| `sample2DLevel` | `uv, lod` |
| `sample2DGrad` | `uv, dx, dy` |
| `sampleCube` | `direction` |
| `sampleCubeLevel` | `direction, lod` |
| `sampleCubeGrad` | `direction, dx, dy` |

2D convenience functions and Slang methods use bottom-left UV coordinates,
matching `mainImage` pixel coordinates. Cubemaps use direction vectors. Native texture operations
use their language's native coordinates.

Texture, video, cubemap, and buffer channels expose per-input filter and wrap
settings. Buffer inputs support `linear` or `nearest` filtering and `clamp` or
`repeat` wrapping; their defaults are `linear` and `clamp`. Mipmaps are not yet
available for buffer outputs. Each shared function takes an explicit sampler, so
another channel's sampler can be used without changing the texture. Two inputs
can therefore read the same buffer with different sampling settings.

Implicit `sample2D`/`sampleCube` and Slang `Sample` require a fragment stage
and uniform control flow: do not call them inside a branch or loop whose execution
differs between neighboring fragments (for example, a condition based on pixel
coordinates or sampled data). WGSL validation, including Slang compiled for WebGPU,
can reject these calls with a derivative-uniformity error. Move the sample before
the branch, or use `sample2DLevel(..., 0.0)` / Slang `SampleLevel(uv, 0.0)` when
you need to sample inside it. Explicit level zero still uses the sampler's filtering;
it does not make a read texel-exact.

Use `Level` or explicit `Grad` operations in vertex and compute code. For WGSL
`<name>Sample` calls in compute code, use `<name>SampleLevel(uv, 0.0)` or the shared level function.
Derivative expressions themselves (`ddx`, `dpdx`, etc.) still require fragment code.

## Channel Metadata

| Field | GLSL | Slang | WGSL | Meaning |
|---|---|---|---|---|
| `.size` | `vec3` | `uint2` | `vec2u` | Texture dimensions; cubemaps report face dimensions. |
| `.time` | `float` | `float` | `f32` | Audio/video playback position in seconds; zero for other inputs. |
| `.loaded` | `int` (0/1) | `bool` | `bool` | A usable resource is available. |

Metadata updates with the current frame. Pausing or reaching the end of a video
keeps its last frame available. A video reports loaded once its first frame is
ready to sample. A configured but unavailable input
reports unloaded; a name absent from the configuration is a compile error.
Channels support 2D and cubemap inputs; volume/3D assets are not configurable.

## Choosing a Channel Type

Use a channel type based on what the shader needs to sample:

| Type | Use it for | GLSL sampler |
|------|------------|--------------|
| **Texture** | Static images, noise maps, lookup tables, masks | `sampler2D` |
| **Video** | Moving footage sampled like an image | `sampler2D` |
| **Audio** | FFT and waveform data from an audio file | `sampler2D` |
| **Cubemap** | Skyboxes and environment maps | `samplerCube` sampled with a `vec3` direction |
| **Buffer** | Output from another pass, including feedback | `sampler2D` |
| **Keyboard** | Pressed, held, and toggled key state | `sampler2D` |

See [Channel Metadata](#channel-metadata) for the shared field meanings and types.

## Texture Channels

Bind a static image file to a channel.

![Choosing a texture channel](../assets/images/select-texture.png)

**Supported formats:** `png jpg jpeg gif bmp webp tga hdr exr`

| Option | Values | Default | Description |
|--------|--------|---------|-------------|
| `filter` | `mipmap` / `linear` / `nearest` | `mipmap` | Texture filtering quality |
| `wrap` | `repeat` / `clamp` | `clamp` | Edge sampling behaviour |
| `vflip` | bool | `false` | Flip the image vertically |
| `grayscale` | bool | `false` | Convert to luminance (single channel) |

```glsl
vec4 col = texture(iChannel0, uv * 4.0);  // tiling works because wrap = repeat
```

!!! tip
    Use `filter: nearest` and `wrap: repeat` for data textures or pixel-art where blending between texels is undesirable.

## Video Channels

Bind a video file. Sampled identically to a texture in GLSL.

![Choosing a video channel](../assets/images/select-video.png)

**Common formats:** `mp4 webm ogg mov`

The container extension alone does not guarantee playback. The video and audio
codecs inside the container must also be supported by the browser engine used by
your Shader Studio host. Codec availability can differ between a normal browser,
VS Code, Electron, and operating systems.

The channel editor includes playback controls — play, pause, next, mute, reset, and a time display. Playback is synced to the shader's play/pause state. The mute button persists to the config as `muted: true/false` (default `false`), so a channel's mute state survives reloads and resets.

!!! note
    Pausing the shader pauses the video.

## Audio Channels

Bind an audio file. The channel provides a **512×2 texture** containing frequency and waveform data each frame.

![Choosing an audio channel](../assets/images/select-music.png)

**Common formats:** `mp3 wav ogg flac aac m4a` — plus video containers
(`mp4 webm mov`) that contain an audio stream. Actual codec support depends on
the browser engine used by the host; a recognized extension does not guarantee
that its encoded audio can be decoded.

If a media file fails to load or its audio plays silently, convert it to a format
supported by your target browser or VS Code build. For example, FFmpeg can create
an MP3-audio copy of an MP4 while leaving its video stream unchanged:

```sh
ffmpeg -i input.mp4 -c:v copy -c:a libmp3lame -q:a 2 output.mp4
```

!!! tip "Seamless audio loops"
    MP3, AAC, and other compressed formats can add encoder delay, padding, or a
    startup transient. These artifacts may cause a click or short gap when an
    audio channel loops. For the most predictable, sample-continuous audio-channel
    loops, use uncompressed PCM WAV:

    ```sh
    ffmpeg -i input.mp4 -vn -c:a pcm_s16le -ar 48000 output.wav
    ```

**Texture layout:**

| Row | y coordinate | Contents |
|-----|-------------|----------|
| Row 0 | ≈ 0.25 | FFT frequency spectrum — x goes from low to high frequency, value is amplitude 0–1 |
| Row 1 | ≈ 0.75 | Time-domain waveform — x is sample position across the current audio frame |

```glsl
float bass   = texture(iChannel0, vec2(0.05, 0.25)).r; // (1)
float treble = texture(iChannel0, vec2(0.85, 0.25)).r; // (2)
float wave   = texture(iChannel0, vec2(uv.x, 0.75)).r; // (3)
```

1. Low-frequency FFT bin (x ≈ 0 = bass)
2. High-frequency FFT bin (x ≈ 1 = treble)
3. Waveform value at the current screen column

The channel editor includes a **waveform visualiser** with draggable handles to set a loop region (`startTime` / `endTime` in seconds) and standard playback controls. As with video channels, the mute button persists to the config as `muted: true/false` (default `false`).

!!! tip
    The FFT texture layout matches Shadertoy's audio format exactly — audio-reactive shaders from Shadertoy port directly.

## Cubemap Channels

Bind a cubemap image for environment mapping or skyboxes. The image must be in **cross layout** (T-cross PNG), which is the same format Shadertoy uses.

For free cubemap textures, see [Humus 3D](https://www.humus.name/index.php?page=Textures).

**Supported formats:** `png jpg jpeg hdr exr`

| Option | Values | Default |
|--------|--------|---------|
| `filter` | `mipmap` / `linear` / `nearest` | `mipmap` |
| `wrap` | `clamp` / `repeat` | `clamp` |
| `vflip` | bool | `false` | |

Unlike other channel types, a cubemap channel is bound as `samplerCube` — you must sample it with a 3D direction vector.

```glsl
vec3 dir = normalize(reflect(rayDir, normal));
vec4 sky  = texture(iChannel0, dir);  // samplerCube lookup — direction, not UV
```

!!! warning
    Cubemap channels are `samplerCube`, not `sampler2D`. Passing a `vec2` UV will cause a compile error.

## Pass Output (Buffer) Channels

Read the texture output of a renderable pass. The `source` field accepts arbitrary fragment buffer pass names such as `Flow` and arbitrary names of Slang or WGSL compute passes declared with `"type": "compute"`. To sample a compute pass, write its output with `writeOutput`. `common` is shared code rather than a renderable source, and `Image` cannot be used as a source. Pass names and counts are not limited to `BufferA` through `BufferD`.

For a compute pass with `outputLayers` greater than 1, set `layer` to select one texture-array layer. It defaults to 0 and must be less than the source pass's `outputLayers`:

```json
"iChannel0": {
  "type": "buffer",
  "source": "ComputeBlur",
  "layer": 1,
  "filter": "nearest",
  "wrap": "repeat"
}
```

![Choosing a buffer or keyboard channel](../assets/images/select-misc.png)

```glsl
vec2 bufferUV = fragCoord / iChannelResolution[0].xy;  // use buffer's own resolution
vec4 prev = texture(iChannel0, bufferUV);
```

!!! note
    Use `iChannelResolution[N].xy` to get the buffer's resolution for UV mapping, especially if the buffer has a fixed resolution different from the canvas.

### Buffer Precision and Exact Reads

Most shaders can leave **Output format** on **Auto**. For simulations, 32-bit
storage helps preserve values that later passes read or that feed back into the
next frame. Choose 16-bit when lower memory use matters more than precision.

Find **Output format** at the bottom of a buffer or compute pass's settings.
Image has no output-format setting: it displays the final result on the canvas,
while buffers store values for other passes to use.

For WebGPU, the corresponding JSON setting is `outputFormat`:

```json
"Simulation": {
  "path": "simulation.wgsl",
  "outputFormat": "rgba32float",
  "inputs": {}
}
```

The Config panel exposes the same setting. WebGL buffer outputs remain `RGBA32F`.
Supported WebGPU values are `auto`,
`rgba16float`, and `rgba32float`; omission is the same as `auto`.

| Backend | Buffer format | Precision per component |
|---|---|---|
| WebGL (GLSL) | `RGBA32F` | 32-bit float |
| WebGPU (Slang and WGSL), `auto` or `rgba32float` | `rgba32float` | 32-bit float |
| WebGPU (Slang and WGSL), `rgba16float` | `rgba16float` | 16-bit float |

`auto` targets 32-bit storage and does not reduce storage precision merely because
32-bit linear filtering is unavailable. If the selected format cannot be used as
a pass output, compilation reports an error instead of silently choosing another
format. Explicit `rgba16float` remains useful when its smaller storage and reduced
precision are desired. Declaring an `f32` / `float` variable does not prevent
rounding when a value is written to a 16-bit output texture. A texel-exact read
cannot recover precision already lost on write.

Buffer inputs accept `filter: "nearest" | "linear"` and
`wrap: "clamp" | "repeat"` alongside `source` and optional `layer`. Sampling is
configured per input rather than per source. On WebGPU devices that cannot filter
32-bit float textures, a linear request uses nearest filtering while retaining
32-bit storage and the requested JSON value. Use `load2D` for packed state, cell
grids, or any read that must bypass filtering entirely. Loads also bypass wrapping;
keep coordinates in bounds or implement clamping/repeating yourself.

The following examples read a configured buffer channel named `state` at a
bottom-left-origin integer pixel `p`. Use the **source buffer's** dimensions,
especially when it differs in size from the current pass.

**GLSL:** pass either a 2D sampler or a named 2D channel. The helper forwards to
`texelFetch` at mip zero.

```glsl
ivec2 p = ivec2(fragCoord); // in bounds of state
vec4 cell = load2D(state, p);
```

**WGSL:** pass the channel's texture and a bottom-left pixel coordinate.

```wgsl
let p = vec2i(coord); // in bounds of state
let cell = load2D(stateTexture, p);
```

**Slang:** call the shared helper or the channel's `Load` convenience method.

```slang
int2 p = int2(fragCoord); // in bounds of state
float4 cell = load2D(state.texture, p);
float4 sameCell = state.Load(p);
```

!!! warning
    `load2D` and Slang channel `.Load` use bottom-left integer
    coordinates. Native WGSL `textureLoad` and Slang `.texture.Load` retain their
    native top-left coordinates. Use native operations directly when your integer
    coordinates are already top-left; do not apply the conversion twice.

### Pass Execution Order

Fragment buffer passes run in their declaration order in the `.sha.json` `passes`
object, **not alphabetical order**. On WebGPU, compute passes run first in their
own declaration order, followed by fragment buffers in their declaration order.
`Image` runs last regardless of where it appears in the config. `common` is shared
code and does not execute as a pass. Input dependencies do not reorder passes.

A pass reads the **current-frame** output of a source that has already run. A
self-reference or a reference to a source that runs later reads that source's
**previous-frame** output.

For fragment passes declared as `BufferA`, `BufferB`, `BufferC`, `BufferD`:

| Read | Output seen |
|---|---|
| `BufferB` reads `BufferA` | Current frame |
| `BufferA` reads `BufferB` | Previous frame |
| `BufferD` reads itself | Previous frame |
| `Image` reads any buffer | Current frame |

The same rule applies across WebGPU pass groups: a fragment pass sees a compute
pass's current output, while a compute pass sees a fragment buffer's previous
output. Renaming passes does not change timing; changing declaration order within
a group does.

## Keyboard Channels

Bind keyboard state as a texture. No path or options — just add it to a channel slot.

The channel provides a **256×3 texture**. Each column is a key code (matching browser `e.keyCode` values, the same as Shadertoy).

| Row | y coordinate | Contents |
|-----|-------------|----------|
| Row 0 | ≈ 0.16 | Key currently held (255 = held, 0 = not held) |
| Row 1 | ≈ 0.50 | Key was just pressed this frame |
| Row 2 | ≈ 0.83 | Toggle — alternates each press |

```glsl
// iChannel1 = keyboard
float held    = texture(iChannel1, vec2(32.0 / 256.0, 0.16)).r;  // Space held
float pressed = texture(iChannel1, vec2(32.0 / 256.0, 0.50)).r;  // Space just pressed
```

## Next

[Uniforms](uniforms.md) — built-in and custom uniforms, including channel samplers
