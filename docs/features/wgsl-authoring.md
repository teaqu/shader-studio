# WGSL Shaders

WGSL (WebGPU Shading Language) shaders run on the WebGPU pipeline, alongside GLSL (WebGL) and Slang (WebGPU). WGSL is a good choice when you want WebGPU features — storage buffers, compute passes — with a stable, browser-native shading language and no Slang toolchain involved.

WGSL shaders need a WebGPU-capable browser or host. If WebGPU is unavailable, a WGSL shader fails with an error naming the missing feature instead of rendering silently wrong output.

## The `mainImage` Function

Like Slang, WGSL image shaders define a `mainImage` free function. It receives the current pixel coordinate and returns its color:

```wgsl
fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / vec2f(iResolution.xy);
    return vec4f(uv, 0.5 + 0.5 * sin(iTime), 1.0);
}
```

`coord` is in pixels with a bottom-left origin, matching `fragCoord` in GLSL and Slang.

The usual ShaderToy-style built-ins are available as globals with the same names and meanings as in Slang: `iResolution`, `iMouse`, `iTime`, `iTimeDelta`, `iFrameRate`, `iFrame`, `iSampleRate`, `iDate`, `iCameraPos`, `iCameraDir`. Do not redeclare them — they are injected as `var<private>` globals and initialised at every entry point.

## Differences from Slang

WGSL and Slang share the WebGPU pipeline, but the languages differ in how you reach the same engine features:

- **Channel metadata uses dot access; native handles stay separate.** Use `albedo.size`, `.time`, and `.loaded`, then sample with `sample2D(albedoTexture, albedoSampler, uv)`. Slang uses the same function name with `albedo.texture` and `albedo.sampler`. WGSL cannot put handles in structs or expose Slang's optional methods. Legacy per-channel functions remain available; see [Channels](channels.md).
- **The vertex hook takes pointers.** WGSL has no `inout` parameters, so `mainVertex` receives `ptr<function, …>` pointers and you modify the pointed-to values:
  ```wgsl
  fn mainVertex(position: ptr<function, vec3<f32>>, normal: ptr<function, vec3<f32>>, uv: ptr<function, vec2<f32>>) {
      (*position).y += 0.1 * sin(iTime);
  }
  ```
  See [Vertex Shaders](vertex-shaders.md).
- **Assign single components, not swizzles.** Base WGSL assigns one component at a time. Assigning a swizzle (`position.xy = ...`) needs the optional `swizzle_assignment` language feature, which a browser either has or does not: there is nothing to enable, and the renderer cannot turn it on. Recent Chromium has it; the Chromium inside VS Code does not yet, and rejects the assignment with `cannot assign to value of type 'vec2<f32>'`. For a shader that runs in both, write the components separately or replace the whole vector:
  ```wgsl
  let nudged = (*position).xy + offset;
  (*position).x = nudged.x;
  (*position).y = nudged.y;

  body.velocity = vec4f(body.velocity.xyz + force, body.velocity.w);
  ```
- **No imports.** WGSL has no module system: a shader file plus the [Common pass](config-buffers.md) text (prepended verbatim when configured) is the whole program. Shared code goes in the Common pass, exactly as with GLSL.
- **No preprocessor.** There is no `#define`, `#if`, or macro expansion. Use `const` / `override` declarations and plain WGSL control flow instead. Snippets that relied on the GLSL preprocessor will not translate line-for-line.
- **`enable` directives are supported.** Module-scope `enable`, `requires`, and `diagnostic()` directives are hoisted above the generated prelude so they take effect for the whole module. If an `enable` names an extension the GPU does not support (for example `enable f16;` on hardware without `shader-f16`), compilation fails with an error naming the missing requirement.

## Script-Pass Uniforms

Script passes run in the VS Code extension only. Standalone does not execute
browser scripts or inject their custom uniforms.

Values returned by a [Script pass](config-buffers.md) are injected as `var<private>` globals with the script's field names — no declaration needed in your shader. The type mapping mirrors GLSL: `number` becomes `f32`, `[n, n]` becomes `vec2<f32>`, and so on up to `vec4<f32>`, with `boolean` arriving as `bool`.

## Compute Passes

WGSL compute shaders declare their own entry points with `@compute` and `@workgroup_size`, and the engine discovers them automatically:

```wgsl
@compute @workgroup_size(8, 8)
fn mainCompute(@builtin(global_invocation_id) id: vec3u) {
    // ...
}
```

Storage buffers configured on the pass are declared for you; sampling and uniform built-ins work as in image shaders, except implicit derivative sampling is unavailable — use `sample2DLevel` or `sample2DGrad` with explicit gradients. See [Compute Passes](compute.md).

## Storage Buffers

Use native WGSL types in the storage configuration, such as `f32`, `vec3f`, `atomic<u32>`, or a struct declared in your shader or Common code. The engine infers array strides, including vector padding, nested arrays and structs, and member `@align` / `@size` attributes. Half-precision types require `enable f16;` and GPU support for `shader-f16`. [WebGPU storage bindings](https://www.w3.org/TR/webgpu/#dom-gpudevice-createbindgroup) use whole four-byte units, so a buffer with an odd number of two-byte elements includes one padding element in `arrayLength`. Use an even count when shader code relies on that length.

The Storage inspector can read and edit scalar and vector values using either WGSL or Slang type names, including `f16`. Custom structs and matrices still require shader code to inspect their fields.

## Language Support in the Editor

`.wgsl` files get syntax highlighting, bracket matching, comment toggling,
completion, hover, and navigation. Snippets cover `mainImage`, channel sampling,
vertex hooks, and compute entry points. The editor reports basic errors before
compilation; the renderer supplies full WGSL validation. See
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
