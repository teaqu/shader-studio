# Shadertoy Compatibility


Shader Studio is built around Shadertoy-style fragment shaders. For a conventional image shader, define a `mainImage` function:

```glsl
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    // your shader code
}
```

## Desktop VR shader previews

Fullscreen GLSL passes can define Shadertoy's VR entry point:

```glsl
void mainVR(out vec4 fragColor, in vec2 fragCoord, in vec3 rayOrigin, in vec3 rayDirection) {
    fragColor = vec4(rayDirection * 0.5 + 0.5, 1.0);
}
```

The **VR** toggle appears in the toolbar only when the fullscreen Image pass
defines `mainVR`. Keep `mainImage` for the normal preview: VR is off by default,
and enabling the toggle calls `mainVR` instead. It resets when switching shaders.
Move with WASD/QE and look by dragging the mouse or pressing IJKL. Dragging also
updates `iMouse`, so shaders that read it continue to receive mouse input.
The ray origin is `iCameraPos`; the normalized world-space ray direction uses
`iCameraDir`, the canvas aspect ratio, and a 90° vertical field of view.
This desktop preview uses one camera view with world-Y up. Mesh passes continue
to use `mainImage`.

### Headsets and controllers

When the browser supports an immersive WebXR session, **Enter VR** appears next
to the desktop toggle for fullscreen GLSL Image shaders defining `mainVR`.
Click it to request a headset session; **Exit VR** returns to desktop rendering.
WebXR requires a secure context and a compatible browser/device. Hosts without
WebXR keep the desktop preview.

Each eye receives its tracked ray origin and projection in `mainVR`. Ray origins
use metres in the WebXR reference space (floor-relative when available); rays
are normalized. `fragCoord` and `iResolution.xy` are local to the current eye.
Buffer passes advance once per headset frame. Pausing freezes shader time and
buffers while head tracking continues. Desktop camera controls do not move the
headset view.

These additional GLSL inputs are supplied during the session and reset on exit:

| Uniform | Type | Description |
|---------|------|-------------|
| `iVRActive` | `bool` | Immersive session active |
| `iVRControllerPosition[2]` | `vec4` | Aim-ray origin in metres; w = 1 when tracked, 0 otherwise |
| `iVRControllerDirection[2]` | `vec4` | Normalized aim-ray direction; w = 1 when tracked |
| `iVRControllerButtons[2]` | `vec4` | First four gamepad button values (0–1) |
| `iVRControllerAxes[2]` | `vec4` | First four gamepad axes (-1–1) |

Slot 0 is left and slot 1 right. Unhanded sources use the first free slot.
Absent or untracked controllers supply zeroes. Button/axis order follows the
controller's WebXR gamepad mapping; these inputs are Shader Studio additions.
Slang and WGSL entry points remain unchanged.

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
