# Release Notes

## v0.5.0

### Slang and WebGPU

- **Slang shader language** — Native support for `.slang` files with syntax highlighting, code snippets, and IntelliSense. Slang is a GPU shading language that targets WebGPU via WGSL codegen.
- **WebGPU rendering engine** — A new WebGPU backend alongside the existing WebGL pipeline. The engine is selected automatically based on file extension (`.slang` → WebGPU, `.glsl` → WebGL).
- **Compute passes** — Write Slang compute shaders with `[shader("compute")]` and `[numthreads]` annotations. Compute passes run before fragment passes each frame with configurable dispatch modes (per-texel, element count, workgroup count, storage buffer cover, or channel dimensions).
- **Storage buffers** — Persistent typed GPU buffers (`RWStructuredBuffer<T>` in compute, read-only `StructuredBuffer<T>` in render passes). Supports scalars, vectors, matrices, `Atomic<uint>`/`Atomic<int>`, and custom structs. Includes a visual storage inspector for reading and editing buffer elements.
- **Compute output textures** — Compute passes can write `rgba16float` output textures sampled by later passes, with support for up to 8 layers.
- **Repeated and one-shot dispatch** — `dispatchCount` runs a compute pass multiple times per frame with `iDispatch` indexing; `dispatchOnce` runs initialization passes on the first frame after compile or reset.
- **Slang module system** — `import` declarations, `#include`/`__include` directives, and module dependency graphs resolved host-side for the WASM compiler.
- **Native Slang debugging** — Variable capture and pixel inspection work directly on compiled Slang shaders without transpilation.
- **Per-pass geometry** — Configure 2D (full-screen quad) or 3D (sphere, cube, plane, custom GLB mesh) geometry per pass. GLSL passes render with vertex/fragment shaders; Slang passes use vertex hooks with `mainVertex`.
- **VS Code language support** — Full TextMate grammar, bracket matching, auto-closing pairs, folding, indentation rules, and bundled snippets (2D SDF, 3D SDF, coordinates, math) for `.slang` files.


## v0.4.0

### Recording

- **Screenshots** — capture PNG or JPEG at any time or at a specific shader time, with configurable resolution (480p–4K or custom)
- **Video** — record MP4 (H.264) or WebM (VP8) with configurable duration, FPS (24/30/60 or custom), and resolution using the WebCodecs API
- **Animated GIF** — record GIF with configurable duration, FPS, color palette size (2–256), loop count, and quality level with gifski WASM encoding
- Live canvas preview and progress bar during recording

### New Input Types

- **Audio channels** — bind audio files (mp3, wav, ogg, etc.) to shader channels; provides a 512×2 FFT + waveform texture matching Shadertoy's audio format. Supports loop regions, volume control, and per-channel mute.
- **Cubemap channels** — bind T-cross layout cubemap images; bound as `samplerCube` with configurable filter, wrap, and flip options.

### Performance Monitor

- New frame times panel showing a scrollable, zoomable graph of frame timing history
- Reference lines at 16.6ms (60 fps), 33.3ms (30 fps), and detected screen refresh rate
- Controls: time window zoom, vertical zoom (Ctrl+scroll), pan/drag, pause, and downsample
- FPS and millisecond display modes, average line overlay, mouse hover tooltip

### Compile Modes

- **Hot** — compile on every keystroke (previous behavior)
- **Save** — compile only on file save
- **Manual** — compile on demand with `Ctrl+Enter` or the **Compile Now** button in the toolbar
- Mode selector available in **Menu → Compile Mode**; persisted across sessions

### Resolution Controls

- Scale presets (0.25x, 0.5x, 1x, 2x, 4x) replacing the previous HD/SD toggle
- Fixed-size resolution: enter pixel dimensions
- Save resolution to `.sha.json` config so it persists with the shader
- Force black background option
- Buffer passes support independent fixed-size resolutions in the config

### Script-Driven Uniforms

- Add a `script` field to `.sha.json` pointing to a TypeScript/JavaScript file
- Export named values from the script to create custom uniforms in the shader
- Types inferred automatically: `float`, `vec2`, `vec3`, `vec4`, `bool`
- Configurable polling rate with `scriptMaxPollingFps`

### Other Changes

- FPS menu with frame rate limit options (30, 60, unlimited) and frame times toggle
- **Menu → Audio Volume** global volume slider and mute for all audio inputs
- `lockEditorGroup` setting to keep the preview panel from being displaced by file opens
- GLSL syntax highlighting support for `.frag`, `.vert`, `.geom`, `.tesc`, `.tese`, `.comp` files

---

## v0.3.0

- Shader preview in panel/window/browser workflows
- Debug mode with line visualization tools
- Config generation and visual config editing flow
- Shader Explorer and Snippet Library actions
