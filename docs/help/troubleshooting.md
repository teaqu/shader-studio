# Troubleshooting

## Preview Is Blank

- Confirm your shader has the correct signature: GLSL uses
  `void mainImage(out vec4 fragColor, in vec2 fragCoord)`; Slang uses
  `float4 mainImage(float2 fragCoord)`
- Check the error tooltip near the play/pause button — a red indicator means compilation failed
- Try **Refresh** from the options menu
- Make sure the file extension is `.glsl` or `.slang`

## WebGL GLSL Editor Diagnostics Are Stale

WebGL GLSL Editor updates its diagnostics when Shader Studio changes its injected source. Focus or select the intended active shader in VS Code, then focus its Shader Studio panel or refresh it. Review the WebGL GLSL Editor Output channel if diagnostics do not refresh.

## Shader Validator Diagnostics Are Stale

Shader Studio creates a preamble in each workspace folder from the active shader, so diagnostics for a background shader can reflect the currently active Shader Studio pass. Focus or select the intended active shader in VS Code, then focus its Shader Studio panel or refresh it to regenerate the preamble. Check `.vscode/shader-studio-preamble.glsl`, then review Shader Studio output and the Shader Language Server or Shader Validator Output channel. Restart the companion server after confirming the generated preamble.

In a multi-root window, Shader Validator supports one workspace-wide preamble setting. Shader Studio leaves that setting unchanged: choose the intended folder's generated preamble and manually configure `shader-validator.glsl.preamble` to that file's path. Open folders in separate VS Code windows if they need independent companion settings.

If you already configured `webgl-glsl-editor.codeInjection` or `webgl-glsl-editor.codeInjectionSource`, Shader Studio intentionally preserves it. Remove or change that setting yourself to let Shader Studio manage the injection source.

If an existing `shader-validator.glsl.preamble` points to another file, Shader Studio intentionally preserves it. Remove or change that setting yourself to let Shader Studio use its generated preamble.

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

## Slang Workspaces

### Module Or Include Not Found

- Open the folder containing the shader as a VS Code workspace. Shader Studio does
  not load dependencies outside that folder.
- Check relative `#include` paths from the file containing the include, including
  nested pass directories.
- For an identifier import such as `import lib.palette;`, check the module path,
  filename, and the imported file's `module` declaration. Keep module declarations
  unique when local and workspace-root candidates could both match.
- Save newly created dependency files once if another tool has not placed them on
  disk. Unsaved edits to known/open workspace files are supported.
- Compiler messages may show an internal `/workspace/...` path. It maps to the same
  relative path beneath the owning VS Code workspace folder.

### Language Directive Or Module Error

The `#language` directive must be the first meaningful source item (comments and
whitespace may precede it). For `2025`, `2026`, and `latest`, put the `module`
declaration immediately after the directive, apart from comments and whitespace:

```slang
#language slang 2026
module image;
```

Do not put a language version in `.sha.json`. Directive-free roots and imported
modules intentionally use legacy behavior; include fragments inherit their
including translation unit and should not contain either header.

### Slang Hover Or Navigation Stops Working

- Confirm `shader-studio.slangLanguageFeatures` is `true` (the default).
- If another Slang extension registers duplicate providers, disable either its
  providers or Shader Studio's setting, then reload the VS Code window.
- Toggle `shader-studio.slangLanguageFeatures` off and on to recreate the VS Code
  worker. If Monaco is affected, close and reopen the preview. Reload the window if
  the packaged worker or WASM asset failed to load repeatedly.
- In a multi-root window, Shader Studio's VS Code language service manages the first
  workspace folder only. Open another folder in a separate window when you need its
  hover, completion, or navigation.

### Dependency Error Does Not Point At The Root

This is expected. Slang diagnostics use the URI and range of the module or include
that contains the problem. The Problems panel and Monaco marker navigation should
open that dependency, while the diagnostic's pass context identifies affected
roots where available. Language-service and compiler diagnostics are kept
separately, so both can be visible.

An imported or included helper owned by an active preview does not need `mainImage`.
An ownerless `.slang` file opened directly as a preview root does; select its owning
image shader or `.sha.json` instead.

### Preview Stays On The Previous Frame

Shader Studio deliberately keeps the last-good frame when a root or dependency
fails to compile. Fix or undo the reported error; the owning passes recompile and
the diagnostic clears without reopening the preview. Unrelated roots should remain
live throughout.

### Debugging An Imported Module Is Rejected

Phase 1 line debugging and variable capture support active root/pass code and
textual includes. Direct selection inside an imported translation unit or configured
common code produces `slang-cross-file-debug-unsupported`; normal rendering still
supports those sources. Select an expression in the active image or buffer pass.

### Manual Acceptance Fixture

The development fixture is at
`/Users/calum/Projects/slang-multipass-test/foundation/README.md`. Open
`/Users/calum/Projects/slang-multipass-test` as the workspace and follow its VS Code
and Monaco matrix. It covers language versions, navigation, unsaved and disk edits,
selective pass invalidation, errors and recovery, close/reopen, resize, feedback,
last-good frames, debugging, and capture. Restore the documented test constants
after each check.

For the full model, see [Slang Workspaces](../features/slang-workspaces.md).
