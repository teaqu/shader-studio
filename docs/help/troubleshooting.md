# Troubleshooting

## Preview Is Blank

- Confirm your shader has the correct signature: `void mainImage(out vec4 fragColor, in vec2 fragCoord)`
- Check the error tooltip near the play/pause button — a red indicator means compilation failed
- Try **Refresh** from the options menu
- Make sure the file extension is `.glsl`

## WebGL GLSL Editor Diagnostics Are Stale

WebGL GLSL Editor updates its diagnostics when Shader Studio changes its injected source. Focus or select the intended active shader in VS Code, then focus its Shader Studio panel or refresh it. Review the WebGL GLSL Editor Output channel if diagnostics do not refresh.

If you already configured `webgl-glsl-editor.codeInjection` or `webgl-glsl-editor.codeInjectionSource`, Shader Studio intentionally preserves it. Remove or change that setting yourself to let Shader Studio manage the injection source.

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
