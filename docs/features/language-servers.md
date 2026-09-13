# Language Servers

Shader Studio provides built-in language services for GLSL, Slang, and WGSL. They run
inside the Shader Studio extension, so you do not need to install a separate
shader extension or a native language-server executable.

All three services are enabled by default. Open a shader file in VS Code and use the
normal editor features such as completion (`Ctrl+Space`), hover, and **Go to
Definition**.

## Supported Editor Features

| Feature | GLSL | Slang | WGSL |
|---------|------|-------|------|
| Completion | Yes | Yes | Yes |
| Hover documentation | Yes | Yes | Yes |
| Signature help | Yes | Yes | Yes |
| Go to Definition | Yes | Yes | Yes |
| Document symbols / Outline | Yes | Yes | Yes |
| Find references / highlight | Yes | Yes | Yes |
| Rename | Yes | Scoped, compiler-validated | Yes |
| Diagnostics | Parser diagnostics | Official Slang compiler and language-server diagnostics | Basic syntax, name, and stage checks before compiling; full validation from the WebGPU compiler |
| Color decorators and picker | `vec3` and `vec4` literals | `float3` and `float4` literals | `vec3f`/`vec4f` and `vec3<f32>`/`vec4<f32>` literals |

Completion and hover include:

- Language intrinsics such as GLSL `texture`, Slang `fmod`, and WGSL `dot`
- Shader Studio uniforms such as `iResolution`, `iTime`, and channel inputs
- Shader Studio channel objects such as Slang `iChannel0`, plus WGSL
  free-function accessors such as `iChannel0Sample(uv)`
- Functions, structures, and variables declared in the current shader
- Functions and types provided by configured Common and dependency files
- Custom uniforms from the active Script and resources from the Shader Studio
  configuration
- Stage-specific fragment, vertex, and compute contracts

Hover shows local and parameter types, struct fields, and vector components.
Slang and WGSL also describe channel access and configured storage. Signature help
follows nested calls; Slang supports generic calls such as `bit_cast<uint>(`.
See [WGSL diagnostics](wgsl.md#editor-support-and-diagnostics) for its checks before
compilation and the distinction between Common and pass diagnostics.

## References and Rename

Use **Find All References** to find uses of an authored symbol. Results can include
configured Common and dependency files; document highlights mark occurrences in
the current editor. Search is limited to the shader's known sources, not every file
in the workspace. Formatting and workspace symbol search are unavailable.

Use **Rename Symbol** (`F2`) to rename a function, parameter, variable, or struct
field. Both VS Code and the standalone editor can update affected shader and Common
files. GLSL `#include` files can participate too. All target files must be available
and writable for the edits to be applied. This is separate from renaming a shader
file in the explorer.

Slang rename respects local shadowing and overloads, rejects name collisions, and
checks the edited source with the Slang compiler. Standard stage attributes,
literal `numthreads` dimensions, and `SV_` system semantics are supported. Generic
helpers, methods, and imports can participate when the service resolves their
declarations. A rename is declined if the symbol cannot be resolved or the edited
source fails validation. The implicit `shader_studio` import is supported.

Embedded editors in hosts without support for saving edits across files offer
single-file rename only; they decline a cross-file edit without applying it.

## Color Picker

With `shader-studio.editor.colorDecorators` enabled, literal constructors show a
small VS Code color swatch:

```glsl
vec4 accent = vec4(1.0, 0.5, 0.0, 1.0);
```

```slang
float4 accent = float4(1.0, 0.5, 0.0, 1.0);
```

```wgsl
var accent = vec4f(1.0, 0.5, 0.0, 1.0);
var glow = vec3<f32>(0.0, 0.5, 1.0);
```

Picking a color rewrites only the literal arguments, so a `vec3<f32>` stays a
`vec3<f32>` with three components.

## Spell Checking

If you use the optional **Code Spell Checker**
(`streetsidesoftware.code-spell-checker`) extension, Shader Studio registers a
bundled dictionary containing common GLSL, Slang, WebGPU, and Shader Studio
terms.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `shader-studio.languageServers.glsl.enabled` | `true` | Enable or disable GLSL language features. |
| `shader-studio.languageServers.slang.enabled` | `true` | Enable or disable Slang language features. |
| `shader-studio.languageServers.wgsl.enabled` | `true` | Enable or disable WGSL language features. |
| `shader-studio.editor.colorDecorators` | `true` | Show editable swatches for literal shader colors. |
