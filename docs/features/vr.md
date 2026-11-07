# VR shaders

View a 3D GLSL, Slang or WGSL shader on your desktop or in a WebXR headset. Add `mainVR` to define the scene using a ray origin and direction for each eye.

## Desktop preview

Use the desktop VR preview to look around a shader that defines `mainVR`, even without a headset.

1. Create a GLSL, Slang or WGSL shader and leave **Image → Geometry** set to **Fullscreen**.
2. Add both `mainImage` for the normal preview and `mainVR` for the view you can look around. The complete example below colors each viewing direction differently.
3. Open **VR** in the preview toolbar and enable **Desktop preview**. Move with **W / A / S / D**, move vertically with **Q / E**, and look by dragging or pressing **arrow keys**.
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

### Slang and WGSL

Slang and WGSL `mainVR` returns the colour, like their `mainImage`. Both use the WebGPU renderer and work in desktop preview and in headsets.

```slang
float4 mainImage(float2 fragCoord) {
    return float4(fragCoord / iResolution.xy, 0.5, 1.0);
}

float4 mainVR(float2 fragCoord, float3 rayOrigin, float3 rayDirection) {
    return float4(rayDirection * 0.5 + 0.5, 1.0);
}
```

```wgsl
fn mainImage(fragCoord: vec2f) -> vec4f {
    return vec4f(fragCoord / iResolution.xy, 0.5, 1.0);
}

fn mainVR(fragCoord: vec2f, rayOrigin: vec3f, rayDirection: vec3f) -> vec4f {
    return vec4f(rayDirection * 0.5 + 0.5, 1.0);
}
```

`mainVR` may also be defined in Common. It applies to the generated fullscreen Image entry; passes with native `entryPoints`, mesh or vertices geometry, and cubemap output keep using their own entries.

The **VR** pane can be opened even without a VR shader. Desktop preview and headset entry require a fullscreen Image shader defining `mainVR`; otherwise, the pane explains what is needed and disables those controls. Check the function signature and geometry setting if they remain disabled. Mesh passes continue to use `mainImage`.

VR opens a docked tool pane, like Config and Debug. **VR** is always available in
the hamburger options menu. When a compatible VR shader is detected, a **VR**
shortcut also appears at the far right of the preview toolbar.

`rayOrigin` is the camera position and `rayDirection` is a normalized direction in world space. In desktop preview, they follow `iCameraPos` and `iCameraDir` with a 90° vertical field of view. Dragging also updates `iMouse`, which matters if your shader uses mouse input for another effect.

## Headsets and controllers

To view the shader in a headset:

1. Open it in a browser with immersive WebXR support and connect a compatible headset.
2. Use a secure page (HTTPS, or localhost for a preview opened from VS Code).
3. Open **VR**, click **Enter VR**, and accept the browser's request to start the session.
4. In the VR pane, click **Exit VR** to return to the desktop view.

Movement and turning are **off by default**. **Headset navigation** switches on left-stick movement and your selected right-stick turning mode. Hold the left trigger to move three times faster, like holding Shift in desktop preview. Disable it to use both sticks for shader effects without moving or turning the camera. Physical head tracking stays active.
The **Movement speed** and **Turn speed** sliders apply to both desktop preview and headset navigation, and remain available when headset navigation is disabled. Movement speed uses metres per second. Turn speed sets desktop keyboard look and smooth headset turning in degrees per second; mouse-drag sensitivity scales with the same setting. Snap turning uses its angle instead. Under **Right stick turning**, choose **Snap** or **Smooth**. Use the main **Headset navigation** switch to disable movement and turning together. Snap is selected initially; navigation remains disabled until you switch it on. Snap turning requires returning the stick to the centre
before another turn. These settings, including the enable switch, are remembered in this browser. Switching navigation off preserves the chosen speed, turn mode and angle for when you enable it again. Movement follows where you look, including upward and downward when you tilt your head. Left/right strafing stays horizontal. Movement does not include collision detection. Physical head movement continues to work.
Exiting VR resets the virtual position and turning offset. Controller ray
positions and directions follow the same virtual movement as your view.

Slang and WGSL shaders render each eye with WebGPU, and the browser shows them through its WebGL headset layer, so the headset browser needs both WebGPU and WebXR.

If **Enter VR** is absent, check the browser, device, and page requirements above. You can still use the desktop VR preview without WebXR support. Headset and controller behavior can vary by device.

Each eye receives its tracked ray origin and projection in `mainVR`. Ray origins
use metres and follow the WebXR reference space (floor-relative when available)
plus any navigation offset you enable; rays
are normalized. `fragCoord` and `iResolution.xy` are local to the current eye.
Buffer passes advance once per headset frame. Pausing freezes shader time and
buffers while head tracking continues. Desktop camera controls do not move the
headset view.

## Controller Lab demo

[Download Controller Lab](../assets/shaders/vr-controller-lab.glsl) and open it as a GLSL shader. In the VR pane, switch **Headset navigation** off, then enter VR. Hold a control to change the sculpture; release it to restore the base effect. Outside a headset, the overview cycles through a showcase automatically.

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

## Controller shader inputs

`mainImage` and `mainVR` remain compatible with Shadertoy. The controller inputs
below are Shader Studio extensions. Slang and WGSL shaders can always use them.
To enable them in GLSL, add this line at the top of the shader (or Common code):

```glsl
#define SHADER_STUDIO_VR_INPUTS
```

Without that opt-in, the extra names are not injected into the compiled GLSL shader.
Shaders using these inputs require adapting before running on Shadertoy.
All raw inputs remain available when built-in movement or turning is disabled,
and are not consumed or zeroed when navigation is enabled.

The compact VR pane shows headset status beside **Enter VR**, switches for **Desktop preview** and **Headset navigation**, and **Snap** / **Smooth** turning buttons. **Reset** restores the defaults and disables navigation. Use the **?** link in the VR pane to open this guide. Close the pane with the VR toolbar button or its dock tab controls.

These inputs are supplied during the session and reset on exit:

In WGSL the arrays are `array<vec4f, 2>`; in Slang they are `float4[2]`.

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

