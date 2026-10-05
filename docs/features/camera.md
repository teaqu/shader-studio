# 3D Camera

When a pass uses 3D geometry (plane, cube, sphere, or GLB model), a free-fly camera replaces the fixed 2D view. You can orbit and move the camera to inspect your shader from any angle.

The camera activates automatically when a pass with 3D geometry is visible.

## Controls

| Action | Input |
|--------|-------|
| **Orbit** | Left mouse button drag |
| **Move forward / back** | `W` / `S` |
| **Strafe left / right** | `A` / `D` |
| **Up / down** | `Q` / `E` |
| **Sprint** | Hold `Shift` while moving |
| **Keyboard look** | Arrow keys |

Orbit uses yaw (around world Y axis) and pitch (clamped to ±90° to avoid flipping). Movement is relative to the camera's current orientation — pressing `W` moves toward wherever you're looking.

## Camera Uniforms

`iCameraPos` and `iCameraDir` are available in every shader, including 2D fullscreen passes:

| Uniform | Type (GLSL) | Type (Slang) | Type (WGSL) | Description |
|---------|-------------|--------------|-------------|-------------|
| `iCameraPos` | `vec3` | `float3` | `vec3<f32>` | Camera position in world space |
| `iCameraDir` | `vec3` | `float3` | `vec3<f32>` | Camera forward direction (normalised) |

In 2D fullscreen mode the camera defaults to `(0, 0, 0)` looking along `(0, 0, 1)` — still useful as a fixed ray origin and direction for raymarching. When a pass uses 3D geometry, the camera transforms update with your mouse and keyboard input.


## Per-Pass Camera Transform

For plane, cube, sphere, and model geometry, **Geometry → Use viewer camera** controls whether the viewer transforms the mesh. It applies to GLSL, WGSL, and Slang. Disable it when your vertex code already supplies clip-space positions. Native WGSL/Slang stages own their projection and can read the viewer matrices when enabled; those matrices become identity when disabled.

The pass choice overrides the shader-wide camera setting and the global default. **Use default** clears the pass override. The global preference is available in standalone Settings and VS Code as `shader-studio.webgpu.useViewerCamera`. For procedural **Vertices** geometry, **Space** selects world or clip coordinates instead.

## Next

[Vertex Shaders](vertex-shaders.md) — deform 3D geometry before it reaches the fragment shader
