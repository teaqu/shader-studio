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
- **No imports.** WGSL has no module system: a shader file plus the [Common pass](config-buffers.md) text (prepended verbatim when configured) is the whole program. Shared code goes in the Common pass, exactly as with GLSL.
- **No preprocessor.** There is no `#define`, `#if`, or macro expansion. Use `const` / `override` declarations and plain WGSL control flow instead. Snippets that relied on the GLSL preprocessor will not translate line-for-line.
- **`enable` directives are supported.** Module-scope `enable`, `requires`, and `diagnostic()` directives are hoisted above the generated prelude so they take effect for the whole module. If an `enable` names an extension the GPU does not support (for example `enable f16;` on hardware without `shader-f16`), compilation fails with an error naming the missing requirement.

## Script-Pass Uniforms

Values returned by a [Script pass](config-buffers.md) are injected as `var<private>` globals with the script's field names — no declaration needed in your shader. The type mapping mirrors GLSL: `number` becomes `f32`, `[n, n]` becomes `vec2<f32>`, and so on up to `vec4<f32>`, with `boolean` arriving as `bool`.

## Compute Passes

WGSL compute shaders declare their own entry points with `@compute` and `@workgroup_size`, and the engine discovers them automatically:

```wgsl
@compute @workgroup_size(8, 8)
fn mainCompute(@builtin(global_invocation_id) id: vec3u) {
    // ...
}
```

Storage buffers configured on the pass are declared for you; sampling and uniform built-ins work as in image shaders, except derivative-based `Sample` is unavailable without pixel derivatives — use `SampleLevel` or `SampleGrad` explicitly. See [Compute Passes](compute.md).

## Storage Buffers

Use native WGSL types in the storage configuration, such as `f32`, `vec3f`, `atomic<u32>`, or a struct declared in your shader or Common code. The engine infers array strides, including vector padding, nested arrays and structs, and member `@align` / `@size` attributes. Half-precision types require `enable f16;` and GPU support for `shader-f16`. [WebGPU storage bindings](https://www.w3.org/TR/webgpu/#dom-gpudevice-createbindgroup) use whole four-byte units, so a buffer with an odd number of two-byte elements includes one padding element in `arrayLength`. Use an even count when shader code relies on that length.

The Storage inspector can read and edit scalar and vector values using either WGSL or Slang type names, including `f16`. Custom structs and matrices still require shader code to inspect their fields.

## Language Support in the Editor

`.wgsl` files get WGSL syntax highlighting, bracket matching, and comment toggling in the extension, the standalone app, and the editor overlay. Snippets are available for the `mainImage` skeleton, channel sampling, the vertex hook, and compute entry points. Diagnostics from the WebGPU compiler are mapped back to your source lines, excluding the generated prelude.

## Debugging WGSL Shaders

WGSL shaders support the same step debugger and variable inspector as Slang: set a debug line to preview any visible value inline, and open the variable inspector to capture locals, parameters, and the return value. Unannotated `let`/`var` declarations get their types inferred (including through host globals like `iTime` and type-preserving builtins like `sin`), so idiomatic WGSL without type annotations still captures. Locals initialized from channel sampling or other opaque builtins stay invisible unless you annotate them.

Common-file functions participate in preview and capture. Function parameter overrides and loop iteration caps apply to WGSL helpers.

Compute debugging replays a selected invocation as a fragment on the canvas, with `global_invocation_id` derived from the canvas coordinate, `z = 0`, and `iDispatch = 0`. Direct `global_invocation_id`, `local_invocation_id`, `workgroup_id`, and `local_invocation_index` parameters are supported, using the entry's literal workgroup dimensions. Other entry parameter forms receive an unsupported diagnostic. Replay cannot reproduce cooperative workgroups; workgroup memory, barriers, subgroup operations, atomics, and storage writes are also reported as unsupported.

## Next

- [Channels](channels.md) — sampling inputs from WGSL
- [Vertex Shaders](vertex-shaders.md) — the `mainVertex` hook
- [Compute Passes](compute.md) — WGSL compute entry points
