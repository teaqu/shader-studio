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
| Find references / highlight | Yes | No | Yes |
| Rename | Yes | Scoped, compiler-validated | Yes |
| Diagnostics | Parser diagnostics | Official Slang compiler and language-server diagnostics | Hints and warnings only — errors come from the WebGPU compiler |
| Color decorators and picker | `vec3` and `vec4` literals | `float3` and `float4` literals | `vec3f` and `vec4f` literals |

Completion and hover include:

- Language intrinsics such as GLSL `texture`, Slang `fmod`, and WGSL `dot`
- Shader Studio uniforms such as `iResolution`, `iTime`, and channel inputs
- Shader Studio channel objects such as Slang `inputs.iChannel0`, plus WGSL
  free-function accessors such as `iChannel0Sample(uv)`
- Functions, structures, and variables declared in the current shader
- Functions and types provided by configured Common and dependency files
- Custom uniforms from the active Script and resources from the Shader Studio
  configuration
- Stage-specific fragment, vertex, and compute contracts

The services do not provide formatting or workspace-wide reference search yet.
Slang reference search and document highlights remain unavailable.

Slang **Rename Symbol** (`F2`) supports ordinary shader functions, parameters,
variables, and struct fields. In VS Code it also updates configured Common helpers
used by open passes. It respects local shadowing and overloads, rejects name collisions, and
checks the resulting source with the Slang compiler before returning edits.
Standard stage attributes, literal `numthreads` dimensions, and `SV_` system
semantics are supported. Renames involving macros, external imports, generics,
methods, or other syntax outside the scoped parser return no edits. The implicit
`shader_studio` import is supported. This is an editor feature, separate from
renaming a shader file in the explorer.

The built-in browser editor supports single-file symbol renames. It rejects
renames spanning multiple files and renames from a Common editor without applying
any edits. This applies to all three languages. Slang and WGSL Common renames
are available in VS Code; GLSL rename is limited to the current document.

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
```

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
