# Slang multi-pass test workspace

One test corpus in three shading languages. Open this folder as the VS Code
workspace, then open a shader under `slang/`, `glsl/`, or `wgsl/` in the
Shader Studio extension — its config auto-loads from the sibling `.sha.json`.

```
slang-multipass-test/
  slang/    every .slang test (Slang/WebGPU path)
  glsl/     every .glsl test (GLSL/WebGL path)
  wgsl/     every .wgsl test (WGSL/WebGPU path)
  assets/   shared media: textures, video, audio, GLB models
```

Each language directory is self-contained: shaders, their `.sha.json`
configs, buffer pairs, vertex hooks, compute passes, and uniform scripts all
live side by side, mirroring the same relative layout. Only `assets/` (and
`@/…` workspace-anchored paths) are shared across languages. `uniforms.ts`
and `custom-uniforms.ts` are duplicated per language dir so each tree opens
standalone.

This repo tracks
`shader-studio-3/tests/fixtures/shader-corpus` file-for-file
(same visuals, same checklists below) — only the layout differs: the corpus
keeps all languages flat, this repo splits them by folder. When re-syncing,
map `slang/…`/`glsl/…` back onto the corpus root.

Open `slang/flow.slang` in the Shader Studio extension. Config auto-loads
from `slang/flow.sha.json`.

For the GLSL equivalent, open `glsl/flow_glsl.glsl`. Config auto-loads from
`glsl/flow_glsl.sha.json` and points at the matching GLSL buffer/common
files. For the WGSL equivalent, open `wgsl/flow.wgsl` (`wgsl/flow.sha.json`).

Open `slang/texture.slang` to test Slang/WebGPU image texture channels.
Config auto-loads from `slang/texture.sha.json` and points at
`assets/orientation-texture.svg`. WGSL: `wgsl/texture.wgsl`.

Open `slang/video.slang` to test Slang/WebGPU video channels. Config
auto-loads from `slang/video.sha.json` and points at
`assets/video-channel-test.mp4`. WGSL: `wgsl/video.wgsl`.

Open `glsl/video_audio_glsl.glsl` to test a GLSL/WebGL video file used as
both video and shader-readable audio. Config auto-loads from
`glsl/video_audio_glsl.sha.json` and points both channels at
`assets/video-channel-test-withaudio-faded_vscode.mp4`. WGSL:
`wgsl/video_audio.wgsl` (`slang/video_audio.slang` for Slang).

Open `slang/cubemap.slang` to test Slang/WebGPU cubemap channels. Config
auto-loads from `slang/cubemap.sha.json` and points at
`assets/cubemap-cross.svg`.

For the GLSL/WebGL equivalent, open `glsl/cubemap_glsl.glsl`. Config
auto-loads from `glsl/cubemap_glsl.sha.json` and points at the same cubemap
source image. WGSL: `wgsl/cubemap.wgsl`.

Open `slang/keyboard.slang` to test Slang/WebGPU keyboard channels. Config
auto-loads from `slang/keyboard.sha.json`. WGSL: `wgsl/keyboard.wgsl`.

Open `slang/uniforms.slang` to test Slang/WebGPU custom uniforms, `iDate`,
`iChannelResolution`, `iCh0`–`iCh2`, `iCameraPos`, and `iCameraDir`; its
config is `slang/uniforms.sha.json`. For the GLSL/WebGL reference, open
`glsl/uniforms_glsl.glsl`, which loads `glsl/uniforms_glsl.sha.json`, and for
WGSL open `wgsl/uniforms.wgsl`. All three use their own `uniforms.ts` copy
and matching channel inputs.

Open `slang/ich.slang` for a focused `iCh0`–`iCh3` test covering texture,
audio, keyboard, and cubemap samplers plus `.size`, `.time`, and `.loaded`.
Compare it with `glsl/ich_glsl.glsl`; their configs bind the same four
assets/channel kinds. WGSL: `wgsl/ich.wgsl` (free-function channels —
`iChannel0Sample`, `iChannel0Size()`, `iChannel0Time()`,
`iChannel0Loaded()`).

