# Shader Studio Debug Mode

Debug mode provides interactive, line-by-line visual debugging of GLSL fragment shaders. When enabled, it replaces the shader output with a visualization of the selected variable's value, letting you see exactly what each line computes across the entire screen.

## Overview

Debug mode works by rewriting your shader at compile time. When you place your cursor on a line containing a variable, the shader is modified to render that variable's value as color output. This works for variables in `mainImage`, helper functions, and across multiple buffer passes.

### How It Works

1. **Cursor tracking**: The extension sends cursor position updates to the webview
2. **Variable detection**: The debug system parses the GLSL to identify what variable is on the current line and its type
3. **Shader rewriting**: The original shader is modified to visualize the detected variable
4. **Live rendering**: The modified shader is compiled and rendered in real time

## Enabling Debug Mode

Toggle debug mode using the bug icon button in the MenuBar. When enabled:
- The debug panel appears to the right of the canvas
- Cursor movements update the visualization in real time
- The panel shows the current line, function context, and controls

## Variable Visualization

Each GLSL type is visualized differently:

| Type | Visualization |
|------|--------------|
| `float` | Grayscale (`vec3(value)`) |
| `vec2` | Red and green channels (`vec4(value, 0.0, 1.0)`) |
| `vec3` | RGB color (`vec4(value, 1.0)`) |
| `vec4` | Direct output |
| `int` | Grayscale with float conversion |
| `bool` | White (true) or black (false) |
| `mat2/3/4` | First column visualized |

### Supported Line Patterns

The debug system detects variables from:
- **Declarations**: `float d = length(p) - r;`
- **Reassignments**: `uv = fragCoord / iResolution.xy;`
- **Compound assignments**: `uv *= 2.0;`
- **Member access**: `uv.x *= aspect;`
- **Return statements**: `return length(p) - r;` (uses function return type)

## Debug Panel

The debug panel appears to the right of the canvas when debug mode is active. It contains a header toolbar and content sections.

### Header Toolbar

From left to right:

