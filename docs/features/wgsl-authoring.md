# WGSL Shaders

WGSL (WebGPU Shading Language) supports image shaders, vertex shaders, storage buffers, and compute passes.

WGSL shaders require WebGPU support in your browser and device.

## Native entry points and shared files

WGSL and Slang can keep vertex, fragment, and compute entry points in one source file. Choose the **Vertex function** and **Fragment function** independently at the bottom of Image or buffer settings. Either stage can use an annotated function while the other keeps its generated adapter. Compute settings have their own entry-point selector. Discovery reads the stage annotations in the source; saving a selection writes `entryPoints` in `.sha.json`. An omitted vertex selection uses the built-in vertex shader (and any configured `mainVertex` hook); an omitted fragment selection uses `mainImage`. Unselected native functions do not replace those adapters. Discovery does not create passes automatically.

```wgsl
@vertex fn fullscreen(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
    let p = array(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
    return vec4f(p[index], 0, 1);
}

@fragment fn image(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
    return vec4f(pixel.xy / iResolution.xy, 0.5, 1);
}

@compute @workgroup_size(1)
fn advance(@builtin(global_invocation_id) id: vec3u) {
    // Update configured storage here.
}
```

```json
{
  "version": "1.0",
  "webgpu": { "defaultRenderAuthoring": "native" },
  "passes": {
    "ComputeAdvance": {
      "type": "compute", "path": "shared.wgsl",
      "entryPoints": { "compute": "advance" },
      "dispatch": { "count": 1 }
    },
    "BufferA": {
      "path": "shared.wgsl",
      "entryPoints": { "vertex": "fullscreen", "fragment": "image" }
    },
    "Image": { "entryPoints": { "vertex": "fullscreen", "fragment": "image" } }
  }
}
```

Open `shared.wgsl` as the Image source in this example. Each pass compiles its selected stages and reachable helpers using that pass’s configured channels, uniforms, and storage. Functions belonging to other passes are excluded, so they can use resources configured on their own pass. Common code and global initializer helpers are retained.

When adding a buffer or compute pass, **Create** makes a new source file and **Insert** appends uniquely named entry points to the current source. Insert connects the new pass to that source and saves its stage choices. The VS Code source insertion is undoable. Choose native functions or ShaderToy hooks when creating a shader. `webgpu.defaultRenderAuthoring` also controls the project’s templates. The default affects new shaders and passes; existing ShaderToy hooks remain supported.

Native fragments receive WebGPU coordinates with a top-left origin. The `mainImage` hook below receives bottom-left coordinates. Native stages still receive Shader Studio’s built-in globals, configured channel helpers, and storage declarations. Group 0 bindings are reserved for these generated resources; do not redeclare their bindings.

For mesh geometry, native vertex inputs must match the supplied mesh layout: location 0 is `vec3f` position, location 1 is `vec3f` normal, and location 2 is `vec2f` UV. Native shaders own their transforms and vertex-to-fragment interface. The built-in mesh vertex shader outputs UV at location 0, world position at location 1, and normal at location 2. A native fragment paired with that vertex shader must use compatible input locations and types. A native vertex paired with `mainImage` must produce that interface. A separate `vertex` hook file can also be paired with a native fragment.

The built-in mesh vertex shader applies the viewer camera after `mainVertex`, so an empty hook still responds to drag rotation. Native mesh vertices can use `iModelMatrix`, `iViewProjectionMatrix`, and `iNormalMatrix` to follow that same camera:

```wgsl
let world = iModelMatrix * vec4f(position, 1.0);
let clip = iViewProjectionMatrix * world;
let worldNormal = (iNormalMatrix * vec4f(normal, 0.0)).xyz;
```

A fullscreen vertex uses `@builtin(vertex_index)` instead of the mesh attributes. Changing geometry keeps your explicit stage selections; choose a compatible vertex when switching between mesh and fullscreen geometry.

