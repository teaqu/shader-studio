# Pixel Inspector

The pixel inspector shows the exact values under your cursor as you hover over the shader preview. It displays RGB, float values, hex codes, fragCoord, and UV coordinates in real time inside the debug panel.

## Enabling

Toggle the pixel inspector with the <i class="codicon codicon-inspect"></i> button in the debug panel header.

## Using

- **Hover** over the preview canvas — values update live in the debug panel as you move
- **Click** to lock the inspector to a specific position so the values stay visible while you move the cursor elsewhere
- **Click again** to unlock and resume following the cursor

The zoom view shows a magnified view of the pixels around the cursor with crisp pixel rendering.

- **Scroll** over the zoom view to change the zoom level (2×–30×). The current zoom briefly appears as an overlay label, then fades.
- **Click** on any pixel in the zoom view to jump the inspector to that exact pixel.
- **Drag** inside the zoom view to pan to adjacent pixels — drag right to see pixels to the left, like panning a map.

The inspector updates in real time as the shader animates, so you can watch how values change at a fixed point.

## Values Shown

| Field | Description |
|-------|-------------|
| RGB | Integer channel values (0–255) |
| Hex | Hex colour code |
| Float | Normalised float values (0.0–1.0) |
| fragCoord | Pixel coordinates in shader space |
| UV | Normalised UV coordinates (0.0–1.0) |

## Next

[Inline Rendering](inline-rendering.md) — visualize any variable line-by-line as color output
