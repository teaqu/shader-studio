# Shadertoy Compatibility


Shader Studio is built around Shadertoy-style fragment shaders. Your shader must define a `mainImage` function:

```glsl
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    // your shader code
}
```

## Supported Uniforms

| Uniform | Type | Description |
|---------|------|-------------|
| `iTime` | `float` | Elapsed time in seconds |
| `iTimeDelta` | `float` | Time since last frame in seconds |
| `iFrameRate` | `float` | Frames per second |
| `iFrame` | `int` | Frame counter (starts at 0) |
| `iMouse` | `vec4` | Mouse position: xy = current, zw = click position |
| `iResolution` | `vec3` | Canvas dimensions: xy = width/height, z = 1.0 |
| `iChannel0–3` | `sampler2D` | Input texture channels |
| `iChannelResolution[4]` | `vec3[]` | Resolution of each input channel |
| `iChannelTime[4]` | `float[]` | Playback time for each audio channel |
| `iDate` | `vec4` | Year, month, day, seconds since midnight |
| `iSampleRate` | `float` | Audio sample rate (44100) |

## Supported Input Types

| Type | Description |
|------|-------------|
| **Buffer** | Output from another pass (BufferA–D) |
| **Texture** | Image files (jpg, png, etc.) |
| **Video** | Video files (webm, mp4, mov, avi) |
| **Audio** | Audio files (mp3, wav, ogg, etc.) — provides FFT and waveform data as a texture |
| **Cubemap** | Cross-layout cubemap images — bound as `samplerCube` |
| **Keyboard** | Key state input |

## Supported Passes

| Pass | Description |
|------|-------------|
| **Image** | Main output pass (required) |
| **BufferA–D** | Up to 4 intermediate render passes |
| **Common** | Shared code included in all passes |

## Not Yet Supported

| Feature | Notes |
|---------|-------|
| Webcam input | Live camera feed (planned) |
| Microphone input | Real-time audio from microphone |
| VR/AR | Immersive rendering modes |

## Porting from Shadertoy

Most Shadertoy shaders work without modification. Common adjustments:

- **Multi-pass shaders** need a `.sha.json` config to define buffer passes and channel bindings. Use **Generate Config** from the command palette.
- **Textures** referenced as `iChannel0` need to be bound in the config file.
- **Common code** (shared functions) should use a Common pass in the config.
- **Audio shaders** bind an audio file as a channel input; the texture provides FFT (row 0) and waveform (row 1) data matching Shadertoy's layout.
- **Cubemap shaders** bind a T-cross cubemap image as a channel input, which becomes a `samplerCube`.
