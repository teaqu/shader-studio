# Inline Rendering


Inline rendering is the core debug visualization. When enabled, placing your cursor on a line containing a variable rewrites the shader to render that variable's value as color output across the entire canvas.

## Variable Detection

The debug system detects variables from these line patterns:

| Pattern | Example |
|---------|---------|
| Declaration | `float d = length(p) - r;` |
| Reassignment | `uv = fragCoord / iResolution.xy;` |
| Compound assignment | `uv *= 2.0;` |
| Member access | `uv.x *= aspect;` |
| Expression statement | `test;` — a plain variable or expression on its own line |
| Return statement | `return length(p) - r;` (uses function return type) |

User-defined struct types are supported in all of the above patterns.

Lines that don't contain a detectable variable (comments, blank lines, function signatures, preprocessor directives) show an error indicator in the header line number, displayed as red text with an error tooltip.

### Line Resolution

When the cursor is on a non-debuggable line, the debug system tries to find the nearest debuggable line above it in the current function. This means you'll often get a useful visualization even when your cursor lands on a comment or a control-flow line.

When the cursor is on the entry line of `mainImage` (the opening `{` or first non-meaningful line), the system resolves to the last meaningful line in the function body instead.

If a line has invalid syntax that would prevent compilation, the system preserves the original shader and lets the compiler surface the error directly.

## Type Visualization

Each GLSL type is visualized differently:

| Type | Visualization | Notes |
|------|--------------|-------|
| `float` | Grayscale — `vec4(vec3(value), 1.0)` | 0.0 = black, 1.0 = white |
| `vec2` | Red and green — `vec4(value, 0.0, 1.0)` | X maps to red, Y maps to green |
| `vec3` | RGB color — `vec4(value, 1.0)` | Direct color interpretation |
| `vec4` | Direct output | All four channels passed through |
| `int` | Grayscale with float conversion | Cast to float, then grayscale |
| `bool` | Black or white | `false` = black, `true` = white |
| `mat2/3/4` | First column visualized | Extracted and displayed as vector |



Values outside the 0–1 range are clamped by the GPU, making negative values appear as black and values above 1 appear as white. Use [normalization modes](normalization.md) to see out-of-range values.

## Debugging in Helper Functions

You can also debug inside helper functions (not just `mainImage`). Place the cursor inside any function and inline rendering will visualize variables there.

When debugging a helper function, the [Parameters & Loops](parameters-and-loops.md) section appears automatically so you can control what values are passed to the function's arguments.

## Loop Control

When the debug line is inside a loop, you can configure how many iterations run. This is useful for debugging expensive loops without the shader freezing. See [Parameters & Loops](parameters-and-loops.md) for more.

## Buffer Pass Debugging

In multi-pass shaders, the active debug target is automatically determined by which file you have open in the editor. When you open a buffer pass file (e.g. the `.glsl` file assigned to `BufferA`), debug mode targets that pass instead of the `Image` pass. A **buffer badge** in the debug panel header shows which pass is active.

## Toggling Inline Rendering

Inline rendering can be toggled independently from debug mode itself. When inline rendering is off but debug mode is still on:

- The [normalization and step](normalization.md) controls still work — they apply to the full shader output
- The [variable inspector](variable-inspector.md) still works
- The uniforms display and debug panel are still visible
- Moving the cursor doesn't change the visualization

This is useful when you want to use normalization or variable capture on the unmodified shader output.

## Resolution Behavior

Inline rendering always uses the **current live preview resolution**, not a stale config snapshot.

- Changing the toolbar **scale**, **fixed size**, or **aspect ratio** updates inline rendering immediately.
- Changing the Image pass resolution in the config panel also updates inline rendering immediately.
- When fixed size is active, the selected **scale still applies** to the render target.

This means the debug image you see should match the same effective canvas size shown in the toolbar resolution button.

## Next

[Variable Inspector](variable-inspector.md) — capture and inspect all in-scope variables
