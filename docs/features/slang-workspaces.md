# Slang Workspaces

Slang shaders can be split into modules and shared source files. A workspace is the root shader together with the files it imports or includes.

## Imports and Includes

`import` and `#include` paths resolve within the workspace that owns the root shader. This lets buffers in a multipass shader share modules without relying on the editor's current file.

```slang
// buffer-a.slang
import lib.palette;
#include "include/tone-map.slang"
```

Use `import` for a Slang module with its own declarations and language header. Use `#include` for textual source that is inserted into the including file.

## Working With Unsaved Files

Unsaved edits in any workspace file take priority over the version on disk. Editing an imported module or included file recompiles the active shader roots that depend on it, subject to the current [compile mode](compile-modes.md):

| Compile mode | Dependency edit behavior |
|---|---|
| Hot | Recompiles while you edit. |
| Save | Recompiles when the dependency is saved. |
| Manual | Recompiles when you run **Compile Now**. |

This applies to root shaders and their dependency files. A dependency edit is not treated as an unrelated standalone shader.

## Language Versions

Language selection belongs to each Slang source file:

```slang
#language slang 2026
```

- A file with no `#language` directive keeps the legacy Slang default, including a directive-free root or imported module.
- Explicit `legacy`, `2025`, `2026`, and `latest` directives are preserved.
- New `.slang` files created by Shader Studio start with `#language slang 2026`.
- An imported module uses its own header and version.
- A textual `#include` inherits the version of the file that includes it.

This makes it possible to modernize modules individually while keeping existing directive-free shaders on their legacy behavior.

## Errors and Last-Good Output

Compiler diagnostics identify the dependency file where an error occurred, not only the root shader that triggered the build. Fix the reported imported module or include, then recompile according to the active compile mode.

If a new compile fails, Shader Studio keeps showing the last successfully compiled output when one is available. The failed source is still reported through compiler diagnostics; the retained image is only a fallback while you correct the error.

## Debugging, Capture, and Recording

Debugging and capture operate on a workspace root. Select a root shader/buffer before starting them. Imported modules and shared dependency files cannot be selected as independent debug or capture targets; Shader Studio shows an explicit unsupported message instead.

Screenshots and recordings use a coherent snapshot of the currently active successful workspace. They do not mix a newly edited dependency with an older root compile.

## Scope

This feature adds runtime workspace compilation, diagnostics, and capture behavior. It does not add a Slang language server, Monaco Slang language features, or dependency navigation.

## Next

[Compile Modes](compile-modes.md) — choose when root and dependency edits compile
