# Troubleshooting

## Preview Is Blank

- Confirm your shader has the correct signature: `void mainImage(out vec4 fragColor, in vec2 fragCoord)`
- Check the error tooltip near the play/pause button — a red indicator means compilation failed
- Try **Refresh** from the options menu
- Make sure the file extension is `.glsl`

## Shader Validator Diagnostics Are Stale

Shader Studio creates one preamble per workspace folder from the active shader, so diagnostics for a background shader can reflect the currently active Shader Studio pass. Check `.vscode/shader-studio-preamble.glsl`, then review Shader Studio output and the Shader Language Server or Shader Validator Output channel. Restart the companion server after confirming the generated preamble.

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
