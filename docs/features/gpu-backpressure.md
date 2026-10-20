# GPU backpressure

Shader Studio bounds unfinished GPU frames during interactive playback for both
GLSL/WebGL and Slang/WebGPU shaders. The limit applies to a complete frame,
including all buffer and compute passes. When the queue is full, the viewer
skips submitting another frame until earlier work completes. Waiting never
blocks the JavaScript thread.

Set the global defaults in VS Code's Shader Studio settings:

- `shader-studio.gpuBackpressure.framesInFlight`: **2** by default.
- `shader-studio.gpuBackpressure.stallTimeoutMs`: **2000 ms** by default.

Use **Config → Rendering** to override either setting for an individual shader.
Each **Use global default** checkbox restores inheritance for that value.
Global setting changes apply to open viewers immediately. Editing shader
settings preserves existing feedback buffers and media playback.

The same settings are available at the top level of the shader's `.sha.json`:

```json
{
  "version": "1.0",
  "gpuBackpressure": {
    "framesInFlight": 1,
    "stallTimeoutMs": 3000
  },
  "passes": {
    "Image": {}
  }
}
```

Omit either property to inherit its global default. Values must be positive safe
integers. Fewer frames in flight reduce queued work; a larger limit may keep the
GPU busier. A longer timeout accommodates shaders whose frames take more time.

If no tracked frame completes for the stall timeout, playback pauses and the
viewer reports the stall. Completion polling continues; once the GPU recovers,
use Play to resume playback. A timeout does not cancel GPU work already submitted.
If completion tracking fails, reload the viewer to recreate the renderer.

Explicit capture and offline export renders retain their existing synchronous
behavior and bypass interactive admission. Preview-only redraws during resizing
also retain their existing behavior.