Open `slang/vertex.slang` to test a custom Slang vertex stage. Its config,
`slang/vertex.sha.json`, initializes `vertexTransform` in a compute pass,
then `slang/vertex_vertex.slang` reads that storage buffer and samples its
`iChannel3` texture input, rendering an inset, offset triangle rather than
the default fullscreen triangle. WGSL: `wgsl/vertex.wgsl` with
`wgsl/vertex_vertex.wgsl` (pointer-style hook) and `wgsl/vertex_init.wgsl`.

Open `glsl/vertex_glsl.glsl` for the WebGL equivalent. Its config,
`glsl/vertex_glsl.sha.json`, points at `glsl/vertex_glsl_vertex.glsl` and
should render a rotated inset panel with black visible around it.

## What each piece exercises

| Piece | Feature under test |
|---|---|
| `slang/flow.slang` (Image) | buffer→Image channels (current-frame reads), common code in Image |
| `slang/flow.slang` iChannel2 | declared-but-never-sampled channel → explicit bind-group layout (expect ZERO WebGPU validation errors in console) |
| `slang/buffers/buffer_a.slang` | self-feedback ping-pong (reads own previous frame), rgba16float accumulation, iMouse |
| `slang/buffers/buffer_b.slang` | half-resolution pass (`resolution.scale: 0.5`), cross-buffer read |
| `slang/common.slang` | `common` prepended to all passes (`palette`/`blob` used in BufferA + Image) |
| `glsl/flow_glsl.glsl` + GLSL buffers | WebGL equivalent of the same multipass graph |
| `wgsl/flow.wgsl` + WGSL buffers | WebGPU/WGSL equivalent of the same multipass graph |
| `slang/texture.slang` | 2D texture input, v-flip/orientation, nearest/clamp sampler |
| `assets/orientation-texture.svg` | Local image asset for texture channel testing |
| `slang/video.slang` | Video input, per-frame texture refresh, video controls |
| `assets/video-channel-test.mp4` | Local synthetic MP4 for video channel testing |
| `glsl/video_audio_glsl.glsl` | GLSL video plus audio-texture input using one MP4 in two channels |
| `assets/video-channel-test-withaudio-faded_vscode.mp4` | Local H.264 test video for audio-from-video playback testing |
| `slang/cubemap.slang` | Cubemap input, cube texture binding, six-direction sampling |
| `glsl/cubemap_glsl.glsl` | WebGL equivalent of the cubemap smoke test |
| `assets/cubemap-cross.svg` | Local T-cross cubemap source image |
| `slang/keyboard.slang` | keyboard texture rows: held, pressed, toggled |
| `slang/uniforms.slang` | custom, date, channel-resolution, `iChN`, and camera uniforms |
| `glsl/uniforms_glsl.glsl` | WebGL reference for the same uniform validation image |
| `wgsl/uniforms.wgsl` | WGSL reference (no `iChannelResolution` array — Sample/SampleLevel agreement probe instead) |
| `slang/uniforms.ts` (+ per-language copies) | animated float, vec2, vec3, vec4, and bool script values |
| `slang/ich.slang` | all four `iChN` wrappers: 2D/cube sampling and metadata |
| `glsl/ich_glsl.glsl` | WebGL reference for the focused four-channel `iChN` test |
| `slang/vertex.slang` + `slang/vertex_vertex.slang` | custom Slang vertex hook reading compute-initialized storage and `iChannel3` |
| `glsl/vertex_glsl.glsl` + `glsl/vertex_glsl_vertex.glsl` | path-only custom GLSL vertex pass and `position` attribute |
| `wgsl/vertex.wgsl` + `wgsl/vertex_vertex.wgsl` + `wgsl/vertex_init.wgsl` | WGSL vertex hook with storage read and explicit-level channel sampling |
| `slang/compute-lab/` | compute passes: dispatch modes, storage, substeps, texture output (WGSL twins under `wgsl/compute-lab/`, no GLSL — WebGL skips compute) |
| `slang/parity/` | Slang/GLSL functional parity pairs (WGSL twins under `wgsl/parity/`) |
| `slang/foundation/` | Slang workspace/import/include/version fixtures (WGSL twins only for the multipass visuals under `wgsl/foundation/` — the module system has no WGSL counterpart) |
| `slang/33channels.slang` | 31-channel bind-group stress test (WGSL: `wgsl/33channels.wgsl`) |
| `slang/particles.slang`, `slang/gravity/`, `slang/structs/` | storage + compute image pipelines (WGSL twins under `wgsl/`) |
| `slang/plane.slang`, `slang/two-meshes.slang` | plane/model geometry with vertex hooks (WGSL twins under `wgsl/`) |
| `assets/two-meshes.glb` | CatHead/CatBody GLB fixture shared by all three languages |

