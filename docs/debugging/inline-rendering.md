# Inline Rendering

Place the cursor on a line to preview its value as color across the canvas. Turning debug mode on uses the cursor already placed in the active shader editor, so you do not need to move it first.

## Variable Detection

You can preview values on these kinds of lines:

| Pattern | Example |
|---------|---------|
| Declaration | `float d = length(p) - r;` |
| Reassignment | `uv = fragCoord / iResolution.xy;` |
| Compound assignment | `uv *= 2.0;` |
| Member access | `uv.x *= aspect;` |
| Expression statement | `test;` — a plain variable or expression on its own line |
| Return statement | `return length(p) - r;` (uses function return type) |

Select a supported scalar, vector, or matrix value to visualize it. For structs
and arrays, select a field or element rather than the whole value.

Lines that don't contain a detectable variable (comments, blank lines, function signatures, preprocessor directives) show an error indicator in the header line number, displayed as red text with an error tooltip.

### Line Resolution

When the cursor is on a non-debuggable line, the debug system tries to find the nearest debuggable line above it in the current function. This means you'll often get a useful visualization even when your cursor lands on a comment or a control-flow line.

When the cursor is on the entry line of `mainImage` (the opening `{` or first non-meaningful line), the system resolves to the last meaningful line in the function body instead.

## Type Visualization

The table below shows GLSL inline visualization. Slang and WGSL also support
scalar and vector previews; see their language guides for capture limits.

| Type | Visualization | Notes |
|------|--------------|-------|
| `float` | Grayscale | 0.0 = black, 1.0 = white |
| `vec2` | Red and green | X maps to red, Y maps to green |
| `vec3` | RGB color | Direct color interpretation |
| `vec4` | Direct output | All four channels passed through |
| `int` | Grayscale | 0 = black, 1 = white |
| `bool` | Black or white | `false` = black, `true` = white |
| `mat2/3/4` | First column visualized | Extracted and displayed as vector |

This table describes canvas previews, not whole-matrix capture in the Variable
Inspector. See [WGSL capture types](../features/wgsl.md#debugging-and-capture-types)
for supported matrices and component ordering.

Negative values appear black and values above 1 appear white. Use [normalization modes](normalization.md) to see out-of-range values.

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

Inline previews use the current preview resolution, including the scale, fixed
size, and aspect ratio selected in the toolbar or config panel.

## Next

[Variable Inspector](variable-inspector.md) — capture and inspect all in-scope variables
