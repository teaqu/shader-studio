# Compute lab

Open any `*.slang` file in this folder with Shader Studio; its same-named
`*.sha.json` config supplies the compute passes. These small projects are
intended to exercise one feature at a time.

| Project | What to check |
| --- | --- |
| `one-shot-storage` | `ComputeInit` runs once, initializes storage, and the Image pass reads current-frame storage. Use Reset to rearm it. |
| `count-dispatch` | A 1D `{ "count": 256 }` dispatch writes a storage gradient. |
| `repeated-substeps` | Six `iDispatch` substeps alternate between two storage buffers. |
| `layered-output` | A compute pass writes two texture layers; Image samples layer 1. |
| `raw-workgroups` | Explicit `{ x, y, z }` dispatches use workgroup counts rather than logical pixels. |
| `workgroup-coverage` | A fixed raw dispatch covers the full image at `[16, 8, 1]`; lower sizes visibly leave part of the output untouched. |
| `channel-cover` | A second compute pass covers the live dimensions of an input channel from a prior compute output. |
| `multi-entry` | Two Compute passes share one source file and select `clearSamples` / `animateSamples` independently. |
| `storage-edit-colours` | Inspect and edit four `float4` storage values; each one directly colours a screen quadrant. |
| `dispatch-modes` | A four-quadrant gallery for texel, count, explicit-workgroups, and storage-cover dispatch. |
| `game-of-life` | A self-feedback compute pass: each frame evolves a tiled set of Conway's Game of Life gliders. |

Each configuration is deliberately small enough to edit in the visual config
panel. Try changing dispatch mode, workgroup size, repeats, output layers, and
storage declaration names/sizes, then observe the validation and output.

`workgroup-coverage` is the clearest workgroup-size check: leave the raw
dispatch at `20 × 12 × 1`, then change the workgroup size in the UI. `[16, 8,
1]` covers the 320 × 96 output exactly; `[8, 4, 1]` covers only one quarter
of the output; `[32, 8, 1]` produces excess threads, which the shader
guards safely. Ordinary texel/count/cover dispatches preserve their logical
coverage when workgroup size changes, so their pixels should not change.