## Verification checklist

1. **Orientation:** RED bar along TOP edge, GREEN along LEFT. Red at bottom = v-flip broken.
2. **Feedback direction:** orbiting ink trails fall DOWNWARD, smooth (no vertical mirroring/jitter between frames).
3. **Mouse:** hold button — white paint appears directly UNDER the cursor, not mirrored.
4. **Glow:** soft halo around the ink (BufferB half-res blur working, visibly chunkier than the sharp ink).
5. **Console:** zero WebGPU validation errors (iChannel2 is declared but unsampled on purpose).
6. **Resize:** resize the panel — image stays sharp, iResolution updates, trails keep working (buffer textures recreated).
7. **Live buffer edit:** with shader locked, edit `slang/buffers/buffer_a.slang` (e.g. change decay 0.985 → 0.90) and save — recompiles without freezing, trails shorten.
8. **Error paths:** break `slang/buffers/buffer_b.slang` syntax → pass-prefixed error, previous frame keeps rendering; point a channel at `"source": "common"` → clear config error, not black.

## Texture input smoke test

Open `slang/texture.slang` (`glsl/texture_glsl.glsl`, `wgsl/texture.wgsl`).

Expected:

1. Texture loads with no console validation errors.
2. Full image shows RED along the TOP, GREEN along the LEFT, BLUE along the BOTTOM, and YELLOW along the RIGHT.
3. The five swatches down the left side sample top/left/bottom/right/center in that order.
4. If red appears at the bottom or blue appears at the top, texture v-flip parity is wrong.

## Video input smoke test

Open `slang/video.slang` (`glsl/video_glsl.glsl`, `wgsl/video.wgsl`).

Expected:

1. Moving color bars fill the frame with no console validation errors.
2. The four swatches down the left side sample top/left/bottom/right from the video.
3. The white marker glides horizontally even if video playback stutters, so shader time and video refresh are easy to tell apart.
4. Pause/play/reset/mute controls in the channel preview operate on the video.

## Video file as audio smoke test

Open `glsl/video_audio_glsl.glsl` (`slang/video_audio.slang`, `wgsl/video_audio.wgsl`).

Expected:

1. `iChannel0` shows the moving test video.
2. `iChannel1` is an Audio input pointing at the same MP4.
3. The Audio tab should show the waveform/controls only if the MP4 audio decoded successfully.
4. The shader shows cyan spectrum bars and a yellow waveform line over the dimmed video.

## Cubemap input smoke test

Open `slang/cubemap.slang` (`wgsl/cubemap.wgsl`).

For comparison, open `glsl/cubemap_glsl.glsl`.

Expected:

1. The image loads with no console validation errors.
2. The scene shows broad cubemap face colors across the frame, with magenta near the center because it looks toward +Z.
3. The six swatches down the left side are, top to bottom: red (+X), green (-X), blue (+Y), yellow (-Y), magenta (+Z), cyan (-Z).
4. Black/static output means the cubemap did not load or the shader was not compiled with cube texture bindings.

## Keyboard input smoke test

Open `slang/keyboard.slang` (`glsl/keyboard_glsl.glsl`, `wgsl/keyboard.wgsl`).

Expected:

