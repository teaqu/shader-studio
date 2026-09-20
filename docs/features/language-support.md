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
syntax or capture types. See the language pages for details.

## Hosts and Limitations

The VS Code extension and standalone browser support all three languages.
Slang and WGSL require WebGPU; GLSL uses WebGL2.

- Matrix capture supports 2x2 matrices; select individual columns or components
  for larger matrices. See [WGSL capture types](wgsl.md#debugging-and-capture-types).
- Compute debugging cannot reproduce threads working together in a workgroup. See [Slang debugging](slang.md#debugging) and
  [WGSL compute limits](wgsl.md#compute-debugging-limits).
- Whole arrays, structs, and arbitrary pointers are not capture rows; inspect
  supported elements or fields instead.
- Workspace symbol search and vertex-stage debugging are unavailable.

Language details: [GLSL](glsl.md) · [Slang](slang.md) · [WGSL](wgsl.md).
