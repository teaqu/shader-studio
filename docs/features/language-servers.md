# Language Servers

Shader Studio includes editor support for GLSL, Slang, and WGSL. No additional
shader extension is needed.

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
| Rename | Yes | Yes, with limits below | Yes |
| Error checking | Syntax checks | Syntax and type checks | Basic checks as you type; full checks when compiling |
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
- Entry points and built-ins for fragment, vertex, and compute shaders

Hover shows local and parameter types, struct fields, and vector components.
Slang and WGSL also describe channel access and configured storage. Signature help
follows nested calls; Slang supports generic calls such as `bit_cast<uint>(`.

### WGSL Diagnostics

WGSL has no user-defined generics, function overloads, or import/include mechanism; put shared code in Common.

As you type, the editor reports syntax errors, undefined names,
reserved words, and uses of built-ins or `discard` in an incompatible shader stage.
It reports the first syntax error; fix that error to see name and stage diagnostics.
To check expression types, function arguments, and return values,
[compile](compile-modes.md) your shader. Errors point to the relevant shader,
Common, or vertex file where possible.

When editing Common, syntax errors appear as you type. Compile a pass that uses
Common to check its helpers fully. If a helper uses an operation unavailable in
that pass, such as `dpdx` in compute code, the error identifies the helper and line.

Signature help shows named parameters and documentation for authored, Common,
channel, and built-in functions. Add leading `//` comments to document your own
functions. Signature help also works inside nested calls and template arguments.

Vector component completion includes all valid one-to-four-component read selections,
including reordered and repeated forms such as `yx`, `xxxx`, and `bgra`.

## References and Rename

Use **Find All References** to find uses of an authored symbol. Results can include
configured Common and dependency files; document highlights mark occurrences in
the current editor. Search is limited to the shader's known sources, not every file
in the workspace. Formatting and workspace symbol search are unavailable.

Use **Rename Symbol** (`F2`) to rename a function, parameter, variable, or struct
field. Both VS Code and the standalone editor can update affected shader and Common
files. All target files must be available
and writable for the edits to be applied. This is separate from renaming a shader
file in the explorer.

Slang rename handles local names and overloaded functions, and checks that the
change does not introduce errors. It can also update generic helpers, methods,
and imports. If a symbol cannot be identified safely or the change would fail
validation, the rename is declined.

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