1. Hold `A`, `S`, or `D` to light the red, green, or blue center panels.
2. Tap `Space` to flash the white top band for one rendered frame.
3. Tap `ArrowLeft` to toggle the magenta left badge; tap `ArrowRight` to toggle the cyan right badge.
4. Pause rendering, press keys, then unpause: keyboard texture updates should have stayed frozen while paused, with transient pressed state already cleared when rendering resumes.

## Custom and ShaderToy uniform smoke test

Open `slang/uniforms.slang`, then compare with `glsl/uniforms_glsl.glsl` and `wgsl/uniforms.wgsl`.

Expected:

1. The five large top panels animate: grayscale float fill, vec2 red/green, vec3 RGB, vec4 RGB with a moving white alpha band, and a bool panel alternating green/blue once per second.
2. The two thin middle strips show camera position (left, initially mid-grey) and direction (right, initially yellow). Hold W/A/S/D/Q/E to move; drag the canvas or use arrow keys to look. The small badge at the right stays green while the direction is normalized.
3. Pause after moving the camera, then keep moving/looking: the displayed strips stay frozen until unpaused. Reset returns position to mid-grey and direction to yellow.
4. All five lower status tiles are green. The middle three validate `inputs.iChannelN.size` and `.loaded` for texture (256×256), audio (512×2), and keyboard (256×3); the last is a fixed success tile because Slang does not expose unconfigured inputs. (WGSL checks `iChannelNSize()`/`iChannelNLoaded()` free functions and probes Sample vs SampleLevel agreement instead of the unused-slot tile.)
5. The texture tile contains an off-center swatch sampled through `inputs.iChannel0.Sample`; it must match between GLSL and Slang, which also checks the wrapper's V-flip. A thin white bar at the bottom of the audio tile moves with `inputs.iChannel1.time`; the date tile has its own seconds bar.
6. Slang and GLSL output should match visually and produce no validation errors.
7. Selecting expressions that use `uVec3`, `uBool`, `iDate`, `inputs.iChannel0.size`, `inputs.iChannel1.time`, or either camera uniform in the debugger should produce the same values as the rendered panels.

## Slang input-object smoke test

Open `slang/ich.slang`, then compare with `glsl/ich_glsl.glsl` and `wgsl/ich.wgsl`.

Expected:

1. All four thin status strips are green; red identifies a bad `.size`, `.loaded`, or `.time` value.
2. Top-left texture panel has RED at TOP, GREEN at LEFT, BLUE at BOTTOM, and YELLOW at RIGHT. A vertical inversion means the 2D wrapper's V-flip is wrong.
3. Top-right audio panel shows cyan spectrum bars, a yellow waveform, and a white marker moving with `inputs.iChannel1.time`.
4. Bottom-left keyboard panel lights red/green/blue while holding A/S/D, and flashes its white band for one rendered frame when Space is pressed.
5. Bottom-right cubemap panel shows the cubemap, with six bottom probes ordered red, green, blue, yellow, magenta, cyan (+X, -X, +Y, -Y, +Z, -Z).
6. Slang and GLSL output match visually and neither produces validation errors.

## Custom vertex shader smoke tests

Open `slang/vertex.slang` (`wgsl/vertex.wgsl`).

Expected:

1. A colored, gridded inset triangle appears offset from the center with black around it. Its corners are slightly displaced by the `iChannel3` orientation texture, confirming vertex-stage sampling.
2. The config panel includes a `Vertex shader` path field, including when Geometry is Fullscreen.
3. Editing `slang/vertex_vertex.slang` while locked recompiles the main shader.
4. Removing the `Image.vertex` entry from `slang/vertex.sha.json` restores the default
   fullscreen triangle.

Open `glsl/vertex_glsl.glsl`.

Expected:

1. A colored, gridded panel appears inset and rotated with black around it.
2. The config panel includes a path-only `Vertex` tab.
3. Editing `glsl/vertex_glsl_vertex.glsl` while locked recompiles the main shader.
4. Removing the `vertex` entry from `glsl/vertex_glsl.sha.json` restores the default
   fullscreen quad.
