# WGSL Shaders

WGSL (WebGPU Shading Language) supports image shaders, vertex shaders, storage buffers, and compute passes.

WGSL shaders require WebGPU support in your browser and device.

## Native entry points and shared files

WGSL and Slang can keep vertex, fragment, and compute entry points in one source file. The config panel lists available functions as separate selectable rows under their stage. Select a fragment in **Fragment shader** and a vertex in **Vertex shader** independently. Compute passes have their own function rows. Either render stage can use an annotated function while the other keeps its generated adapter. Discovery reads the stage annotations in the source; saving a selection writes `entryPoints` in `.sha.json`. An omitted vertex selection uses the built-in vertex shader (and any configured `mainVertex` hook); an omitted fragment selection uses `mainImage`. Unselected native functions do not replace those adapters. Discovery does not create passes automatically.

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

For a buffer or compute pass, the **File** row shows its source path. **Change…** offers files already referenced by the config, **Browse workspace…**, and **Create**. Reuse a file containing the functions you need, or create a new one. Image always uses the main shader file and has no file chooser.

Under **Vertex shader**, choose **Built-in**, **Same file**, or **Separate file**. Same file uses the pass's fragment source and hides the duplicate path. Separate file shows an editable path and discovers vertex functions from that file. Built-in uses the generated vertex stage and clears the custom vertex selection; no source file is created for it.

**Add function…** appends code to the file belonging to that stage and saves the generated function selection. It does not switch to an unrelated active editor. For WGSL/Slang render stages, the adjacent **Built-in / Native** chooser selects a `mainImage`/`mainVertex` hook or an annotated entry point. The hook Add button is hidden when that hook already exists; Native can add another uniquely named function. Compute always adds a native entry point and has no mode chooser. In VS Code, source insertion is undoable.

A pure native fragment does not need `mainImage`. Its function list shows the declared native fragments without an absent `mainImage` option. Native shader and buffer templates start with a fragment only, retaining the generated vertex stage until you explicitly choose or add a custom one. The native fragment template includes normalized pixel coordinates and the time-varying color example.

Set **Default shader mode** in standalone Settings, or `shader-studio.webgpu.defaultRenderAuthoring` in VS Code, to choose Built-in hooks or Native entry points for new WGSL/Slang shaders and render-source authoring. `webgpu.defaultRenderAuthoring` can also select the project's render templates. Existing shaders are not converted when the default changes. See [Settings](../help/settings.md).

Native fragments receive WebGPU coordinates with a top-left origin. The `mainImage` hook below receives bottom-left coordinates. Native stages still receive Shader Studio’s built-in globals, configured channel helpers, and storage declarations. Group 0 bindings are reserved for these generated resources; do not redeclare their bindings.

For mesh geometry, native vertex inputs must match the supplied mesh layout: location 0 is `vec3f` position, location 1 is `vec3f` normal, and location 2 is `vec2f` UV. Native shaders own their transforms and vertex-to-fragment interface. The built-in mesh vertex shader outputs UV at location 0, world position at location 1, and normal at location 2. A native fragment paired with that vertex shader must use compatible input locations and types. A native vertex paired with `mainImage` must produce that interface. A separate `vertex` hook file can also be paired with a native fragment.

With **Use viewer camera** enabled, the built-in mesh vertex shader applies the viewer camera after `mainVertex`, so an empty hook still responds to drag rotation. Native mesh vertices can use `iModelMatrix`, `iViewProjectionMatrix`, and `iNormalMatrix` to follow that same camera:

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

The usual ShaderToy-style built-ins are available as globals with the same names and meanings as in Slang: `iResolution`, `iMouse`, `iTime`, `iTimeDelta`, `iFrameRate`, `iFrame`, `iSampleRate`, `iDate`, `iCameraPos`, `iCameraDir`, `iVertexCount`. Use these names directly without declaring them.

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
  fn mainVertex(vertexIndex: u32, position: ptr<function, vec3<f32>>, normal: ptr<function, vec3<f32>>, uv: ptr<function, vec2<f32>>) {
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

Storage buffers configured on the shader are declared for you; sampling and uniform built-ins work as in image shaders, except implicit derivative sampling is unavailable — use `sample2DLevel` or `sample2DGrad` with explicit gradients. See [Compute Passes](compute.md).

## Storage Buffers

Use native WGSL types in the storage configuration, such as `f32`, `vec3f`, `atomic<u32>`, or a struct declared in your shader or Common code. Buffer sizes are calculated automatically, including padding, nested arrays and structs, and `@align` / `@size` attributes. Half-precision types require `enable f16;` and GPU support for `shader-f16`. For buffers of `f16` scalars, use an even element count if your shader relies on `arrayLength`; an odd count includes an extra padding element.

The [GPU Storage workspace](storage.md) has Settings and read-only Inspect tabs. Inspect scalar and vector values using WGSL or Slang type names, including `f16`, and select one numeric struct field at a time. Matrix, nested struct and array fields are not displayed as numeric fields.

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

For mesh geometry, **Use viewer camera** defaults on in GLSL, WGSL, and Slang. Turn it off to use mesh or `mainVertex` positions directly in clip space, without the viewer rotation, view, or perspective transform. Native vertex stages that read `iModelMatrix`, `iViewProjectionMatrix`, and `iNormalMatrix` receive identity matrices when it is off; stages with their own projection continue to control their output. The per-pass setting saves as `useViewerCamera: false` on Image or Buffer. Fullscreen vertex stages already use clip space. GLSL mesh passes also respect this setting; GLSL does not always apply the viewer camera.

Opening a different shader resets the 3D viewer camera’s orbit, pan, and zoom. Editing or recompiling the current shader preserves the view.

Change the global camera default in VS Code Settings (**Shader Studio › WebGPU: Use Viewer Camera**) or standalone’s top-level **Settings → Use viewer camera**. Image and buffer passes can override it with **Use viewer camera**; **Use default** clears that pass override. Pass choices are saved as `passes.<name>.useViewerCamera`. The global preference is stored as `shader-studio.webgpu.useViewerCamera` in VS Code user settings and in browser storage in standalone, and is never copied into `.sha.json` files. Existing shader-wide `webgpu.useViewerCamera` settings in JSON remain supported between the pass and global defaults. Defaults remain enabled for older projects.
