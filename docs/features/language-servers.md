# GLSL and Slang IntelliSense

Shader Studio provides built-in language services for GLSL and Slang. They run
inside the Shader Studio extension, so you do not need to install a separate
shader extension or a native language-server executable.

Both services are enabled by default. Open a `.glsl`, `.frag`, `.vert`, `.comp`,
or `.slang` file in VS Code and use the normal editor features such as completion
(`Ctrl+Space`), hover, and **Go to Definition**.

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
- Shader Studio sampling helpers such as Slang `sampleIChannel0`
- Functions, structures, and variables declared in the current shader
- Functions and types provided by configured Common and dependency files
- Custom uniforms from the active Script and resources from the Shader Studio
  configuration
- Stage-specific fragment, vertex, and compute contracts

The services intentionally do not provide formatting, rename, or workspace-wide
reference search yet.

## Shader Studio Project Context

IntelliSense is based on the same pass configuration used by Shader Studio. This
lets a buffer file understand its pass name, stage, channels, storage resources,
custom uniforms, Common code, and generated Shader Studio declarations.

When a shader document is opened directly, the extension looks for its project
context in this order:

1. A companion `.sha.json` configuration next to the shader.
2. A matching configuration currently loaded by an open Shader Studio panel,
   window, or browser client.
3. A `.sha.json` file in the document's parent directories that explicitly
   references the document as a pass or vertex shader.

The loaded-panel fallback is useful when you open `BufferA`, a vertex shader, or
another nested pass directly. The language service can still associate it with
the exact configuration already being previewed, even when that configuration
has not been found through the buffer's own filename.

Pass paths can be relative to the configuration or workspace-relative with the
`@/` prefix:

```json
{
  "version": "1.0",
  "passes": {
    "Image": {},
    "Common": { "path": "@/shared/common.slang" },
    "BufferA": { "path": "@/passes/buffer-a.slang" }
  }
}
```

If no project configuration is found, Shader Studio still provides language
intrinsics and the default fragment authoring environment. A `.vert` file is
treated as a vertex shader; compute-specific declarations require a configured
compute pass.

## Common and Dependencies

A configured Common pass is treated as though it appears before every render
pass. Its functions and types are available in completion, hover, signature
help, diagnostics, and **Go to Definition**. Common is not prepended to itself.

Unsaved edits in an open Common document are used immediately, and editing
Common refreshes diagnostics for open dependent shader documents. Dependency
files are re-read from disk when the language-service environment is refreshed,
so save a dependency before checking its consumers.

GLSL dependencies use recursive, file-relative quoted includes:

```glsl
#include "lib/color.glsl"
```

Slang dependencies support file-relative imports and includes:

```slang
import palette;
import "lib/tone-map.slang";
#include "include/noise.slang"
__include "include/color.slang"
```

An identifier import such as `import lib.palette;` resolves to
`lib/palette.slang`. Slang identifier underscores map to hyphens, matching
Slang's module path convention. Because the bundled browser-compatible Slang
compiler cannot read the filesystem itself, Shader Studio resolves these files
before passing the source to the compiler.

Paths are resolved relative to the file containing the import or include,
including dependencies referenced from Common. The Slang compiler reports an
unresolved dependency as a diagnostic. In GLSL, a missing include cannot provide
symbols to completion or navigation; check the include path if those symbols are
absent.

## Stage-Aware Authoring

Shader Studio only advertises declarations that exist in the current stage:

- Fragment passes get `mainImage`, fragment coordinates, channels, and fragment
  uniforms.
- Vertex shaders get the `mainVertex` hook and its position, normal, and UV
  parameters.
- Slang compute passes get `numthreads`, `SV_DispatchThreadID`, `iDispatch`, and
  `writeOutput` with the configured output-layer shape.

Slang diagnostics use the bundled official compiler with the WGSL compilation
target. A function may exist in Slang but still be unavailable for WebGPU/WGSL;
in that case the editor diagnostic matches the limitation that would affect the
Shader Studio renderer.

## Color Picker

With `shader-studio.editor.colorDecorators` enabled, literal constructors show a
small VS Code color swatch:

```glsl
vec4 accent = vec4(1.0, 0.5, 0.0, 1.0);
```

```slang
float4 accent = float4(1.0, 0.5, 0.0, 1.0);
```

Click the swatch to open VS Code's built-in color picker. Shader Studio sets the
GLSL and Slang default to activate color decorators on click, so hovering the
rest of the constructor continues to show normal shader hover information.

## Spell Checking

Spell checking is not built into VS Code or the Shader Studio language servers.
If the optional **Code Spell Checker** (`streetsidesoftware.code-spell-checker`)
extension is installed, Shader Studio registers a bundled dictionary containing
common GLSL, Slang, WebGPU, and Shader Studio terms. No spell-checker extension is
installed automatically.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `shader-studio.languageServers.glsl.enabled` | `true` | Enable or disable GLSL language features. |
| `shader-studio.languageServers.slang.enabled` | `true` | Enable or disable Slang language features. |
| `shader-studio.editor.colorDecorators` | `true` | Show editable swatches for literal shader colors. |
| `shader-studio.languageServers.trace` | `off` | Log language-service messages with `messages` or detailed activity with `verbose`. |

Changes to the GLSL and Slang enable settings apply without restarting VS Code.
See [Settings](../help/settings.md) for the complete Shader Studio settings list.

## Troubleshooting

If project-specific symbols are missing:

1. Confirm the file's VS Code language mode is **GLSL** or **Slang**.
2. Confirm the corresponding language-server setting is enabled.
3. Check that the pass path in `.sha.json` resolves to the file you opened.
4. Open the owning shader in Shader Studio so its currently loaded configuration
   can provide context for a nested buffer.
5. Check the import/include spelling and remember that dependency paths are
   relative to the file containing the directive.
