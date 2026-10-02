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
2. In the **Vertex shader** section, enter a path to a `.vert.glsl`, `.vert.slang`, or `.vert.wgsl` file, or click **Create File** to generate a stub

**Double-click the "Vertex shader" title** to open the file in the [editor overlay](editor-overlay.md).

## The `mainVertex` Function

Your vertex shader must define a `mainVertex` function. It receives the index of the vertex being processed, followed by the vertex data as `inout` parameters — modify them in-place to change the rendered geometry.

=== "GLSL"
    ```glsl
    void mainVertex(int vertexIndex, inout vec3 position, inout vec3 normal, inout vec2 uv) {
        // vertexIndex: the vertex being processed (gl_VertexID)
        // position: the vertex position in object space
        // normal:   the vertex normal in object space
        // uv:       the vertex texture coordinates
    }
    ```

=== "Slang"
    ```slang
    void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {
        // vertexIndex: the vertex being processed (SV_VertexID)
        // position: the vertex position in object space
        // normal:   the vertex normal in object space
        // uv:       the vertex texture coordinates
    }
    ```

=== "WGSL"
    ```wgsl
    fn mainVertex(vertexIndex: u32, position: ptr<function, vec3<f32>>, normal: ptr<function, vec3<f32>>, uv: ptr<function, vec2<f32>>) {
        // vertexIndex: the vertex being processed (@builtin(vertex_index))
        // position: the vertex position in object space
        // normal:   the vertex normal in object space
        // uv:       the vertex texture coordinates
    }
    ```

    WGSL has no `inout` parameters, so the hook receives pointers. Dereference them to read or modify the vertex data: `(*position).y += 0.1;`. Changes to these values affect the rendered geometry, as with `inout` in GLSL and Slang.

## Geometry Context

The meaning of the parameters depends on the geometry type:

| Geometry | `vertexIndex` | `position` | `normal` | `uv` |
|----------|---------------|-----------|----------|------|
| **Fullscreen** | 0, 1, 2 | Clip-space triangle corner, Z=0 | `(0, 0, 1)` | Corner × 0.5 + 0.5 |
| **Plane** | Mesh vertex index | XZ-plane object-space vertex | `(0, 1, 0)` | 0–1 grid UV |
| **Cube** | Mesh vertex index | Unit-cube object-space vertex | Face normal | Face UV |
| **Sphere** | Mesh vertex index | Unit-sphere object-space vertex | Surface normal | Latitude/longitude UV |
| **Model** | Mesh vertex index | GLB mesh vertex position | Mesh vertex normal | Mesh UV |

For 3D geometry types (plane, cube, sphere, model), the engine applies the model, view, and projection matrices after `mainVertex` returns. Their draws are indexed, so `vertexIndex` is the index of the mesh vertex, and a vertex shared by several triangles may run more than once with the same index.

For fullscreen, `position` is in clip-space coordinates directly. A fullscreen pass draws one oversized triangle with three vertices, `(-1, -1)`, `(3, -1)` and `(-1, 3)`, which covers the whole screen. Assign `position` from `vertexIndex` to place the triangle yourself; pixels it no longer covers are cleared to opaque black.

## Available Built-ins

All standard shader uniforms are available in the vertex shader:

| Built-in | Type (GLSL) | Type (Slang) | Type (WGSL) | Description |
|----------|-------------|--------------|-------------|-------------|
| `iResolution` | `vec3` | `float3` | `vec3f` | Canvas resolution in pixels |
| `iTime` | `float` | `float` | `f32` | Shader time in seconds |
| `iTimeDelta` | `float` | `float` | `f32` | Time since last frame |
| `iFrameRate` | `float` | `float` | `f32` | Current frame rate |
| `iMouse` | `vec4` | `float4` | `vec4f` | Mouse position and button state |
| `iFrame` | `int` | `int` | `i32` | Current frame number |
| `iDate` | `vec4` | `float4` | `vec4f` | Year, month, day, seconds |
| `iChannelTime` | `float[N]` | — | — | Playback time per configured channel (use channel metadata in Slang and WGSL) |
| `iSampleRate` | `float` | `float` | `f32` | Audio sample rate |
| `iCameraPos` | `vec3` | `float3` | `vec3f` | Camera position in world space |
| `iCameraDir` | `vec3` | `float3` | `vec3f` | Camera forward direction |

