# Vertex Shaders

Vertex shaders let you deform 3D geometry before it reaches the fragment shader. Each pass can have its own vertex shader, configured through the **Geometry** dropdown in the pass config.

## When to Use a Vertex Shader

A vertex shader is useful when you want to:

- **Deform geometry** — displace vertices of a sphere, cube, or plane with noise or waves
- **Animate 3D models** — modify a GLB mesh's vertex positions over time
- **Custom projections** — apply non-standard camera transforms per pass
- **Raymarching** — use 3D geometry as a bounding volume, then raymarch in the fragment shader

Fullscreen passes can also use vertex shaders for warping, custom projections, or screen-space effects without switching to 3D geometry. To draw your own shapes, lines or points, use [Vertices geometry](#vertices-geometry).

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
| **Vertices** | 0 to `iVertexCount - 1` | `(0, 0, 0)`; you place every vertex | `(0, 0, 1)` | `(0, 0)` |
| **Plane** | Mesh vertex index | XZ-plane object-space vertex | `(0, 1, 0)` | 0–1 grid UV |
| **Cube** | Mesh vertex index | Unit-cube object-space vertex | Face normal | Face UV |
| **Sphere** | Mesh vertex index | Unit-sphere object-space vertex | Surface normal | Latitude/longitude UV |
| **Model** | Mesh vertex index | GLB mesh vertex position | Mesh vertex normal | Mesh UV |

For 3D geometry types (plane, cube, sphere, model), the engine applies the model, view, and projection matrices after `mainVertex` returns. Their draws are indexed, so `vertexIndex` is the index of the mesh vertex, and a vertex shared by several triangles may run more than once with the same index. `iVertexCount` is the number of distinct mesh vertices, so `vertexIndex` runs from 0 to `iVertexCount - 1` here too.

For fullscreen, `position` is in clip-space coordinates directly. A fullscreen pass always draws one oversized triangle with three vertices, `(-1, -1)`, `(3, -1)` and `(-1, 3)`, which covers the whole screen, and `iVertexCount` is 3. Assign `position` from `vertexIndex` to move the triangle yourself; pixels it no longer covers are cleared to opaque black. To draw your own shapes, lines or points, use [Vertices geometry](#vertices-geometry).

## Vertices Geometry

**Vertices** geometry draws as many vertices as you ask for, with no mesh behind them: `mainVertex` decides where every vertex goes. Select **Vertices** in the **Geometry** dropdown, or set it in `.sha.json`:

```json
"geometry": { "type": "vertices", "vertexCount": 6, "topology": "triangle-strip", "space": "clip" }
```

| Field | Values | Default |
|-------|--------|---------|
| `vertexCount` | Whole number from 1 to 2147483647 | `3` |
| `topology` | `triangle-list`, `triangle-strip`, `line-list`, `line-strip`, `point-list` | `triangle-list` |
| `space` | `world`, `clip` | `world` |

The config panel shows them as **Vertices**, **Topology** and **Space**. Switching the pass to another geometry and back restores them for the rest of the session; they are never written for other geometry.

`mainVertex` runs once per vertex with `vertexIndex` from 0 to `vertexCount - 1`; read the count in the shader as `iVertexCount`. Every vertex starts at `(0, 0, 0)` with normal `(0, 0, 1)` and uv `(0, 0)`, so a pass without a vertex shader draws nothing. Place the vertices in shader code, for example from an array or from maths over `vertexIndex`. `topology` says how consecutive vertices join up: every three vertices make a triangle (`triangle-list`), each new vertex makes a triangle with the two before it (`triangle-strip`), every two make a line (`line-list`), each new vertex continues one line (`line-strip`), or each vertex is a single point (`point-list`).

Out-of-range counts, other topologies, and any of these fields on fullscreen geometry are config errors. Plane, cube, sphere, and model geometry reject `vertexCount` and `space`, and accept only the mesh topologies below.

### World and clip space

`space` says what the position you write means.

- **`world`** (the default) treats your positions like the vertices of a plane or cube: points in the 3D scene. The orbit camera looks at them, so dragging the preview moves around your shape, and nearer surfaces hide farther ones. `mainImage` receives `uv * iResolution`, so whatever you write to `uv` comes through, and `iWorldPosition`, `iNormal` and `iCameraPosition` work as they do for meshes. Use it for 3D shapes, particle clouds and procedural meshes.
- **`clip`** treats your positions as places on the screen: `(-1, -1)` is the bottom-left corner and `(1, 1)` the top-right, whatever the camera does. `mainImage` receives the real pixel coordinate, as in a fullscreen pass; read the interpolated vertex coordinate separately as `iVertexUv`. Use it for HUDs, waveforms, graphs and 2D shapes that should stay put. Keep `z` between 0 and 1: WebGPU clips anything outside that range, and WebGL accepts it. Shapes are drawn in the order you emit them, later ones on top, because the depth test is off by default in clip space.

### Limitations

- **Lines and points are 1px wide.** WebGPU has no line width or point size, and point size is not portable in WebGL, so lines and points always rasterise at one pixel. Build thick lines and sized particles from triangles instead.
- **There are no geometry shaders.** WebGL and WebGPU cannot create vertices on the GPU. Use vertex pulling: draw a fixed number of vertices per item and derive the item and corner from `vertexIndex`. For example, particles as quads use 6 vertices each; see [Additive particles](#additive-particles).
- **Debugging covers the whole pass.** Variable capture, pixel debugging, and pause inspection evaluate `mainImage` over every pixel of a synthetic fullscreen pass, including pixels no triangle, line, or point covers. In that synthetic pass, `iVertexUv` is the normalised capture-grid coordinate rather than the original geometry's interpolated value, `iFrontFacing` is `true`, and `iInstanceIndex` is 0.

## Mesh Topology

Plane, cube, sphere, and model geometry take a `topology` too, for wireframe and point-cloud views of the mesh:

```json
"geometry": { "type": "sphere", "topology": "line-list" }
```

| `topology` | Draws |
|------------|-------|
| `triangle-list` (default) | The mesh's triangles |
| `line-list` | A wireframe: each unique edge of the triangles once |
| `point-list` | Each unique vertex once, as a 1px point |

The vertex shader runs as usual, with `vertexIndex` the mesh vertex index, so a displaced or animated mesh stays displaced in every view. Strip topologies do not apply to meshes. Lines and points are 1px wide and are never culled, so `cull` has no effect on them. In the config panel, the Topology control under Geometry offers Triangles, Wireframe and Points for meshes.

## Instancing

Add `instanceCount` to any geometry except fullscreen to draw it many times in one draw call. The vertex shader runs for every vertex of every copy, and `iInstanceIndex` says which copy it is on, from 0 to `iInstanceCount - 1`. Use it to offset, rotate or colour each copy. This works for meshes too, where vertex pulling cannot: a field of 100 cubes is one cube drawn 100 times.

```json
"geometry": { "type": "cube", "instanceCount": 100 }
```

| Field | Values | Default |
|-------|--------|---------|
| `instanceCount` | Whole number from 1 to 2147483647 | `1` |

`vertexIndex` repeats the same range for every copy. `iInstanceIndex` is also available in `mainImage`, holding the copy that drew the fragment, so each copy can be shaded differently. Fullscreen passes always draw one copy: `iInstanceCount` is 1 and `iInstanceIndex` is 0, and `instanceCount` on fullscreen geometry is a config error. In the config panel, set the count with the Instances control under Geometry.

=== "GLSL"
    ```glsl
    // cubes.vert.glsl: a 10 × 10 grid of small cubes
    void mainVertex(int vertexIndex, inout vec3 position, inout vec3 normal, inout vec2 uv) {
        vec2 cell = vec2(iInstanceIndex % 10, iInstanceIndex / 10) - 4.5;
        position = position * 0.08 + vec3(cell.x, 0.0, cell.y) * 0.2;
    }
    ```

=== "Slang"
    ```slang
    // cubes.vert.slang: a 10 × 10 grid of small cubes
    void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {
        float2 cell = float2(iInstanceIndex % 10u, iInstanceIndex / 10u) - 4.5;
        position = position * 0.08 + float3(cell.x, 0.0, cell.y) * 0.2;
    }
    ```

=== "WGSL"
    ```wgsl
    // cubes.vert.wgsl: a 10 × 10 grid of small cubes
    fn mainVertex(vertexIndex: u32, position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) {
        let cell = vec2f(f32(iInstanceIndex % 10u), f32(iInstanceIndex / 10u)) - 4.5;
        *position = *position * 0.08 + vec3f(cell.x, 0.0, cell.y) * 0.2;
    }
    ```

## Camera Matrices

`iViewMatrix`, `iProjectionMatrix` and `iViewProjection` are the orbit camera that plane, cube, sphere, model and world-space vertices are drawn with, in the vertex and fragment shader of every pass. `iViewProjection` is `iProjectionMatrix * iViewMatrix`; there is no model matrix, because meshes are drawn at the origin unscaled. The projection has a 45° vertical field of view, near plane 0.01 and far plane 100, and follows the pass's aspect ratio.

Use them in clip space to project some points yourself while keeping control of the rest, for example a 3D shape with a screen-space overlay. Divide by `w` to get the position a clip-space vertex writes:

=== "GLSL"
    ```glsl
    vec4 clip = iViewProjection * vec4(worldPoint, 1.0);
    position = clip.xyz / clip.w;
    ```

=== "Slang"
    ```slang
    float4 clip = mul(iViewProjection, float4(worldPoint, 1.0));
    position = clip.xyz / clip.w;
    ```

=== "WGSL"
    ```wgsl
    let clip = iViewProjection * vec4f(worldPoint, 1.0);
    *position = clip.xyz / clip.w;
    ```

Clip-space depth follows the renderer: `z` runs from -1 to 1 in GLSL (WebGL) and from 0 to 1 in Slang and WGSL (WebGPU), so the projected `z` is valid in either. Because the hook writes a `vec3` with `w = 1`, primitives that cross behind the camera are not clipped the way world-space geometry is; keep projected points in front of the camera.

## Render Settings

Image and buffer passes have render settings next to `geometry`, under **Rendering** and **Depth testing** in the config panel. Compute and Common passes do not accept them.

```json
"Image": {
  "geometry": { "type": "vertices", "vertexCount": 6000 },
  "clear": [0, 0, 0, 0],
  "blend": "additive",
  "depth": { "test": true, "write": false, "compare": "less" },
  "cull": "back",
  "samples": 4
}
```

### Clear Colour

`clear` is the RGBA colour the pass starts with each frame. Its four components range from 0 to 1, and the default is opaque black, `[0, 0, 0, 1]`. Use `[0, 0, 0, 0]` for a transparent layer that a later pass can composite by alpha. The setting works with every geometry, including fullscreen, and is applied before blending.

### Blend

`blend` decides what happens when a pass draws over a pixel it already drew this frame. Each pass starts every frame with its `clear` colour, so blending combines shapes with that background and with earlier shapes in the same draw.

| Value | Result | Use it for |
|-------|--------|-----------|
| `none` (default) | The new colour replaces the old one | Opaque shapes |
| `alpha` | Mixed by the new colour's alpha: `new × a + old × (1 − a)` | Soft, see-through shapes |
| `premultiplied` | `new + old × (1 − a)`, for colours already multiplied by alpha | Layered 2D drawing |
| `additive` | The colours add up | Glows, sparks and light |

`blend` works with every geometry, fullscreen included. A buffer pass renders into a 32-bit float texture by default; on a GPU that cannot blend 32-bit floats (no WebGPU `float32-blendable`, no WebGL `EXT_float_blend`), a blended buffer pass renders into 16-bit floats instead and the preview shows a warning.

### Depth

These controls appear in the **Depth testing** section of the pass config panel.

`depth` controls how nearer surfaces hide farther ones. It applies to vertices, plane, cube, sphere and model geometry; fullscreen passes have no depth buffer, so `depth` there is a config error.

| Field | Values | Default |
|-------|--------|---------|
| `test` | `true`, `false` | `true`; `false` for vertices in clip space |
| `write` | `true`, `false` | `true` |
| `compare` | `never`, `less`, `equal`, `less-equal`, `greater`, `not-equal`, `greater-equal`, `always` | `less` |

With `test` on, a fragment is drawn only if its depth passes `compare` against what is already there; `less` keeps the nearest surface. With `write` on, drawn fragments record their depth for later ones to test against. Turn `write` off for transparent or additive effects that should not hide each other. The depth buffer starts each frame at the far value, or at the near value for `greater` and `greater-equal` so those comparisons can pass.

### Cull

`cull` skips triangles facing one way: `none` (default) draws both sides, `back` skips triangles facing away from the camera, and `front` skips those facing it. A triangle faces the camera when its corners go counter-clockwise on screen, as on the built-in meshes and glTF models. Culling `back` saves work on closed shapes; culling `front` shows the inside of a cube. Lines and points are never culled, and `cull` on fullscreen geometry is a config error.

### Antialiasing

`samples` turns on multisample antialiasing for rasterised geometry: `1` (default) is off and `4` smooths the edges of triangles, lines and points. It applies to vertices, plane, cube, sphere and model geometry; fullscreen passes antialias in `mainImage` instead, so `samples` on fullscreen geometry is a config error. In the config panel it is the Antialiasing control under Rendering.

Each pass draws into a multisampled target that is resolved into the pass output, so later passes, variable capture and the pixel inspector all see the smoothed image. WebGPU cannot multisample 32-bit float textures, so a multisampled buffer pass stores `rgba16float` in both renderers and reports a warning when it would otherwise be `rgba32float`. Multisampling uses four times the memory of the pass's colour and depth targets, so keep it to the passes that need it.

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
| `iVertexCount` | `int` | `uint` | `u32` | Vertices drawn by the pass: the vertices `vertexCount`, 3 for fullscreen, or the mesh vertex count |
| `iInstanceCount` | `int` | `uint` | `u32` | Copies drawn by the pass: the geometry's `instanceCount` (default 1), or 1 for fullscreen |
| `iInstanceIndex` | `int` | `uint` | `u32` | The copy being drawn, from 0 to `iInstanceCount - 1`; see [Instancing](#instancing) |
| `iViewMatrix` | `mat4` | `float4x4` | `mat4x4f` | The orbit camera's view matrix; see [Camera matrices](#camera-matrices) |
| `iProjectionMatrix` | `mat4` | `float4x4` | `mat4x4f` | The orbit camera's projection at the pass's aspect ratio |
| `iViewProjection` | `mat4` | `float4x4` | `mat4x4f` | `iProjectionMatrix * iViewMatrix` |

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

Every geometry exposes the post-`mainVertex`, perspective-correct interpolated UV as `iVertexUv`. Three-dimensional geometry, including vertices in world space, also exposes its world-space context:

`iFrontFacing` reports whether the rasterized primitive is front-facing for vertices and mesh geometry. It is always `true` for fullscreen passes and for the synthetic fullscreen grid used by variable capture.

=== "GLSL"
    The `mainImage` signature is unchanged, but the following globals are available:
    - `iVertexUv` — interpolated `uv` for every geometry and space
    - `iFrontFacing` — whether the current primitive is front-facing
    - `iWorldPosition` — world-space position of the fragment
    - `iNormal` — world-space interpolated normal
    - `iCameraPosition` — world-space camera position

=== "Slang"
    The `mainImage` signature is unchanged, but the following globals are available:
    - `iVertexUv` — interpolated `uv` for every geometry and space
    - `iFrontFacing` — whether the current primitive is front-facing
    - `iWorldPosition` — world-space position of the fragment
    - `iNormal` — world-space interpolated normal
    - `iCameraPosition` — world-space camera position

=== "WGSL"
    The `mainImage` signature is unchanged, but the following globals are available:
    - `iVertexUv: vec2<f32>` — interpolated `uv` for every geometry and space
    - `iFrontFacing: bool` — whether the current primitive is front-facing
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

### Vertices: a Clip-Space Hexagon

Six points joined as a triangle strip make a hexagon that stays in the middle of the screen. Set the pass geometry to `{ "type": "vertices", "vertexCount": 6, "topology": "triangle-strip", "space": "clip" }`:

=== "GLSL"
    ```glsl
    // hexagon.vert.glsl
    const vec2 points[6] = vec2[6](
        vec2( 0.25, 0.433), vec2(-0.25, 0.433),
        vec2( 0.5,  0.0),   vec2(-0.5,  0.0),
        vec2( 0.25,-0.433), vec2(-0.25,-0.433)
    );

    void mainVertex(int vertexIndex, inout vec3 position, inout vec3 normal, inout vec2 uv) {
        position = vec3(points[vertexIndex], 0.0);
    }
    ```

=== "Slang"
    ```slang
    // hexagon.vert.slang
    static const float2 points[6] = {
        float2( 0.25, 0.433), float2(-0.25, 0.433),
        float2( 0.5,  0.0),   float2(-0.5,  0.0),
        float2( 0.25,-0.433), float2(-0.25,-0.433)
    };

    void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {
        position = float3(points[vertexIndex], 0.0);
    }
    ```

=== "WGSL"
    ```wgsl
    // hexagon.vert.wgsl
    fn mainVertex(vertexIndex: u32, position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) {
        var points = array<vec2f, 6>(
            vec2f( 0.25, 0.433), vec2f(-0.25, 0.433),
            vec2f( 0.5,  0.0),   vec2f(-0.5,  0.0),
            vec2f( 0.25,-0.433), vec2f(-0.25,-0.433)
        );
        *position = vec3f(points[vertexIndex], 0.0);
    }
    ```

The same shape as a `triangle-list` needs 12 vertices, three per triangle. Index the same points with `vertexIndex / 3 + vertexIndex % 3` (`3u` in Slang and WGSL) to get triangles (0, 1, 2), (1, 2, 3), (2, 3, 4) and (3, 4, 5).

Use `iVertexCount` to spread vertices without hard-coding the count, for example a `line-strip` across the screen:

```glsl
position = vec3(-0.75 + 1.5 * float(vertexIndex) / float(iVertexCount - 1), 0.0, 0.0);
```

### Vertices: a 3D Shape in World Space

In world space the same idea builds 3D objects the camera can orbit. This draws a tetrahedron as 12 vertices (four triangles) with `{ "type": "vertices", "vertexCount": 12 }`, setting each face's normal so `mainImage` can light it with `iNormal`:

=== "GLSL"
    ```glsl
    // tetrahedron.vert.glsl
    const vec3 corners[4] = vec3[4](vec3(1, 1, 1), vec3(1, -1, -1), vec3(-1, 1, -1), vec3(-1, -1, 1));
    const int faces[12] = int[12](0, 1, 2,  0, 3, 1,  0, 2, 3,  1, 3, 2);

    void mainVertex(int vertexIndex, inout vec3 position, inout vec3 normal, inout vec2 uv) {
        int face = vertexIndex / 3;
        vec3 a = corners[faces[face * 3]];
        vec3 b = corners[faces[face * 3 + 1]];
        vec3 c = corners[faces[face * 3 + 2]];
        position = corners[faces[vertexIndex]] * 0.5;
        normal = normalize(cross(b - a, c - a));
    }
    ```

=== "Slang"
    ```slang
    // tetrahedron.vert.slang
    static const float3 corners[4] = { float3(1, 1, 1), float3(1, -1, -1), float3(-1, 1, -1), float3(-1, -1, 1) };
    static const uint faces[12] = { 0, 1, 2,  0, 3, 1,  0, 2, 3,  1, 3, 2 };

    void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {
        uint face = vertexIndex / 3u;
        float3 a = corners[faces[face * 3u]];
        float3 b = corners[faces[face * 3u + 1u]];
        float3 c = corners[faces[face * 3u + 2u]];
        position = corners[faces[vertexIndex]] * 0.5;
        normal = normalize(cross(b - a, c - a));
    }
    ```

=== "WGSL"
    ```wgsl
    // tetrahedron.vert.wgsl
    fn mainVertex(vertexIndex: u32, position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) {
        var corners = array<vec3f, 4>(vec3f(1, 1, 1), vec3f(1, -1, -1), vec3f(-1, 1, -1), vec3f(-1, -1, 1));
        var faces = array<u32, 12>(0, 1, 2,  0, 3, 1,  0, 2, 3,  1, 3, 2);
        let face = vertexIndex / 3u;
        let a = corners[faces[face * 3u]];
        let b = corners[faces[face * 3u + 1u]];
        let c = corners[faces[face * 3u + 2u]];
        *position = corners[faces[vertexIndex]] * 0.5;
        *normal = normalize(cross(b - a, c - a));
    }
    ```

```glsl
// tetrahedron.glsl
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    float light = max(dot(iNormal, normalize(vec3(0.5, 1.0, 0.3))), 0.0);
    fragColor = vec4(vec3(0.2 + 0.8 * light), 1.0);
}
```

Each face winds counter-clockwise seen from outside, so `"cull": "back"` skips the faces turned away from the camera.

### Additive Particles

Particles are quads built from 6 vertices each (vertex pulling). With additive blending, overlapping particles add up to a glow; with depth writes off, a particle in front never hides one behind it. This is 1000 particles in world space:

```json
"Image": {
  "vertex": "particles.vert.glsl",
  "geometry": { "type": "vertices", "vertexCount": 6000 },
  "blend": "additive",
  "depth": { "write": false }
}
```

=== "GLSL"
    ```glsl
    // particles.vert.glsl
    const vec2 corners[6] = vec2[6](vec2(-1, -1), vec2(1, -1), vec2(-1, 1), vec2(-1, 1), vec2(1, -1), vec2(1, 1));

    void mainVertex(int vertexIndex, inout vec3 position, inout vec3 normal, inout vec2 uv) {
        float id = float(vertexIndex / 6);
        vec2 corner = corners[vertexIndex % 6];
        vec3 centre = vec3(sin(id * 1.7 + iTime), cos(id * 2.3 + iTime * 0.5), sin(id * 0.9)) * 0.8;
        position = centre + vec3(corner * 0.03, 0.0);
        uv = corner * 0.5 + 0.5;
    }
    ```

=== "Slang"
    ```slang
    // particles.vert.slang
    static const float2 corners[6] = { float2(-1, -1), float2(1, -1), float2(-1, 1), float2(-1, 1), float2(1, -1), float2(1, 1) };

    void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {
        float id = float(vertexIndex / 6u);
        float2 corner = corners[vertexIndex % 6u];
        float3 centre = float3(sin(id * 1.7 + iTime), cos(id * 2.3 + iTime * 0.5), sin(id * 0.9)) * 0.8;
        position = centre + float3(corner * 0.03, 0.0);
        uv = corner * 0.5 + 0.5;
    }
    ```

=== "WGSL"
    ```wgsl
    // particles.vert.wgsl
    fn mainVertex(vertexIndex: u32, position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) {
        var corners = array<vec2f, 6>(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1));
        let id = f32(vertexIndex / 6u);
        let corner = corners[vertexIndex % 6u];
        let centre = vec3f(sin(id * 1.7 + iTime), cos(id * 2.3 + iTime * 0.5), sin(id * 0.9)) * 0.8;
        *position = centre + vec3f(corner * 0.03, 0.0);
        *uv = corner * 0.5 + 0.5;
    }
    ```

In world space `mainImage` receives `uv * iResolution`, so divide by `iResolution.xy` to get the particle's own 0–1 coordinate back and fade its edges:

```glsl
// particles.glsl
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    float glow = smoothstep(0.5, 0.0, length(uv - 0.5));
    fragColor = vec4(vec3(1.0, 0.6, 0.2) * glow * 0.5, 1.0);
}
```

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
