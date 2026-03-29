# Debug A Shader


## Goal

Visualize intermediate values by line while editing GLSL.

## Quick Steps

1. Open a shader preview.
2. Click the **Debug** icon in the preview toolbar.
3. Move your cursor across lines in the `.glsl` file.
4. Watch output switch to value visualization for the current line.

## Debug Panel Controls

The debug panel header provides quick access to all debug tools:

- **Pixel Inspector** — probe pixel values under cursor
- **Inline Rendering** — show/hide debug render overlay
- **Line Lock** — freeze debug target line
- **Normalize** — cycle `Off`, `Soft`, `Abs` to reveal out-of-range values
- **Step** — apply binary threshold with configurable edge
- **Variable Inspector** — capture all in-scope variable values

## Common Uses

- Confirm signed-distance-field boundaries with **Step** at edge 0.0
- Inspect helper function outputs using **parameter controls** (UV, centered UV, custom values, presets)
- Find exploding values with **normalization modes** (soft maps zero to gray, abs maps zero to black)
- Cap expensive **loop iterations** to debug raymarching without lag
- Use the **variable inspector** in grid mode to see spatial distribution with thumbnails and histograms

## Next

[Configure Buffers And Inputs](../features/config-buffers.md) — move on to multi-pass shaders, textures, and channel setup.
