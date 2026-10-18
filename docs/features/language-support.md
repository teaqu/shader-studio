# Language Support

Shader Studio supports GLSL on WebGL2 and Slang and WGSL on WebGPU. This page
compares the editor, rendering, and debugging features that are available in
each language.

## Editing (language service)

| Feature | GLSL | Slang | WGSL |
|---|---|---|---|
| Completion, hover, and definition | Yes | Yes | Yes |
| References / highlights | Yes | Yes | Yes |
| Rename | Yes | Yes, with [limits](language-servers.md#references-and-rename) | Yes |
| Workspace symbol search | No | No | No |
| Error checking | Syntax checks | Syntax and type checks | Basic checks as you type; full checks when compiling |
| Signature help | Yes | Yes | Yes |
| Color swatches | `vec3` / `vec4` | `float3` / `float4` | `vec3f` / `vec4f` and `vec3<f32>` / `vec4<f32>` |

See [Language Servers](language-servers.md) for editor instructions and rename scope.

## Rendering

| Feature | GLSL | Slang | WGSL |
|---|---|---|---|
| Single pass / multipass / Common | Yes | Yes | Yes |
| Vertex shaders | Yes | Yes | Yes |
| Compute | No | Yes | Yes |
| Storage buffers | No | Yes | Yes |
| Texture / cubemap / audio / video / keyboard inputs | Yes | Yes | Yes |
| Named channel metadata | Yes | Yes | Yes; texture and sampler handles are separate |
| Model geometry | Yes | Yes | Yes |
| Custom uniforms from script | Yes | Yes | Yes |

See [Channels](channels.md) for the public channel API and compatibility details.

## Debugging

| Feature | GLSL | Slang | WGSL |
|---|---|---|---|
| Inline rendering | Yes | Yes | Yes |
| Variable capture (fragment) | Yes | Yes | Yes |
| 2x2 matrix capture | `mat2` | `float2x2` | `mat2x2f`, `mat2x2<f32>` |
| Vertex-stage debugging | No | No | No |
| Compute-pass debugging | No | One invocation at a time | One invocation at a time |
| Inspect values in Common helpers | Yes | Yes | Yes |
| Inspect values read from storage | No | Yes | Yes |

The languages share the same debugger controls, but they do not have identical
syntax or capture types. See the [Variable Inspector](../debugging/variable-inspector.md#supported-types) for supported values.

## WGSL Syntax Differences

Slang and WGSL share the WebGPU rendering workflows above, with differences in shader syntax:

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

## Hosts and Limitations

The VS Code extension and standalone browser support all three languages.
Slang and WGSL require WebGPU; GLSL uses WebGL2.

- Matrix capture supports 2x2 matrices; select individual columns or components
  for larger matrices. See [WGSL capture types](../debugging/variable-inspector.md#wgsl-capture-types).
- Compute debugging cannot reproduce threads working together in a workgroup. See [Slang debugging](slang.md#debugging) and
  [WGSL compute limits](compute.md#wgsl-debugging-limits).
- Whole arrays, structs, and arbitrary pointers are not capture rows; inspect
  supported elements or fields instead.
- Workspace symbol search and vertex-stage debugging are unavailable.

Language details: [GLSL](glsl.md) · [Slang](slang.md) · [WGSL syntax](#wgsl-syntax-differences).
