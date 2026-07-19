# Slang Workspaces

Shader Studio can compile a `.slang` image shader together with native Slang
modules and textual includes. Rendering, VS Code language features, and the in-app
Monaco editor share the same workspace-file model, including unsaved files.

This is the Phase 1 workspace model. Shader Studio still supplies its ShaderToy
uniforms and generated vertex and fragment entry points, so each image or buffer
pass continues to expose `mainImage`.

## Language Version And Module Header

The source file owns its Slang language version. There is no Slang language or
version field in `.sha.json`.

Existing directive-free `.slang` files retain legacy behavior. Shader Studio
internally supplies `#language slang legacy` while compiling the root; it does not
rewrite the file. It never silently selects `latest`.

Use an explicit header to select another mode:

```slang
#language slang 2026
module image;

float4 mainImage(float2 fragCoord)
{
    return float4(fragCoord / iResolution.xy, 0.0, 1.0);
}
```

An explicit `#language` directive is authoritative. The bundled compiler accepts
`legacy`, `2025`, `2026`, and `latest`; `latest` is used only when the source asks
for it. With the currently pinned Slang compiler (`2026.10.2`), the `2025`, `2026`,
and `latest` modes require a `module` declaration immediately after the directive,
apart from comments and whitespace.

**Shader Studio: New Shader** creates a new `.slang` file with:

```slang
#language slang 2026
module file_name;
```

The module name comes from the filename. Invalid characters become underscores,
and names that start with a digit or conflict with a Slang keyword or built-in
type receive a leading underscore. Creating a GLSL shader is unchanged.

### Dependencies And Language Modes

An imported module is an independent translation unit. Give each modern imported
module its own `#language` and `module` header. A directive-free imported module
uses legacy mode independently, even when the importing root uses 2026.

A textual include is different: `#include` and `__include` insert source into the
including translation unit. Include fragments inherit the including root or
module's language mode and should not declare their own `#language` or `module`.

## Imports And Includes

Shader Studio mirrors the workspace into Slang's in-memory filesystem under
`/workspace`. This path appears in internal diagnostics and logs; source files
should continue to use normal Slang references.

For example:

```text
project/
├── image.slang
├── include/tone-map.slang
├── lib/palette.slang
└── passes/glow.slang
```

The root can use:

```slang
import lib.palette;
#include "include/tone-map.slang"
```

A nested pass can include a relative file:

```slang
#include "../include/tone-map.slang"
```

Identifier imports consider both the importing file's directory and the workspace
root. Dotted module paths map to dotted and nested `.slang` candidates. A nested
pass can therefore import a workspace module with its workspace-relative dotted
path. Slang itself remains authoritative when candidates are ambiguous; keep
module declarations unique to make navigation and invalidation predictable.

Shader Studio includes the image root, configured buffer pass files, and their
transitive imports and includes in the compile snapshot. Files must stay inside
the owning VS Code workspace folder. A single-folder window without a workspace
uses the root shader's directory as its workspace boundary.

## Unsaved Files And Hot Reload

Open editor contents override disk contents. In **Hot** compile mode, editing an
imported module or include recompiles only the active roots and passes that own the
dependency. Shared dependencies invalidate all of their owners; pass-local
includes avoid directly recompiling unrelated passes. Downstream image output is
updated when its input pass changes.

Save events that repeat an already compiled unsaved edit are deduplicated. Creating,
deleting, undoing, closing, or reopening a dependency refreshes its ownership and
diagnostics. A helper owned by an active root is not treated as a standalone shader,
so it does not need `mainImage`. An ownerless `.slang` file opened as a preview root
still does.

If a dependency fails to compile, its diagnostic is attached to the dependency's
real URI and identifies the affected pass where available. Unaffected roots keep
running, and the affected preview keeps its last-good frame and pipeline until the
error is fixed.

## Editing And Navigation

Shader Studio contributes a Slang-specific grammar in VS Code and a matching
Monarch tokenizer in Monaco. Both editors provide:

- completion and completion details;
- hover information;
- go to definition, including dependency files;
- signature help;
- document symbols; and
- Slang language diagnostics.

Compiler markers and language-service markers have separate owners, so refreshing
one does not erase the other. Definition navigation reuses one canonical model for
each dependency instead of creating duplicate Monaco buffers.

The VS Code providers are enabled by default with
`shader-studio.slangLanguageFeatures: true`. Set it to `false` if another Slang
extension supplies the providers you prefer. This setting disables Shader Studio's
hover, completion, navigation, symbols, signature help, and language diagnostics;
the Slang grammar and rendering support remain available.

The bundled browser and Node workers load their matching packaged Slang JavaScript
and WASM assets. Monaco uses the browser worker, while VS Code uses a Node worker.
GLSL models and providers remain separate and unchanged.

!!! note "Multi-root workspaces"

    Rendering chooses the workspace folder that contains each active root. The
    bundled VS Code Slang language service currently manages only the first folder
    in a multi-root window. For full Shader Studio IntelliSense in another folder,
    open that folder in its own window or make it the first workspace folder.

## Debugging And Capture

Line debugging and variable capture compile with the same dependency snapshot as
normal rendering. Phase 1 supports active image and buffer roots plus code brought
in through textual includes. A dependency compilation error preserves the last-good
render and capture.

Selecting an expression inside an imported translation unit or a configured
`common` source is not supported yet. Shader Studio returns a structured
`slang-cross-file-debug-unsupported` diagnostic on the selected source instead of
instrumenting a similarly numbered line in the active pass. Normal rendering can
still import and compile those files.

## Phase 1 Limits

Phase 1 intentionally does not include:

- semantic-token highlighting (the dedicated grammars provide lexical highlighting);
- reflection-driven resource binding or full `ParameterBlock<>` parity;
- debug instrumentation inside imported translation units or configured common code;
- configurable native graphics entry points or compute dispatch;
- automatic differentiation or ray-tracing workflows; or
- `.hlsl` extension support.

Shader Studio's generated `mainImage` pipeline, configured channels, and supported
custom uniforms remain the runtime contract. See [Troubleshooting](../help/troubleshooting.md#slang-workspaces)
when a module, include, worker, or diagnostic does not behave as expected.