| Button | Description |
|--------|-------------|
| **Pixel Inspector** | Toggle the pixel inspector overlay (shows RGB/float/hex values at cursor) |
| **Inline Rendering** (eye icon) | Toggle line-by-line debug visualization on/off |
| **Line Lock** (lock icon) | Lock the debug view to the current line (cursor movements won't change the visualization) |
| **Normalize** (chart icon) | Cycle through normalization modes: Off > Soft > Abs |
| **Step** (staircase icon) | Toggle binary step threshold (independent of normalize mode) |
| **Step Edge** (number input) | Set the step threshold value (0.0-1.0, shown when step is active) |

After the buttons, the header displays:
- **Line number** (e.g., `L42`) — the current debug line (1-indexed)
- **Function name** — which function the cursor is in
- **Return type** — the function's return type

### Content Sections

#### Parameters

Shown when the cursor is inside a non-mainImage helper function. Each parameter of the function can be configured with different input modes:

| Mode | Description |
|------|-------------|
| **UV** | Map the parameter from screen UV coordinates (0-1 range) |
| **Centered UV** | Aspect-ratio-corrected centered coordinates (-1 to 1 range, using `(fragCoord * 2.0 - iResolution.xy) / iResolution.y`) |
| **Custom** | Set a constant value with type-specific editors (sliders, number inputs, color pickers) |
| **Preset** | Use a uniform-based expression (e.g., `iTime`, `sin(iTime)`, `iMouse.xy/iResolution.xy`) |

Type-specific custom editors:
- **float**: Number input + range slider (0-1)
- **vec2**: Two number inputs (X, Y)
- **vec3**: Three number inputs (R, G, B) + color picker
- **vec4**: Four number inputs (X, Y, Z, W)
- **int**: Number input (step 1)
- **bool**: Checkbox
- **sampler2D**: Channel dropdown (iChannel0-3)

#### Loops

Shown when the debug line is inside a loop. Displays:
- Line number of each enclosing loop
- The loop header text (e.g., `for (int i = 0; i < 10; i++)`)
- A max iterations input to cap loop execution (useful for raymarching loops)

Setting max iterations to empty or 0 removes the cap. The loop is rewritten with an early break:
```glsl
for (int i = 0; i < 10; i++) {
    if (i >= maxIter) break; // Injected cap
    // ... loop body
}
```

#### Line Content

Shows the source code of the current debug line in a monospace font.

#### Uniforms

Always visible (even when inline rendering is off). Displays live values of:
- `iTime` — elapsed time
- `iResolution` — viewport resolution
- `iMouse` — mouse position
- `iFrame` — frame counter
- `iTimeDelta` — time between frames
- `iFrameRate` — current FPS

## Normalization Modes

Normalization transforms the debug visualization to make certain value ranges more visible:

### Off (default)
Raw values are displayed directly. Values outside 0-1 will be clamped by the GPU, making them indistinguishable from 0 or 1.

### Soft Normalize
Maps values using `value / (abs(value) + 1.0) * 0.5 + 0.5`. This produces:
- Zero maps to **gray** (0.5)
- Positive values map toward white
- Negative values map toward black
- Never clips — all values are visible

Useful for signed distance fields and values that span both negative and positive ranges.

### Abs Normalize
Maps values using `abs(value) / (abs(value) + 1.0)`. This produces:
- Zero maps to **black** (0.0)
- Both positive and negative values map toward white
- Shows magnitude only, discarding sign

Useful for seeing the magnitude of values regardless of sign.

### Badge Indicator
When a normalize mode is active, a small badge appears on the button:
- **S** — Soft normalize
- **A** — Abs normalize

## Step Threshold

Step is an **independent toggle** that can be combined with any normalization mode. When enabled, it applies a binary threshold to the visualization using the GLSL `step()` function:

```glsl
fragColor = vec4(step(vec3(edge), fragColor.rgb), 1.0);
```

This converts the visualization to pure black-and-white based on whether each channel exceeds the threshold edge value.

### Use Cases
- **SDF debugging**: Set edge to 0.0 to see the exact zero-crossing of a distance field (the surface boundary)
- **Threshold visualization**: Quickly see which areas of the screen exceed a certain value
- **Combined with normalize**: Use soft normalize + step to see where a signed value crosses zero

The edge value defaults to 0.5 and can be adjusted from 0.0 to 1.0 using the number input that appears when step is active.

## Function Debugging

When the cursor is inside a helper function (not `mainImage`), the debug system wraps the function call:

1. A new `mainImage` is generated that calls the helper function
2. Function parameters are populated based on the selected parameter modes (UV, Centered UV, Custom, or Preset)
3. The function's return value (or an intermediate variable) is visualized

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

With the cursor on the `float d` line, debug mode generates:
```glsl
float sdf(vec2 p, float r) {
    float d = length(p) - r;
    return d;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    float result = sdf(uv, 0.5);
    fragColor = vec4(vec3(result), 1.0); // visualize d as grayscale
}
```

The parameter values (`uv` and `0.5`) can be changed via the Parameters section in the debug panel.

## Line Lock

When line lock is active (lock icon), the debug visualization stays on the current line even as you move your cursor elsewhere. This is useful for:
- Reading code while keeping a variable visualization visible
- Comparing different parts of the shader against a fixed debug view
- Adjusting parameters without losing the current debug target

## Architecture

### Packages

- **`@shader-studio/glsl-debug`** (`/debug/`) — Core debug logic
  - `ShaderDebugger` — Orchestrates shader modification, function context extraction, variable detection
  - `CodeGenerator` — Generates GLSL visualization code for each variable type
  - `GlslParser` — Parses GLSL to detect variables, types, and scope
  - `ControlFlowAnalyzer` — Analyzes loops, functions, and control flow

- **`/ui/`** — Debug UI components
  - `ShaderDebugManager` — Manages debug state, coordinates between extension and rendering
  - `DebugPanel.svelte` — Main debug panel component
  - `ParameterEditor.svelte` — Per-parameter editor with mode selection and type-specific inputs
  - `debugPanelStore.ts` — Svelte store for panel visibility and split ratio

### Data Flow

```
Extension (cursor position)
    ↓ postMessage
ShaderStudio.ts (message handler)
    ↓
ShaderDebugManager (state management)
    ↓ modifyShaderForDebugging()
ShaderDebugger.modifyShader() (GLSL rewriting)
    ↓
RenderingEngine (compile + render)
    ↓
DebugPanel.svelte (UI state display)
```

### Key Types

```typescript
interface ShaderDebugState {
  isEnabled: boolean;            // Debug mode toggle
  currentLine: number | null;    // Line being debugged (0-indexed)
  lineContent: string | null;    // Content of debug line
  filePath: string | null;       // Path to file being debugged
  isActive: boolean;             // Actually debugging (enabled + valid line)
  functionContext: DebugFunctionContext | null;
  isLineLocked: boolean;
  isInlineRenderingEnabled: boolean;
  normalizeMode: NormalizeMode;  // 'off' | 'soft' | 'abs'
  isStepEnabled: boolean;        // Binary threshold toggle
  stepEdge: number;              // Threshold value (0.0-1.0)
}

interface DebugFunctionContext {
  functionName: string;
  returnType: string;
  parameters: DebugParameterInfo[];
  isFunction: boolean;           // false for mainImage
  loops: DebugLoopInfo[];
}

interface DebugParameterInfo {
  name: string;
  type: string;
  uvValue: string;               // UV-mapped expression
  centeredUvValue: string;       // Centered UV expression
  defaultCustomValue: string;
  mode: ParameterMode;           // 'uv' | 'centered-uv' | 'custom' | 'preset'
  customValue: string;
}
```
