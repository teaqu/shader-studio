# Native raster varyings and depth debug fixture

`raster-varyings.wgsl` and `../../slang/native-entrypoints/raster-varyings.slang`
use the same cube mesh, authored vertex-to-fragment varyings, and a
structured result containing one location-0 color plus fragment depth. They do
not use multiple render targets.

The native vertex entry point consumes the cube position at location 0 from the
standard 32-byte mesh vertex layout. Open either source with its sibling `.sha.json`. In the debug panel, enable
inline rendering or the Variable Inspector, then hover or select the `value`
line in `rasterColor`. The preview visualizes the interpolated color and the
Variables section captures its sampled range. Turning debug off restores the
authored color and depth result. The `input` parameter is identified as
GPU-provided because rasterization supplies it; helper-function parameters remain editable.
