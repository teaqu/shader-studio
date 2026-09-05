# Language Servers

Shader Studio provides built-in language services for GLSL and Slang. They run
inside the Shader Studio extension, so you do not need to install a separate
shader extension or a native language-server executable.

Both services are enabled by default. Open a shader file in VS Code and use the
normal editor features such as completion (`Ctrl+Space`), hover, and **Go to
Definition**.

## Supported Editor Features

| Feature | GLSL | Slang |
|---------|------|-------|
| Completion | Yes | Yes |
| Hover documentation | Yes | Yes |
| Signature help | Yes | Yes |
| Go to Definition | Yes | Yes |
| Document symbols / Outline | Yes | Yes |
| Diagnostics | Parser diagnostics | Official Slang compiler and language-server diagnostics |
| Color decorators and picker | `vec3` and `vec4` literals | `float3` and `float4` literals |

Completion and hover include:

- Language intrinsics such as GLSL `texture` and Slang `fmod`
- Shader Studio uniforms such as `iResolution`, `iTime`, and channel inputs
- Shader Studio channel objects such as Slang `inputs.iChannel0`
- Functions, structures, and variables declared in the current shader
- Functions and types provided by configured Common and dependency files
- Custom uniforms from the active Script and resources from the Shader Studio
  configuration
- Stage-specific fragment, vertex, and compute contracts

The services intentionally do not provide formatting, rename, or workspace-wide
reference search yet.

## Color Picker

With `shader-studio.editor.colorDecorators` enabled, literal constructors show a
small VS Code color swatch:

```glsl
vec4 accent = vec4(1.0, 0.5, 0.0, 1.0);
```

```slang
float4 accent = float4(1.0, 0.5, 0.0, 1.0);
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
| `shader-studio.editor.colorDecorators` | `true` | Show editable swatches for literal shader colors. |
