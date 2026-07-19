# Config File Format (`.sha.json`)


This page describes the raw JSON config format. Most users will find it easier to use the [Config panel](../features/config-buffers.md) in the UI instead — this reference is for those who prefer editing the file directly.

## Naming Convention

The config file must share the same base name as your shader:

- Shader file: `example.glsl`
- Config file: `example.sha.json`

Place them in the same directory. To generate a config automatically, run **Shader Studio: Generate Config for GLSL File** from the command palette.

## Basic Example

A single-pass shader with no inputs:

```json
{
  "version": "1.0",
  "passes": {
    "Image": {
      "inputs": {}
    }
  }
}
```

## Multi-Pass Example

Image reads from an arbitrarily named `Simulation` pass, which reads keyboard input:

```json
{
  "version": "1.0",
  "passes": {
    "Image": {
      "inputs": {
        "iChannel0": { "source": "Simulation", "type": "buffer" }
      }
    },
    "Simulation": {
      "path": "simulation.glsl",
      "inputs": {
        "iChannel1": { "type": "keyboard" }
      }
    }
  }
}
```

## Texture Input Example

Bind an image file to a channel:

```json
{
  "version": "1.0",
  "passes": {
    "Image": {
      "inputs": {
        "iChannel0": { "path": "textures/noise.png", "type": "texture" }
      }
    }
  }
}
```

## Video Input Example

Bind a video file:

```json
{
  "version": "1.0",
  "passes": {
    "Image": {
      "inputs": {
        "iChannel0": { "path": "videos/timelapse.mp4", "type": "video" }
      }
    }
  }
}
```

## Audio Input Example

Bind an audio file. The texture provides FFT frequency data (row 0) and waveform data (row 1), matching Shadertoy's audio format:

```json
{
  "version": "1.0",
  "passes": {
    "Image": {
      "inputs": {
        "iChannel0": {
          "type": "audio",
          "path": "music/track.mp3",
          "startTime": 0,
          "endTime": 30
        }
      }
    }
  }
}
```

Access in GLSL:

```glsl
float fft  = texture(iChannel0, vec2(uv.x, 0.25)).r; // FFT row
float wave = texture(iChannel0, vec2(uv.x, 0.75)).r;  // Waveform row
```

## Cubemap Input Example

Bind a T-cross layout cubemap image. The channel is bound as a `samplerCube`:

```json
{
  "version": "1.0",
  "passes": {
    "Image": {
      "inputs": {
        "iChannel0": {
          "type": "cubemap",
          "path": "textures/skybox.png",
          "filter": "mipmap"
        }
      }
    }
  }
}
```

Access in GLSL (channel must be declared as `samplerCube`):

```glsl
vec4 col = texture(iChannel0, normalize(dir));
```

## Script-Driven Uniforms

Add a `script` field to run a TypeScript or JavaScript file that computes custom uniform values each frame. The script exports named values; their types are inferred automatically:

```json
{
  "version": "1.0",
  "script": "uniforms.ts",
  "scriptMaxPollingFps": 30,
  "passes": {
    "Image": { "inputs": {} }
  }
}
```

Example `uniforms.ts`:

```typescript
export const uSpeed: float = iTime * 0.5;
export const uColor: vec3 = [Math.sin(iTime), 0.5, 1.0];
```

Available context variables: `iTime`, `iFrame`, `iResolution`, `iMouse`, `iDate`, `iChannelTime`, `iSampleRate`.

Supported uniform types: `float`, `vec2`, `vec3`, `vec4`, `bool`.

## Resolution Settings

Pin a resolution to the config so it applies whenever the shader is opened:

```json
{
  "version": "1.0",
  "passes": {
    "Image": {
      "resolution": {
        "scale": 1,
        "aspectRatio": "16:9"
      },
      "inputs": {}
    }
  }
}
```

Fixed pixel dimensions:

```json
"resolution": {
  "width": 1920,
  "height": 1080
}
```

Fixed dimensions are the base size. `scale` still applies if you set both:

```json
"resolution": {
  "scale": 2,
  "width": 320,
  "height": 180
}
```

This renders at `640 × 360`.

Buffer passes use a simpler fixed-size resolution:

```json
"Flow": {
  "path": "flow.glsl",
  "resolution": { "width": 512, "height": 512 }
}
```

## Passes

| Pass | Description |
|------|-------------|
| **Image** | Main output pass (required, always present) |
| **Any identifier** | An intermediate fragment pass. Names and pass counts are unrestricted; each renders to a texture other passes can read. |
| **Compute\*** | A Slang/WebGPU compute pass. See [Compute Passes](../features/compute.md). |
| **Common** | Shared GLSL or Slang code included in all passes. Useful for shared functions, types, and constants. |

Each non-Image pass needs a `path` field pointing to its `.glsl` or `.slang` file. If the file doesn't exist, the visual editor offers a button to create it.

## Channel Types

Each pass can bind up to 16 input channels (`iChannel0` through `iChannel15`):

| Type | Fields | Description |
|------|--------|-------------|
| `buffer` | `source`, optional `layer` | Read from an arbitrary fragment buffer pass or a compute pass (the reference allocates its output texture); `common` and `Image` are not sources, and `layer` selects a compute texture-array layer |
| `texture` | `path`, `filter`, `wrap`, `vflip`, `grayscale` | Image file |
| `video` | `path`, `filter`, `wrap`, `vflip`, `muted` | Video file |
| `audio` | `path`, `startTime`, `endTime`, `muted` | Audio file with FFT/waveform texture |
| `cubemap` | `path`, `filter`, `wrap`, `vflip` | T-cross cubemap image |
| `keyboard` | — | Key state input texture |

### Texture / Video / Cubemap Options

| Field | Values | Description |
|-------|--------|-------------|
| `filter` | `mipmap` (default), `linear`, `nearest` | Texture filtering |
| `wrap` | `clamp` (default), `repeat` | Edge wrap mode |
| `vflip` | `true` / `false` | Flip vertically |
| `grayscale` | `true` / `false` | Texture only: convert to greyscale |
| `muted` | `true` / `false` | Video and audio only: start the channel muted (default `false`) |

## Buffer Self-Read

A buffer can read its own previous frame's output by binding itself as an input:

```json
{
  "Feedback": {
    "path": "feedback.glsl",
    "inputs": {
      "iChannel0": { "source": "Feedback", "type": "buffer" }
    }
  }
}
```

This is how Shadertoy-style feedback effects work (trails, fluid simulations, game of life).

## File Paths

Paths in the config are relative to the config file's directory. Keep all referenced files (buffer `.glsl` files, textures, videos, audio) in the same directory or subdirectories.
