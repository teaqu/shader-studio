# Native raster varyings and depth debug fixture

`raster-varyings.wgsl` and `../../slang/native-entrypoints/raster-varyings.slang`
render the standard mesh cube as an inset oblique projection. The authored
vertex stage rotates the cube position and normal, while the fragment stage
uses its interpolated UV and normal to give each visible face a different tint
and lighting. The background remains clear, so the cube silhouette is easy to
see.

Each fixture returns a structured result with one location-0 colour and one
fragment-depth value; it does not use multiple render targets. The native
vertex entry point consumes the standard 32-byte cube vertex layout: position,
normal, and UV at locations 0–2. Open either source with its sibling
`.sha.json`. In the debug panel, enable inline rendering or the Variable
Inspector, then hover or select the `value` line in `rasterColor`. The preview
visualizes the interpolated colour and the Variables section captures its
sampled range. Turning debug off restores the authored colour and depth result.
The `input` parameter is GPU-provided because rasterization supplies it;
helper-function parameters remain editable.
