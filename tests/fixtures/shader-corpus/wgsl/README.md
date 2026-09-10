# WGSL mirrors of the Slang multipass tests

Every image/compute/vertex test in `../slang/` recreated as `.wgsl`, so the
Shader Studio WGSL/WebGPU path can be validated against the same visuals as
the Slang/WebGPU and GLSL/WebGL paths. Open a `.wgsl` file in the Shader
Studio extension; its config auto-loads from the sibling `.sha.json`.
Channel bindings match the Slang originals — only the shader language
changed. `../assets/…` resolves to the same shared media, and `@/…` paths
resolve from the workspace root exactly as in `../slang/`.

`wgsl/` mirrors the `../slang/` subtree (same relative layout, same depth),
so every relative config path reads identically. `uniforms.ts` and
`custom-uniforms.ts` are copies of the Slang scripts — script uniforms arrive
as injected globals in all three languages.

## Translations follow the WGSL contract

(`docs/features/wgsl-authoring.md`, `channels.md`, `vertex-shaders.md`,
`compute.md` in shader-studio-3):

- Image shaders define `fn mainImage(coord: vec2f) -> vec4f`; never redeclare
  built-ins (`iResolution`, `iTime`, `iFrame`, `iMouse`, `iDate`,
  `iCameraPos`, `iCameraDir`, `iWorldPosition`, `iNormal`).
- Channels are free functions named after the config key:
  `iChannel0Sample(uv)`, `iChannel0SampleLevel(uv, 0.0)`,
  `iChannel0Size() -> vec2u`, `iChannel0Time() -> f32`,
  `iChannel0Loaded() -> bool` — and custom keys work too
  (`albedoSample`, `patternTexSample`, `historyBufferSample`).
  `Sample` needs uniform control flow; compute stages (and vertex hooks)
  must use `SampleLevel`.
- Vertex hooks take pointers:
  `fn mainVertex(position: ptr<function, vec3<f32>>, …)` and edit through
  them. They can read render-stage storage and `SampleLevel` channels, like
  the Slang hooks they mirror.
- Compute shaders declare `@compute @workgroup_size(x, y, z)` entries
  (selected by `entryPoint` when a file holds several); storage buffers are
  declared by the engine and accessed by name; texture output goes through
  `writeOutput(coord, color)` (or the 3-arg layered form).
- No ternary operator (`select` instead), no `++` on loop vars in some
  positions (use `+= 1`), no `fmod`/`lerp`/`saturate`/`float4` spellings, no
  `#include`/`import` (shared code goes in the `common` pass, inlined here
  where Slang uses modules), no `enable` unless the GPU supports it.

## Intentional deviations from the Slang originals

- `uniforms.wgsl` tile 4: WGSL has no `iChannelResolution` array, so the
  unused-slot check became a Sample vs SampleLevel(…, 0.0) agreement probe
  (stays green).
- `foundation/*`: WGSL has no module system, so Slang `import`/`#include`
  graphs are inlined into the `common.wgsl` pass — same helpers, same
  visuals. `foundation/versions/*`, `modules/*`, and `includes/*` have no
  WGSL mirror at all: they test the Slang language mode / module system
  itself, which has no counterpart.
- `cat-body.wgsl`/`cat-body.sha.json`: the GLSL originals are named
  `cat-glsl.glsl`/`cat-glsl.sha.json`; the WGSL pair is named after its
  Image file (`cat-body`) so the sibling config auto-loads.
- `feature-coverage.common.wgsl`: Slang spells `coverageGain` as overloads,
  but WGSL rejects user-function overloading, so the vec3 variant is
  `coverageGainVec`.
- `intellisense.wgsl`: WGSL removed `isFinite`/`isInf`/`isNan`, so
  classification is manual `(x == x)` / `abs` comparisons with identical
  values on the exercised range.

## Coverage