Native fragment inline previews and captures preserve the selected native fragment entry point and its authored input interface, including vertex-to-fragment varyings and depth-bearing outputs. Color outputs must be four-component floating-point vectors. Native buffer passes can declare [multiple render targets](multiple-render-targets.md), and debugging can select an attachment.
Native fragment inputs are supplied by rasterization, so the debug panel identifies them as GPU-provided rather than displaying inspector defaults as values. Parameters of helper functions called from that fragment remain editable for inline debugging.

Runnable WGSL and Slang examples live in `tests/fixtures/shader-corpus/*/native-entrypoints/shared.*`; matching `samefile-hooks` examples demonstrate existing `mainVertex` and `mainImage` hooks in one source file. The adjacent `raster-varyings.*` projects exercise native mesh varyings and structured color/depth debugging.

## The `mainImage` Function

Like Slang, WGSL image shaders define a `mainImage` free function. It receives the current pixel coordinate and returns its color:

```wgsl
fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / vec2f(iResolution.xy);
    return vec4f(uv, 0.5 + 0.5 * sin(iTime), 1.0);
}
```

`coord` is in pixels with a bottom-left origin, matching `fragCoord` in GLSL and Slang.

The usual ShaderToy-style built-ins are available as globals with the same names and meanings as in Slang: `iResolution`, `iMouse`, `iTime`, `iTimeDelta`, `iFrameRate`, `iFrame`, `iSampleRate`, `iDate`, `iCameraPos`, `iCameraDir`. Use these names directly without declaring them.

## Reading Textures and Buffers

Use `sample2D` for filtered colors, or `load2D` when you need the exact value of
one cell, such as a simulation state or pixel-art grid. With an input named `state`:

```wgsl
let cell = load2D(stateTexture, vec2i(12, 8));
```

This reads pixel (12, 8), counting from the bottom-left of the source texture.
Keep the pixel within the source's dimensions. The read uses the original texture
level (mip zero) and ignores filtering and wrapping settings. It can be used in
fragment or compute code, including helper functions; it is not specific to
`mainImage`.

