# Shadertoy Compatibility


Shader Studio is built around Shadertoy-style fragment shaders. For a conventional image shader, define a `mainImage` function:

```glsl
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    // your shader code
}
```

## Desktop VR shader previews

Use the desktop VR preview to look around a GLSL shader that defines `mainVR`, even without a headset.

1. Create a GLSL shader and leave **Image → Geometry** set to **Fullscreen**.
2. Add both `mainImage` for the normal preview and `mainVR` for the view you can look around. The complete example below colors each viewing direction differently.
3. Open **VR** in the preview toolbar and enable **Desktop preview**. Move with **W / A / S / D**, move vertically with **Q / E**, and look by dragging or pressing **I / J / K / L**.
4. Disable **Desktop preview** to return to `mainImage`. Opening another shader also turns it off.

```glsl
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    fragColor = vec4(uv, 0.5, 1.0);
}

void mainVR(out vec4 fragColor, in vec2 fragCoord,
            in vec3 rayOrigin, in vec3 rayDirection) {
    fragColor = vec4(rayDirection * 0.5 + 0.5, 1.0);
}
```

The **VR** button appears only when a fullscreen GLSL Image shader defines `mainVR`. If it is missing, check the function signature and geometry setting. Mesh passes continue to use `mainImage`; this VR workflow does not apply to Slang or WGSL.

VR opens a docked tool pane, like Config and Debug. The button sits first in the
right-hand toolbar group. It stays visible after the other tool buttons have
collapsed, then moves into the options menu when the preview becomes very narrow.

`rayOrigin` is the camera position and `rayDirection` is a normalized direction in world space. In desktop preview, they follow `iCameraPos` and `iCameraDir` with a 90° vertical field of view. Dragging also updates `iMouse`, which matters if your shader uses mouse input for another effect.

### Headsets and controllers

To view the shader in a headset:

1. Open it in a browser with immersive WebXR support and connect a compatible headset.
2. Use a secure page (HTTPS, or localhost for a preview opened from VS Code).
3. Open **VR**, click **Enter VR**, and accept the browser's request to start the session.
4. In the VR pane, click **Exit VR** to return to the desktop view.

Movement and turning are **off by default**. **Enable headset navigation** switches on left-stick movement and your selected right-stick turning mode. Hold the left trigger to move three times faster, like holding Shift in desktop preview. Disable it to use both sticks for shader effects without moving or turning the camera. Physical head tracking stays active.
Choose **Movement speed** in metres per second and set **Right stick turning** to **Snap**, **Smooth**, or **Off**. Turning off only the right stick keeps left-stick movement enabled. Snap turning requires returning the stick to the centre
before another turn. These settings, including the enable switch, are remembered in this browser. Switching navigation off preserves the chosen speed, turn mode and angle for when you enable it again. Movement follows where you look, including upward and downward when you tilt your head. Left/right strafing stays horizontal. Movement does not include collision detection. Physical head movement continues to work.
Exiting VR resets the virtual position and turning offset. Controller ray
positions and directions follow the same virtual movement as your view.

If **Enter VR** is absent, check the browser, device, and page requirements above. You can still use the desktop VR preview without WebXR support. Headset and controller behavior can vary by device.

Each eye receives its tracked ray origin and projection in `mainVR`. Ray origins
use metres and follow the WebXR reference space (floor-relative when available)
plus any navigation offset you enable; rays
are normalized. `fragCoord` and `iResolution.xy` are local to the current eye.
Buffer passes advance once per headset frame. Pausing freezes shader time and
buffers while head tracking continues. Desktop camera controls do not move the
headset view.

### Controller Lab demo

[Download Controller Lab](../assets/shaders/vr-controller-lab.glsl) and open it as a GLSL shader. In the VR pane, switch **Enable headset navigation** off, then enter VR. Hold a control to change the sculpture; release it to restore the base effect. Outside a headset, the overview cycles through a showcase automatically.