=== "GLSL"
    Configured channels use the existing samplers and metadata accessors, such as `iChannel0` and `iCh0`.

=== "Slang"
    Configured inputs are available as `<config key>`, for example `iChannel0` or `noise`. Slang channel methods are available in all shader stages. In a vertex shader, use explicit-level sampling such as `iChannel0.SampleLevel(textureUv, 0.0)`; `Sample(uv)` is fragment-only.

=== "WGSL"
    Configured inputs expose metadata as `<config key>` and native handles as
    `<config key>Texture` and `<config key>Sampler`. In a vertex shader, use an
    explicit level, for example
    `sample2DLevel(iChannel0Texture, iChannel0Sampler, textureUv, 0.0)`;
    `sample2D` is fragment-only.

## Fragment Shader Access

When using 3D geometry, the fragment shader receives per-pixel interpolated values from the vertex output:

=== "GLSL"
    The `mainImage` signature is unchanged, but the following globals are available:
    - `iWorldPosition` — world-space position of the fragment
    - `iNormal` — world-space interpolated normal
    - `iCameraPosition` — world-space camera position

=== "Slang"
    The `mainImage` signature is unchanged, but the following globals are available:
    - `iWorldPosition` — world-space position of the fragment
    - `iNormal` — world-space interpolated normal
    - `iCameraPosition` — world-space camera position

=== "WGSL"
    The `mainImage` signature is unchanged, but the following globals are available:
    - `iWorldPosition: vec3<f32>` — world-space position of the fragment
    - `iNormal: vec3<f32>` — world-space interpolated normal
    - `iCameraPosition: vec3<f32>` — world-space camera position

## Examples

### Fullscreen: a Procedural Triangle

A fullscreen vertex shader can place its three vertices from `vertexIndex`, for example from an array of points in clip space:

=== "GLSL"
    ```glsl
    // triangle.vert.glsl
    const vec2 points[3] = vec2[3](vec2(0.0, 0.5), vec2(-0.5, -0.5), vec2(0.5, -0.5));

    void mainVertex(int vertexIndex, inout vec3 position, inout vec3 normal, inout vec2 uv) {
        position = vec3(points[vertexIndex], 0.0);
    }
    ```

=== "WGSL"
    ```wgsl
    // triangle.vert.wgsl
    fn mainVertex(vertexIndex: u32, position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) {
        var points = array<vec2f, 3>(vec2f(0.0, 0.5), vec2f(-0.5, -0.5), vec2f(0.5, -0.5));
        *position = vec3f(points[vertexIndex], 0.0);
    }
    ```

=== "Slang"
    ```slang
    // triangle.vert.slang
    static const float2 points[3] = { float2(0.0, 0.5), float2(-0.5, -0.5), float2(0.5, -0.5) };

    void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {
        position = float3(points[vertexIndex], 0.0);
    }
    ```

`mainImage` shades only the pixels inside the triangle; the rest of the pass is cleared to black.

### Displacing a Plane

=== "GLSL"
    ```glsl
    // noise.vert.glsl
    void mainVertex(int vertexIndex, inout vec3 position, inout vec3 normal, inout vec2 uv) {
        float wave = sin(position.x * 5.0 + iTime) *
                     cos(position.z * 5.0 + iTime) * 0.2;
        position.y += wave;
    }
    ```

=== "Slang"
    ```slang
    // noise.vert.slang
    void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {
        float wave = sin(position.x * 5.0 + iTime) *
                     cos(position.z * 5.0 + iTime) * 0.2;
        position.y += wave;
    }
    ```

=== "WGSL"
    ```wgsl
    // noise.vert.wgsl
    fn mainVertex(vertexIndex: u32, position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) {
        let wave = sin((*position).x * 5.0 + iTime) *
                   cos((*position).z * 5.0 + iTime) * 0.2;
        (*position).y += wave;
    }
    ```

This displaces a plane's Y-coordinate with a time-varying wave pattern. The fragment shader receives the displaced geometry and shades it with interpolated normals.

## Next

[Channels](channels.md) — bind textures, video, audio, cubemaps, buffers, and keyboard input