Native `textureLoad` uses top-left coordinates instead. For filtered reads,
implicit sampling requires [uniform control flow](channels.md#shared-sampling-rules).
See [Channels](channels.md#buffer-precision-and-exact-reads) for sampling settings,
storage precision, and examples in all three shader languages.

## Differences from Slang

WGSL and Slang offer the same rendering features, with a few differences in shader syntax:

- **Channel metadata uses dot access; native handles stay separate.** Use `albedo.size`, `.time`, and `.loaded`, then sample with `sample2D(albedoTexture, albedoSampler, uv)`. Slang uses the same function name with `albedo.texture` and `albedo.sampler`. WGSL cannot put handles in structs or expose Slang's optional methods. Legacy per-channel functions remain available; see [Channels](channels.md).
- **The vertex hook takes pointers.** WGSL has no `inout` parameters, so `mainVertex` receives `ptr<function, …>` pointers and you modify the pointed-to values:
  ```wgsl
  fn mainVertex(position: ptr<function, vec3<f32>>, normal: ptr<function, vec3<f32>>, uv: ptr<function, vec2<f32>>) {
      (*position).y += 0.1 * sin(iTime);
  }
  ```
  See [Vertex Shaders](vertex-shaders.md).
- **Assign single components, not swizzles.** Assigning a swizzle (`position.xy = ...`) requires support for the optional `swizzle_assignment` language feature. For compatibility across browsers and VS Code, write the components separately or replace the whole vector:
  ```wgsl
  let nudged = (*position).xy + offset;
  (*position).x = nudged.x;
  (*position).y = nudged.y;

  body.velocity = vec4f(body.velocity.xyz + force, body.velocity.w);
  ```
- **No imports.** Put shared functions and types in the [Common pass](config-buffers.md), as with GLSL.
- **No preprocessor.** There is no `#define`, `#if`, or macro expansion. Use `const` / `override` declarations and plain WGSL control flow instead. Snippets that relied on the GLSL preprocessor will not translate line-for-line.
- **`enable` directives are supported.** Use `enable`, `requires`, and `diagnostic()` directives at the top of your shader or Common file. If an `enable` names an extension the GPU does not support (for example `enable f16;` on hardware without `shader-f16`), compilation fails with an error naming the missing requirement.

## Script-Pass Uniforms

Values returned by a [Script pass](config-buffers.md) are available under the script's field names — no declaration needed in your shader. The type mapping mirrors GLSL: `number` becomes `f32`, `[n, n]` becomes `vec2<f32>`, and so on up to `vec4<f32>`, with `boolean` arriving as `bool`.

## Compute Passes

Declare a compute entry point with `@compute` and choose its workgroup size with `@workgroup_size`:

```wgsl
@compute @workgroup_size(8, 8)
fn mainCompute(@builtin(global_invocation_id) id: vec3u) {
    // ...
}
```

Storage buffers configured on the pass are declared for you; sampling and uniform built-ins work as in image shaders, except implicit derivative sampling is unavailable — use `sample2DLevel` or `sample2DGrad` with explicit gradients. See [Compute Passes](compute.md).

## Storage Buffers

Use native WGSL types in the storage configuration, such as `f32`, `vec3f`, `atomic<u32>`, or a struct declared in your shader or Common code. Buffer sizes are calculated automatically, including padding, nested arrays and structs, and `@align` / `@size` attributes. Half-precision types require `enable f16;` and GPU support for `shader-f16`. For buffers of `f16` scalars, use an even element count if your shader relies on `arrayLength`; an odd count includes an extra padding element.

The Storage inspector can read and edit scalar and vector values using either WGSL or Slang type names, including `f16`. Custom structs and matrices still require shader code to inspect their fields.

## Language Support in the Editor

`.wgsl` files get syntax highlighting, bracket matching, comment toggling,
completion, hover, and navigation. Snippets cover `mainImage`, channel sampling,
vertex hooks, and compute entry points. The editor reports basic errors before
compilation; compiling checks the shader fully. See
[WGSL editor support](wgsl.md#editor-support-and-diagnostics) for diagnostic limits
and [Language Servers](language-servers.md) for rename and color editing.

## Debugging WGSL Shaders

Enable debug mode and place your cursor on a value to preview it inline. Open the
Variable Inspector to capture supported locals, parameters, and return values.
Common helpers, parameter overrides, and loop caps are supported. See
[WGSL debugging and capture types](wgsl.md#debugging-and-capture-types) for type
annotations, matrix ordering, and [compute replay limits](wgsl.md#compute-debugging-limits).

## Next

- [Channels](channels.md) — sampling inputs from WGSL
- [Vertex Shaders](vertex-shaders.md) — the `mainVertex` hook
- [Compute Passes](compute.md) — WGSL compute entry points

For WebGPU mesh geometry, **Use viewer camera** defaults on. Turn it off to use mesh or `mainVertex` positions directly in clip space, without the viewer rotation, view, or perspective transform. Native vertex stages that read `iModelMatrix`, `iViewProjectionMatrix`, and `iNormalMatrix` receive identity matrices when it is off; stages with their own projection continue to control their output. The per-pass setting saves as `useViewerCamera: false` on Image or Buffer. Fullscreen vertex stages already use clip space. GLSL behavior is unchanged.

Viewer camera defaults follow pass → shader → global precedence. In the config panel, expand **Viewer camera defaults** to choose **Use global default**, **On**, or **Off** for this shader, or change **Use viewer camera globally**. A shader default is saved as `webgpu.useViewerCamera`; a pass override uses `passes.<name>.useViewerCamera`. **Use shader default** clears the pass override. The global preference is stored as `shader-studio.webgpu.useViewerCamera` in VS Code user settings and in browser storage in standalone. It changes existing shaders that inherit it, and is never copied into their `.sha.json` files. Defaults remain enabled for older projects.
