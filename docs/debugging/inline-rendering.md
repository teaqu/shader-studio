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

![Type visualization comparison](../assets/placeholders/template.svg)
_Placeholder: `debug-type-visualization.png` — Side-by-side showing the same shader with cursor on a float (grayscale), vec2 (red-green), and vec3 (RGB) variable._

Values outside the 0–1 range are clamped by the GPU, making negative values appear as black and values above 1 appear as white. Use [normalization modes](normalization.md) to see out-of-range values.

## Debugging in mainImage

When the cursor is inside `mainImage`, the shader is truncated at the debug line. Everything after the cursor line is removed, and the detected variable is visualized as `fragColor`.

```glsl
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;  // cursor here
    // everything below is removed
    float d = length(uv - 0.5);
    fragColor = vec4(vec3(d), 1.0);
}
```

Becomes:

```glsl
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    fragColor = vec4(uv, 0.0, 1.0);  // visualize uv as RG
}
```

Open control-flow braces (from `if`, `for`, `while` blocks) are automatically closed so the truncated shader compiles.

## Debugging in Helper Functions

When the cursor is inside a helper function (not `mainImage`), the debug system:

1. Truncates the helper function at the debug line
2. Generates a new `mainImage` that calls the helper function
3. Populates function parameters based on the [parameter modes](parameters.md) you configure
4. Visualizes the target variable

![Debugging a helper function](../assets/placeholders/template.svg)
_Placeholder: `debug-helper-function.png` — Editor with cursor inside a helper function, preview showing the visualized output, and the Parameters section visible in the debug panel._

### Example

Given this shader:

```glsl
float sdf(vec2 p, float r) {
    float d = length(p) - r;  // cursor here
    return d;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    float result = sdf(uv, 0.5);
    fragColor = vec4(vec3(result), 1.0);
}
```

With cursor on the `float d` line, debug mode generates:

```glsl
float sdf(vec2 p, float r) {
    float d = length(p) - r;
    return d;  // returns d (the truncated variable)
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    float result = sdf(uv, 0.5);
    fragColor = vec4(vec3(result), 1.0);  // visualize as grayscale
}
```

The parameter values (`uv` and `0.5`) can be changed via the [Parameters](parameters.md) section. The Parameters section appears automatically when debugging inside a helper function.

### Full Function Execution

When the cursor is on the entry line of a non-`mainImage` function (the function signature or opening brace), the entire function is executed untruncated and its return value is visualized. If the function returns `void`, no visualization is possible and an error is shown.

## Shadow Variables in Loops

When the debug line is inside a loop body, a **shadow variable** is created to capture the value from the last iteration. Without this, the visualization would only show the value from the loop's first iteration (since the shader truncates at the debug line).

```glsl
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    float total = 0.0;
    float _dbg_total;  // shadow variable declared before loop
    for (int i = 0; i < 10; i++) {
        total += float(i) * 0.1;  // cursor here
        _dbg_total = total;  // shadow assigned after debug line
    }
    fragColor = vec4(vec3(_dbg_total), 1.0);  // uses final iteration value
}
```

The shadow variable is declared before the outermost enclosing loop and assigned immediately after the debug line executes. This ensures you see the value from the **final** loop iteration.

## Global Variables

Variables declared at global scope (outside any function) are visible to the debug system. When the cursor is inside a function, global variables declared before the current line are included in the available scope.

If the cursor is on a global scope expression (outside any function), it is wrapped in a simple `mainImage` and visualized directly.

## Buffer Pass Debugging

In multi-pass shaders, the active debug target is automatically determined by which file you have open in the editor. When you open a buffer pass file (e.g. the `.glsl` file assigned to `BufferA`), debug mode targets that pass instead of the `Image` pass. A **buffer badge** in the debug panel header shows which pass is active.

## Toggling Inline Rendering

Inline rendering can be toggled independently from debug mode itself. When inline rendering is off but debug mode is still on:

- The [normalization and step](normalization.md) controls still work — they apply to the full shader output
- The [variable inspector](variable-inspector.md) still works
- The uniforms display and debug panel are still visible
- Moving the cursor doesn't change the visualization

This is useful when you want to use normalization or variable capture on the unmodified shader output.
