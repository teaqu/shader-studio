# Normalization and Step


Normalization modes and the step threshold are post-processing tools that transform the debug visualization to make certain value ranges visible. They can be used together and work in both inline rendering mode and on the full unmodified shader.

## Normalization Modes

Cycle through modes by clicking the **chart icon** in the debug panel header. A badge on the button shows the active mode: **S** for soft, **A** for abs.

### Off (Default)

Raw values are displayed directly. The GPU clamps output to 0–1, which means:

- Negative values appear as **black** (indistinguishable from 0)
- Values above 1.0 appear as **white** (indistinguishable from 1)
- Only values in the 0–1 range show meaningful variation

Use this mode when your values are naturally in the 0–1 range (UV coordinates, normalized colors, etc.).

### Soft Normalize

**Formula:** `value / (abs(value) + 1.0) * 0.5 + 0.5`

Maps any value range to the visible 0–1 range:

| Input Value | Output | Appearance |
|-------------|--------|------------|
| Large negative | Near 0.0 | Dark |
| -1.0 | 0.25 | Dark gray |
| 0.0 | **0.5** | **Mid gray** |
| +1.0 | 0.75 | Light gray |
| Large positive | Near 1.0 | Bright |

Key properties:

- Zero always maps to **gray** (0.5)
- Never clips — every value is visible
- Preserves sign information (negative = darker, positive = brighter)
- Smoothly compresses large ranges

**Best for:**

- Signed distance fields — zero-crossing (the surface) appears as mid-gray
- Normal vectors — components in the -1 to +1 range spread across the full brightness range
- Any value that spans negative and positive ranges

### Abs Normalize

**Formula:** `abs(value) / (abs(value) + 1.0)`

Maps the **magnitude** of any value to 0–1, discarding sign:

| Input Value | Output | Appearance |
|-------------|--------|------------|
| 0.0 | **0.0** | **Black** |
| ±0.5 | 0.33 | Dark gray |
| ±1.0 | 0.5 | Mid gray |
| ±10.0 | 0.91 | Bright |
| ±∞ | 1.0 | White |

Key properties:

- Zero always maps to **black**
- Both positive and negative values appear the same
- Shows magnitude only, discarding sign
- Large values saturate toward white

**Best for:**

- Finding where values are non-zero (errors, residuals)
- Visualizing magnitude regardless of direction
- Debugging distance fields where you only care about distance, not inside/outside



## Step Threshold

Step is an **independent toggle** — it can be combined with any normalization mode or used alone. Toggle it with the **staircase icon**. When enabled, a number input appears for the edge value.

### How It Works

Applies the GLSL `step()` function to the visualization output:

```glsl
fragColor = vec4(step(vec3(edge), fragColor.rgb), 1.0);
```

Each color channel is independently compared to the threshold:

- Below the edge: **black** (0.0)
- At or above the edge: **white** (1.0)

The edge value ranges from 0.0 to 1.0 (default **0.5**). You can type a value or drag-scrub the input to adjust it.







## Next

[JavaScript Transpilation](../help/transpilation.md) — transpile GLSL to JavaScript for debugging
