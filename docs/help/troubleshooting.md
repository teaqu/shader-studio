# Troubleshooting

## Preview Is Blank

- Confirm your shader has the correct signature: `void mainImage(out vec4 fragColor, in vec2 fragCoord)`
- Check the error tooltip near the play/pause button — a red indicator means compilation failed
- Try **Refresh** from the options menu
- Make sure the file extension is `.glsl`

## Crashing or Halting

If the shader freezes or crashes:

- Disable **debug mode** — debugging adds overhead that can slow down or freeze expensive shaders
- Turn off the **variable inspector** — grid captures in particular are GPU-intensive
- Reduce the **resolution** — try 0.5x or lower to reduce GPU load
- Switch to **Manual** compile mode — this stops the shader from recompiling on every keystroke

## No Layout Showing

If panels have disappeared or the layout is broken:

- Use **Menu → Reset Layout** in the preview toolbar
- Or run **Shader Studio: Reset Layout** from the command palette
