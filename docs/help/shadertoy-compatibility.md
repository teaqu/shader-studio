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


