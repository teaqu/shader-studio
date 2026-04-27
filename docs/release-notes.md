# Release Notes


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
