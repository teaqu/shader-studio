# Troubleshooting

## Preview Is Blank

- Confirm your shader has the correct signature: `void mainImage(out vec4 fragColor, in vec2 fragCoord)`
- Check the error tooltip near the play/pause button — a red indicator means compilation failed
- Try **Refresh** from the options menu
- Make sure the file extension is `.glsl`

## An Imported Slang File Cannot Be Found

- Check that the `import` or `#include` path resolves inside the workspace that owns the shader, not the file currently open in the editor
- Confirm the file is part of that workspace and that the path uses the expected spelling and case
- Save a newly created dependency before using it if it is not yet available on disk
- In **Save** or **Manual** compile mode, save the dependency or run **Compile Now** after correcting the path

## A Slang Dependency Has a Compiler Error

Compiler messages can point at an imported module or a textual include. Open and correct the reported dependency, then compile using the active [compile mode](../features/compile-modes.md).

The preview continues to show the last successful result when available. That image is not proof that the current source compiled: resolve the diagnostic before relying on the updated shader.

## A Slang File Uses the Wrong Language Version

- A Slang file without a `#language` directive uses the legacy default
- Use `#language slang legacy`, `#language slang 2025`, `#language slang 2026`, or `#language slang latest` to select a version explicitly
- Imported modules use their own version headers
- Textual `#include` files inherit the version of the including file
- New `.slang` files start with `#language slang 2026`

See [Slang Workspaces](../features/slang-workspaces.md) for the complete workspace and versioning model.

## I Cannot Debug or Capture an Imported Slang Module

Debugging and capture start from a workspace root shader or buffer. Shared imported modules and include files are not standalone targets, so select the root that uses the dependency instead.

## Crashing or Halting

If the shader freezes or crashes:

- Disable **debug mode** — debugging adds overhead that can slow down or freeze expensive shaders
- Turn off the **variable inspector** — grid captures in particular are GPU-intensive
- Reduce the **resolution** — try 0.5x or lower to reduce GPU load
- Switch to **Manual** compile mode — this stops the shader from recompiling on every keystroke

## No Layout Showing

If panels have disappeared or the layout is broken:

- Use **Menu → Layout → Reset to Default** in the preview toolbar
- Use **Menu → Layout → Restore Saved Layout** if you want to reload the active profile's saved arrangement instead
- Or run **Shader Studio: Reset Layout** from the command palette
