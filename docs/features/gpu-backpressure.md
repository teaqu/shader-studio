# GPU backpressure

Use GPU backpressure to limit how far rendering gets ahead of the picture
you see. A frame in flight is a submitted frame that the GPU has not finished.

Shader Studio bounds unfinished GPU frames during interactive playback for both
GLSL/WebGL and WebGPU shaders. The limit applies to a complete frame,
including all buffer and compute passes. When the queue is full, the viewer
skips submitting another frame until earlier work completes. Waiting never
blocks the JavaScript thread.

In VS Code, open **Settings**, search for **Shader Studio GPU Backpressure**,
and set the global defaults:

- `shader-studio.gpuBackpressure.framesInFlight`: **2** by default.
- `shader-studio.gpuBackpressure.stallTimeoutMs`: **2000 ms** by default.

Open your shader, then use **Config → Rendering** to override either setting
for that shader. Clear its **Use global default** checkbox to edit a value.
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

If the queue stays full for the stall timeout, the viewer allows another frame.
This retains the renderer's escape hatch for a completion signal that never
arrives. A timeout does not cancel GPU work already submitted.

Screenshots, offline exports, and explicit frame renders still produce the
requested image immediately; these controls pace interactive playback.
Resizing the preview can also redraw its current image immediately.
