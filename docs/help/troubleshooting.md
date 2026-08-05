# Troubleshooting

## Preview Is Blank

- Confirm your shader has the correct signature: `void mainImage(out vec4 fragColor, in vec2 fragCoord)`
- Check the error tooltip near the play/pause button — a red indicator means compilation failed
- Try **Refresh** from the options menu
- Make sure the file extension is `.glsl`

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