| Control | Effect |
|---|---|
| Left trigger | Orange fire and surface turbulence |
| Right trigger | Blue lightning veins |
| Left grip | Inflate the sculpture |
| Right grip | Morph the sphere into a cube |
| Left stick | Move the sculpture horizontally and vertically |
| Right stick | Twist the sculpture and shift its colour |
| Left stick click | Neon wireframe |
| Right stick click | Invert colours |
| X | Rainbow surface |
| Y | Halo ring |
| A | Orbiting satellites |
| B | Purple floor ripples |
| Point either controller | Cyan / pink aim beams follow its tracked position and direction |
| Touch a trigger, grip, stick or face button | Cyan / pink aura, when the runtime provides touch state |

System/menu buttons remain reserved by the headset. This demo uses the optional Shader Studio inputs below and requires adapting before running on Shadertoy.

### Optional Shader Studio controller inputs

`mainImage` and `mainVR` remain compatible with Shadertoy. The controller inputs
below are Shader Studio extensions. To enable them, add this line at the top
of the shader (or Common code):

```glsl
#define SHADER_STUDIO_VR_INPUTS
```

Without that opt-in, the extra names are not injected into the compiled shader.
Shaders using these inputs require adapting before running on Shadertoy.
All raw inputs remain available when built-in movement or turning is disabled,
and are not consumed or zeroed when navigation is enabled.

Use the **?** link in the VR pane to return to this reference.

These inputs are supplied during the session and reset on exit:

| Uniform | Type | Description |
|---------|------|-------------|
| `iVRActive` | `bool` | Immersive session active |
| `iVRControllerPosition[2]` | `vec4` | Aim-ray origin in metres; w = 1 when tracked, 0 otherwise |
| `iVRControllerDirection[2]` | `vec4` | Normalized aim-ray direction; w = 1 when tracked |
| `iVRControllerButtons[2]` | `vec4` | First four gamepad button values (0–1) |
| `iVRControllerAxes[2]` | `vec4` | First four gamepad axes (-1–1) |
| `iVRControllerFaceButtons[2]` | `vec4` | Primary and secondary face-button values in xy; zw are zero |
| `iVRControllerTouches[2]` | `vec4` | Touch states for the first four buttons in xyzw (0 or 1) |
| `iVRControllerFaceTouches[2]` | `vec4` | Primary and secondary face-button touch states in xy; zw are zero |

For Quest controllers using the `xr-standard` mapping:

| Input | Shader access (`hand` is 0 for left, 1 for right) |
|---|---|
| Trigger | `iVRControllerButtons[hand].x` (analog 0–1) |
| Grip / squeeze | `iVRControllerButtons[hand].y` (analog 0–1) |
| Thumbstick click | `iVRControllerButtons[hand].w` |
| Thumbstick movement | `iVRControllerAxes[hand].zw` |
| X / Y | `iVRControllerFaceButtons[0].xy` |
| A / B | `iVRControllerFaceButtons[1].xy` |

The system/menu buttons are reserved by the headset and are not exposed.
Touch states are only available when supplied by the controller/runtime.

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
| Webcam input | Live camera feed |
| Microphone input | Real-time audio from microphone |
| AR | Immersive augmented-reality sessions |

## Volume inputs

To use a 3D texture, open a channel's settings, choose **Volumes**, and select a supported KTX2 file. Sample it with a three-component coordinate in GLSL, Slang, or WGSL. Shadertoy BIN files need conversion to KTX2 first. See [Volume inputs](volume-inputs.md) for downloadable samples, setup steps, and shader examples.

## Cubemap buffers

Shadertoy cubemap fragment code using `mainCubemap(out vec4, in vec2, in vec3, in vec3)` can be used in a Cubemap pass. Copy its source into a GLSL file, choose **+ New → Cubemap**, and bind that file and its channels. To sample the result in another pass, add a Buffer channel, select the cubemap pass in **Misc**, and use `texture(iChannel0, direction)` with a three-component direction. See [Cubemap buffers](../features/config-buffers.md#cubemap-buffers) for face sizes, feedback, and previews.
