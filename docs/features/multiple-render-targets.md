# Multiple render targets

A native WGSL or Slang buffer fragment can write several color textures in one draw. Each texture shares the buffer's resolution and floating-point output format. Image remains a single canvas output; GLSL MRT is not supported.

Declare contiguous color locations starting at zero:

```wgsl
struct Outputs {
  @location(0) color: vec4f,
  @location(1) normal: vec4f,
}
@fragment fn shade() -> Outputs {
  return Outputs(vec4f(1, 0, 0, 1), vec4f(0, 0, 1, 1));
}
```

Slang uses `float4` fields with `SV_Target0`, `SV_Target1`, and so on. Declaration order does not change attachment indices. A depth result (`frag_depth` or `SV_Depth`) is separate from color outputs.

Configure the buffer's outputs and select one in a downstream input:

```json
{
  "version": "1.0",
  "passes": {
    "BufferA": {
      "path": "scene.wgsl",
      "entryPoints": { "fragment": "shade" },
      "outputs": [{ "name": "Color" }, { "name": "Normal" }],
      "outputFormat": "rgba16float"
    },
    "Image": {
      "inputs": {
        "iChannel0": { "type": "buffer", "source": "BufferA", "output": 1 }
      }
    }
  }
}
```

Omitting `outputs` keeps one color texture. Omitting an input's `output` selects attachment zero. Compute outputs continue to use `layer`; render attachments use `output`.

Buffer settings show ordered output rows with optional names. Add outputs or remove the last row; indices of retained outputs stay unchanged. Create and Insert generate matching native fragment outputs, and Insert appends functions to the selected source.

The available count depends on the device's attachment count and bytes per sample. `rgba16float` uses 8 bytes per attachment and `rgba32float` uses 16. Five `rgba16float` outputs therefore require at least five attachments and 40 bytes per sample. Shader Studio requests supported limits and reports an error when a configuration exceeds them. All attachments swap together for feedback and share resize/reset behavior.

Native previews and capture retain the authored vertex stage, interpolated inputs, viewer camera, and depth. Variable capture renders to scratch attachments and snapshots storage buffers, so it leaves live output textures and storage unchanged. Select the output in the debug panel to preview or post-process its color. Other fragment output fields remain intact during instrumentation.

Runnable WGSL and Slang examples are in `tests/fixtures/shader-corpus/*/native-mrt/`.

Shadertoy imports keep their single-output `mainImage` behavior and existing connections select output zero. Native MRT projects cannot be pasted directly into Shadertoy. Porting them requires splitting outputs into separate passes or packing several values into one texture; splitting can duplicate calculations and lose the benefit of writing several outputs in one draw. Shader Studio does not convert MRT projects automatically.
