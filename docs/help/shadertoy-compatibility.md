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
| `iMouse` | `vec4` | xy = pointer position while a button is held, zw = click position; z > 0 while held, w > 0 only on the click frame |
| `iResolution` | `vec3` | Canvas dimensions: xy = width/height, z = 1.0 |
| `iChannelN` | sampler type follows the configured input | Input channel `N` (up to the configured channel limit) |
| `iChannelResolution[N]` | `vec3` | Resolution of input channel `N` |
| `iChannelTime[N]` | `float` | Playback time for input channel `N` |
| `iChN` | metadata struct | Shader Studio accessor for channel `N`: `.sampler`, `.size`, `.time`, and `.loaded` |
| `iDate` | `vec4` | Year, month, day, seconds since midnight |
| `iSampleRate` | `float` | Audio sample rate (44100) |

## Shader Studio Extensions

These uniforms are provided by Shader Studio but are not part of the Shadertoy API:

| Uniform | Type | Description |
|---------|------|-------------|
| `iCameraPos` | `vec3` | Camera position in world space (moved with WASD/QE) |
| `iCameraDir` | `vec3` | Camera look direction (controlled with mouse or IJKL) |
| `iVertexCount` | `int` | Vertices the pass draws: the vertices geometry's `vertexCount` (default 3), 3 for fullscreen, or the mesh vertex count. See [Vertices geometry](../features/vertex-shaders.md#vertices-geometry) |
| `iVertexUv` | `vec2` | Fragment-only perspective-correct interpolated `uv` written by `mainVertex`; available for every geometry and space |
| `iFrontFacing` | `bool` | Fragment-only primitive orientation; always `true` for fullscreen geometry |
| `iViewMatrix`, `iProjectionMatrix`, `iViewProjection` | `mat4` | The orbit camera that meshes and world-space vertices are drawn with. See [Camera matrices](../features/vertex-shaders.md#camera-matrices) |
| `iInstanceCount` | `int` | Copies of the geometry the pass draws: its `instanceCount` (default 1), or 1 for fullscreen. See [Instancing](../features/vertex-shaders.md#instancing) |
| `iInstanceIndex` | `int` | Which copy is being drawn, from 0 to `iInstanceCount - 1`, in the vertex and fragment shader |

## Supported Input Types

| Type | Description |
|------|-------------|
| **Buffer** | Output from another configured pass (arbitrary names supported) |
| **Texture** | Image files (jpg, png, etc.) |
| **Video** | Video files (webm, mp4, mov, avi) |
| **Audio** | Audio files (mp3, wav, ogg, etc.) — provides FFT and waveform data as a texture |
| **Cubemap** | Cross-layout cubemap images — bound as `samplerCube` |
| **Keyboard** | Key state input |

## Supported Passes

| Pass | Description |
|------|-------------|
| **Image** | Main output pass (required) |
| **BufferA–D** | Imported Shadertoy names work; Shader Studio also supports arbitrary names and more than 4 intermediate passes |
| **Common** | Shared code included in all passes |

## Not Supported

| Feature | Notes |
|---------|-------|
| Cubemap buffer | Shadertoy's Cubemap buffer pass is not supported |
| Webcam input | Live camera feed |
| Microphone input | Real-time audio from microphone |
| VR/AR | Immersive rendering modes |