| Open | Exercises | Slang original |
|---|---|---|
| `flow.wgsl` | buffer→Image channels, unused `iChannel2` (expect zero WebGPU validation errors), CatHead model geometry | `../slang/flow.slang` |
| `buffers/buffer_a.wgsl` | self-feedback ping-pong, `iMouse`, HDR ink | `../slang/buffers/buffer_a.slang` |
| `buffers/buffer_b.wgsl` | half-res pass, cross-buffer read | `../slang/buffers/buffer_b.slang` |
| `common.wgsl` | `common` prepended to all passes | `../slang/common.slang` |
| `test.wgsl` | minimal image pass (official corpus file) | `../slang/test.slang` |
| `texture.wgsl` | 2D texture, v-flip/orientation, nearest/clamp (official corpus file) | `../slang/texture.slang` |
| `video.wgsl` | video channel, per-frame refresh, time marker | `../slang/video.slang` |
| `video_audio.wgsl` | video + audio channels, spectrum + waveform | `../slang/video_audio.slang` |
| `cubemap.wgsl` | cubemap channel, six-direction sampling | `../slang/cubemap.slang` |
| `keyboard.wgsl` | keyboard rows: held, pressed, toggled | `../slang/keyboard.slang` |
| `uniforms.wgsl` | script uniforms, `iDate`, channel metadata, camera | `../slang/uniforms.slang` |
| `ich.wgsl` | four-channel sampling + size/loaded/time metadata | `../slang/ich.slang` |
| `33channels.wgsl` | 31-channel bind-group stress test | `../slang/33channels.slang` |
| `custom-uniforms.wgsl` | script uniforms `uRed/uGreen/uOffset` | `../slang/custom-uniforms.slang` |
| `particles.wgsl` + `init/present.wgsl` | compute init + half-res present, storage readback | `../slang/particles.slang` |
| `shadertoy.wgsl` | bare-minimum sanity shader (no config) | `../glsl/shadertoy.glsl` |
| `shadertoy2.wgsl` + `shadertoy2.computea.wgsl` | sphere geometry + empty compute coexistence | `../slang/shadertoy2.slang` |
| `vertex.wgsl` + `vertex_vertex.wgsl` + `vertex_init.wgsl` | vertex hook with storage read + channel sampling | `../slang/vertex.slang` |
| `fullscreen-vertex.wgsl` + `.vert.wgsl` | fullscreen ripple hook | `../slang/fullscreen-vertex.slang` |
| `plane.wgsl` + `plane.vert.wgsl` | plane geometry, wave displacement, `iNormal` lighting | `../slang/plane.slang` |
| `two-meshes.wgsl` + `visor.wgsl` + `visor.vertex.wgsl` | GLB model, buffer feed, model wobble | `../slang/two-meshes.slang` |
| `cat-body.wgsl` + `cat-head.wgsl` | CatBody/CatHead meshes, buffer composite | `../glsl/cat-glsl.glsl` |
| `intellisense.wgsl` + `.vert.wgsl` | intrinsic catalogue (WGSL spellings marked NOTE) + hook | `../slang/intellisense.slang` |
| `intellisense_compute.wgsl` + `compute-lab/passes/intellisense-compute.wgsl` | compute built-ins display | `../slang/intellisense_compute.slang` |
| `gravity/` | N-body sim: init/sim/present + `Body` struct in common | `../slang/gravity/` |
| `structs/` | stride validation: 5 struct layouts, band display | `../slang/structs/` |
| `parity/channels/named.wgsl` | custom channel key (`albedoSample`) | `../slang/parity/channels/named.slang` |
| `parity/pass-timing/` | current-frame buffer reads, `iFrame` marker | `../slang/parity/pass-timing/` |
| `parity/reset-feedback/` | Reset clears feedback before frame zero | `../slang/parity/reset-feedback/` |
| `parity/resize-feedback/` | resize preserves absolute feedback position | `../slang/parity/resize-feedback/` |
| `parity/pixel-inspector/gradient.wgsl` | inspector values equal coordinates (no config) | `../slang/parity/pixel-inspector/gradient.slang` |
| `backend-differences/precision/` | float accumulation vs frame-count ramp | `../slang/backend-differences/precision/` |
| `feature-coverage*.wgsl` | kitchen sink: arrays, overloads, derivatives, bit ops, custom keys, vertex offset | `../slang/feature-coverage.slang` |
| `compute-lab/` (12 tests) | every dispatch mode, storage cover, substeps, layers, system values | `../slang/compute-lab/` |
| `foundation/workspace/` | multipass + common with inlined import graph | `../slang/foundation/workspace/` |
| `foundation/debugging/` | debug-coverage + black-source history viewer | `../slang/foundation/debugging/` |

Not mirrored: `foundation/versions/*`, `modules/*`, `includes/*` (Slang
module system — no WGSL counterpart) and `_glsl` twins (same test, another
language — each concept is mirrored once).

## Verification (re-run after edits)

- `node tests/check.mjs` (repo root) — static gate, no dependencies: JSON
  validity, every `path`/`script`/`vertex` resolves, default Image files
  exist, three-way counterparts present, no orphaned `.wgsl`, no
  Slang/GLSL remnants or WGSL-removed builtins.
- Parse + wrap: all `.wgsl` files through the addon's own
  `parseWgslDocument` and all passes through `wrapWgslImageSource` /
  `wrapWgslComputeSource` (see the corpus suite in shader-studio-3).
- GPU compilation in the shader-studio-3 corpus suite
  (`ShaderFixtureCorpus.corpus.test.ts`): all 45 WGSL projects compile and
  render, vertex hooks included. Note the suite pins one Chromium/Tint, so
  mirrors avoid version-fragile constructs (plain `=` instead of `op=` on
  pointer swizzles, no removed builtins).
- `tools/regen-wgsl-config.py` regenerates `wgsl/<stem>.sha.json` from
  `slang/<stem>.sha.json` when adding new mirrors.
