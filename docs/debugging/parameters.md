# Parameter Editing


When the cursor is inside a helper function (not `mainImage`), the debug system generates a wrapper `mainImage` that calls the helper with configurable parameter values. The Parameters section appears in the debug panel to control how each parameter is populated.

![Parameter editor section](../assets/placeholders/template.svg)
_Placeholder: `debug-parameters.png` — Parameters section showing a vec2 parameter in UV mode and a float parameter with a custom slider value._

## Parameter Modes

Each parameter can be set to one of four modes:

### UV

Maps the parameter from screen UV coordinates (0–1 range). The mapping depends on the parameter type:

| Type | UV Expression |
|------|--------------|
| `float` | `uv.x` |
| `vec2` | `uv` |
| `vec3` | `vec3(uv, 0.0)` |
| `vec4` | `vec4(uv, 0.0, 1.0)` |

This is the default mode for spatial parameters. It creates a gradient across the screen that lets you see how the function behaves across a range of inputs.

### Centered UV

Aspect-ratio-corrected coordinates centered on the screen, ranging from approximately -1 to +1:

```glsl
vec2 centeredUv = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;
```

| Type | Centered UV Expression |
|------|----------------------|
| `float` | `centeredUv.x` |
| `vec2` | `centeredUv` |
| `vec3` | `vec3(centeredUv, 0.0)` |
| `vec4` | `vec4(centeredUv, 0.0, 1.0)` |

Best for functions that expect centered coordinates, like distance fields or polar transformations.

### Custom

Set a constant value using type-specific editors:

| Type | Editor |
|------|--------|
| `float` | Number input (step 0.01) + slider (0–1 range). Supports drag-scrub on the number input. |
| `int` | Number input (step 1). Supports drag-scrub. |
| `bool` | Checkbox toggle. |
| `vec2` | Per-component number inputs (X, Y). Each component can independently use a custom value or a preset. |
| `vec3` | Per-component number inputs (R, G, B) + **color picker** (hex input). Each component can independently use a custom value or a preset. |
| `vec4` | Per-component number inputs (X, Y, Z, W). Each component can independently use a custom value or a preset. |
| `sampler2D` | Channel dropdown: `iChannel0`, `iChannel1`, `iChannel2`, `iChannel3`. |
| User-defined struct | Inline expression editor (see below). |

For unknown or user-defined struct types, a **syntax-highlighted expression editor** is shown instead of structured inputs. You can type any valid GLSL expression directly. The editor uses CodeJar for inline editing with syntax highlighting.

### Preset

Use a built-in expression based on Shadertoy uniforms. Available presets depend on the parameter type:

**float presets:**

| Preset | Expression |
|--------|-----------|
| iTime | `iTime` |
| sin(iTime) | `sin(iTime)` |
| cos(iTime) | `cos(iTime)` |
| fract(iTime) | `fract(iTime)` |
| iTimeDelta | `iTimeDelta` |

**int presets:**

| Preset | Expression |
|--------|-----------|
| iFrame | `iFrame` |
| int(iTime) | `int(iTime)` |

**bool presets:**

| Preset | Expression |
|--------|-----------|
| iTime > 1.0 | `iTime > 1.0` |
| iFrame > 30 | `iFrame > 30` |

**vec2 presets:**

| Preset | Expression |
|--------|-----------|
| uv | `fragCoord.xy / iResolution.xy` |
| uv centered | `(fragCoord.xy * 2.0 - iResolution.xy) / iResolution.y` |
| iMouse.xy/iResolution.xy | `iMouse.xy / iResolution.xy` |
| iResolution.xy | `iResolution.xy` |

**vec3 presets:**

| Preset | Expression |
|--------|-----------|
| vec3(iTime) | `vec3(iTime)` |
| vec3(sin(iTime)) | `vec3(sin(iTime))` |

**vec4 presets:**

| Preset | Expression |
|--------|-----------|
| vec4(iTime) | `vec4(iTime)` |
| vec4(sin, cos, 0, 1) | `vec4(sin(iTime), cos(iTime), 0.0, 1.0)` |

## Component-Level Editing

For vector types (`vec2`, `vec3`, `vec4`), each component can be edited independently when in custom mode. Each component has its own mode toggle:

- **Custom** — enter a constant value
- **Preset** — use a component-level preset expression

### Component Presets

Individual vector components can use these presets:

| Preset | Expression |
|--------|-----------|
| iTime | `iTime` |
| sin(iTime) | `sin(iTime)` |
| cos(iTime) | `cos(iTime)` |
| fract(iTime) | `fract(iTime)` |
| uv.x | `uv.x` |
| uv.y | `uv.y` |

This lets you mix static and animated values in a single vector parameter. For example, you could set a `vec3` color parameter to `(sin(iTime), 0.5, uv.x)` by using presets for the R and B components and a custom value for G.

## Color Picker

For `vec3` parameters, a **color picker** is available in custom mode. It displays a hex color input that syncs bidirectionally with the R, G, B component values. Editing the hex value updates the component inputs, and editing component values updates the hex display.

## State Behavior

- **Switching functions**: Custom parameter values and modes are cleared when the cursor moves to a different function. This prevents stale overrides from one function being applied to another.
- **Staying in a function**: Parameter values persist as you move between lines within the same function.
- **sampler2D parameters**: The channel selector is always shown for sampler parameters regardless of mode, since textures can only be bound via `iChannel0–3`.
