# Vertex Shaders

Vertex shaders let you deform 3D geometry before it reaches the fragment shader. Each pass can have its own vertex shader, configured through the **Geometry** dropdown in the pass config.

## When to Use a Vertex Shader

A vertex shader is useful when you want to:

- **Deform geometry** — displace vertices of a sphere, cube, or plane with noise or waves
- **Animate 3D models** — modify a GLB mesh's vertex positions over time
- **Custom projections** — apply non-standard camera transforms per pass
- **Raymarching** — use 3D geometry as a bounding volume, then raymarch in the fragment shader

Fullscreen passes can also use vertex shaders for warping, custom projections, or screen-space effects without switching to 3D geometry.

## Configuring a Vertex Shader

1. In the config panel, select the pass you want to configure
2. In the **Vertex shader** section, enter a path to a `.vert.glsl` or `.vert.slang` file, or click **Create File** to generate a stub

**Double-click the "Vertex shader" title** to open the file in the [editor overlay](editor-overlay.md).

## The `mainVertex` Function

Your vertex shader must define a `mainVertex` function. It receives the mesh vertex data as `inout` parameters — modify them in-place to change the rendered geometry.

=== "GLSL"
    ```glsl
    void mainVertex(inout vec3 position, inout vec3 normal, inout vec2 uv) {
        // position: the vertex position in object space
        // normal:   the vertex normal in object space
        // uv:       the vertex texture coordinates
    }
    ```

=== "Slang"
    ```slang
    void mainVertex(inout float3 position, inout float3 normal, inout float2 uv) {
        // position: the vertex position in object space
        // normal:   the vertex normal in object space
        // uv:       the vertex texture coordinates
    }
    ```

## Geometry Context

The meaning of the `inout` parameters depends on the geometry type:

| Geometry | `position` | `normal` | `uv` |
|----------|-----------|----------|------|
| **Fullscreen** | Clip-space XY, Z=0 | `(0, 0, 1)` | 0–1 screen UV |
| **Plane** | XZ-plane object-space vertex | `(0, 1, 0)` | 0–1 grid UV |
| **Cube** | Unit-cube object-space vertex | Face normal | Face UV |
| **Sphere** | Unit-sphere object-space vertex | Surface normal | Latitude/longitude UV |
| **Model** | GLB mesh vertex position | Mesh vertex normal | Mesh UV |

For 3D geometry types (plane, cube, sphere, model), the engine applies the model, view, and projection matrices after `mainVertex` returns. For fullscreen, `position` is in clip-space coordinates directly and can be modified in-place for warping effects.

## Available Built-ins

All standard shader uniforms are available in the vertex shader:

| Built-in | Type (GLSL) | Type (Slang) | Description |
|----------|-------------|--------------|-------------|
| `iResolution` | `vec3` | `float3` | Canvas resolution in pixels |
| `iTime` | `float` | `float` | Shader time in seconds |
| `iTimeDelta` | `float` | `float` | Time since last frame |
| `iFrameRate` | `float` | `float` | Current frame rate |
| `iMouse` | `vec4` | `float4` | Mouse position and button state |
| `iFrame` | `int` | `int` | Current frame number |
| `iDate` | `vec4` | `float4` | Year, month, day, seconds |
| `iChannelTime` | `float[N]` | `float[N]` | Playback time per configured channel |
| `iSampleRate` | `float` | `float` | Audio sample rate |
| `iCameraPos` | `vec3` | `float3` | Camera position in world space |
| `iCameraDir` | `vec3` | `float3` | Camera forward direction |

Channel samplers (e.g. `sampleIChannel0(uv)`) and metadata accessors (e.g. `iCh0`) are also available. Vertex sampling uses mip level 0.

## Fragment Shader Access

When using 3D geometry, the fragment shader receives per-pixel interpolated values from the vertex output:

=== "GLSL"
    The `mainImage` signature is unchanged, but the following globals are available:
    - `iWorldPosition` — world-space position of the fragment
    - `iNormal` — world-space interpolated normal

=== "Slang"
    The `mainImage` signature is unchanged, but the following globals are available:
    - `iWorldPosition` — world-space position of the fragment
    - `iNormal` — world-space interpolated normal

## Examples

### Fullscreen

A fullscreen vertex shader can modify the clip-space vertex positions, e.g. for warping or custom projections:

=== "GLSL"
    ```glsl
    // warp.vert.glsl
    void mainVertex(inout vec3 position, inout vec3 normal, inout vec2 uv) {
        // position is in clip space; offset to create a ripple
        position.x += sin(uv.y * 20.0 + iTime) * 0.1;
        position.y += cos(uv.x * 20.0 + iTime) * 0.1;
    }
    ```

=== "Slang"
    ```slang
    // warp.vert.slang
    void mainVertex(inout float3 position, inout float3 normal, inout float2 uv) {
        float ripple = sin(uv.y * 20.0 + iTime) * 0.1;
        position.x += ripple;
        position.y += cos(uv.x * 20.0 + iTime) * 0.1;
    }
    ```

### Displacing a Plane

=== "GLSL"
    ```glsl
    // noise.vert.glsl
    void mainVertex(inout vec3 position, inout vec3 normal, inout vec2 uv) {
        float wave = sin(position.x * 5.0 + iTime) *
                     cos(position.z * 5.0 + iTime) * 0.2;
        position.y += wave;
    }
    ```

=== "Slang"
    ```slang
    // noise.vert.slang
    void mainVertex(inout float3 position, inout float3 normal, inout float2 uv) {
        float wave = sin(position.x * 5.0 + iTime) *
                     cos(position.z * 5.0 + iTime) * 0.2;
        position.y += wave;
    }
    ```

This displaces a plane's Y-coordinate with a time-varying wave pattern. The fragment shader receives the displaced geometry and shades it with interpolated normals.

## Next

[Channels](channels.md) — bind textures, video, audio, cubemaps, buffers, and keyboard input
