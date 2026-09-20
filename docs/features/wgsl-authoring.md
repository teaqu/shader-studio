# WGSL Shaders

WGSL (WebGPU Shading Language) supports image shaders, vertex shaders, storage buffers, and compute passes.

WGSL shaders require WebGPU support in your browser and device.

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
