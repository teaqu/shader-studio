# 3D Object Preview

Shader Studio can project an existing Shadertoy-style fragment shader onto a cube, sphere, or plane. This is useful for checking how a 2D effect reads on a game-style mesh without rewriting the shader or adding a vertex stage.

Use the **2D / 3D** switch in the top-left of the preview. The same `mainImage` shader, uniforms, channel inputs, and buffer passes continue to run in either mode. Only the final Image pass is mapped onto the selected mesh.

## Navigate the scene

- **Drag** to orbit around the object.
- **Shift-drag** or **middle-drag** to pan.
- **Scroll** to move the camera closer or farther away.
- Select **Reset view** to restore the isometric camera.

The scene includes an optional ground grid and RGB world axes. The toolbar's canvas **Zoom** control is disabled in 3D mode because scroll controls the perspective camera instead.

## Object and mapping controls

The quick controls select a **Cube**, **Sphere**, or **Plane**, plus either:

- **Unlit** — shows the shader's output colour without lighting changes.
- **Lit** — applies simple directional lighting so the mesh shape is easier to read.

Open **3D settings** for:

- **Mapping scale** — tiles or stretches the shader independently across U and V.
- **Mapping offset** — slides the shader over the mesh.
- **Mapping rotation** — rotates the UV projection in degrees.
- **Wrap** — repeat, mirror, or clamp coordinates outside the normal UV range.
- **Position, rotation, and scale** — moves and transforms the preview object.
- **Grid and axes** — toggles scene guides.

These choices are local preview preferences. They are saved in the browser or webview and are not written into the shader's `.sha.json` configuration.

## What this mode represents

3D Object Preview is a material preview for a 2D fragment shader. Shader Studio evaluates `mainImage` using the mesh's mapped UV coordinates, so it is useful for judging scale, seams, distortion, repetition, colour, and basic lighting on a Unity-style object.

It does not yet run a custom vertex shader, deform geometry, import models, or provide a full material system with PBR, shadows, and engine-specific lighting. Those belong to a future native 3D shader mode.

Pixel Inspector and variable capture are unavailable while the 3D scene owns the canvas. Their settings are preserved and become active again when you return to 2D. Screenshots and recordings capture whichever preview mode is currently visible.

Both GLSL/WebGL and Slang/WebGPU previews support the same 3D controls.
