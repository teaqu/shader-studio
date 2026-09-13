# Slang Support

Slang shaders (`.slang`) run on WebGPU in the VS Code extension and standalone
browser. Fragment shaders define `mainImage`, vertex shaders use the
[vertex hook](vertex-shaders.md), and [compute passes](compute.md) declare
`[shader("compute")]` entry points. A WebGPU-capable host is required.

Slang supports multipass rendering, Common helpers, module imports, storage
buffers, textures, cubemaps, audio/video, keyboard input, model geometry, and
script uniforms. See [Channels](channels.md) for channel metadata and sampling.

## Channels

Every configured channel is a direct Slang global. For example, use
`albedo.Sample(uv)`, `albedo.SampleLevel(uv, 0.0)`, and `albedo.size` for a
channel named `albedo`. `inputs.albedo` was removed; migrate old shaders by
removing `inputs.` from channel access. The `.sha.json` `inputs` field still
defines the channel bindings. Shared `sample2D` and `sampleCube` functions and
direct channel methods remain available. See [Channels](channels.md) for
sampling rules and reserved-name diagnostics.

## Editing

Completion, hover, signature help, definitions, references, highlights, and symbol
rename are available. Hover shows types for locals, parameters, struct fields,
vector components, channel methods, and storage buffers. Signature help follows
nested and generic calls. See [Language Servers](language-servers.md) for rename
instructions and limitations.

Diagnostics come from the Slang compiler and language service, including unused
locals and parameters. Entry parameters with an `SV_` semantic are exempt from
unused-parameter warnings. Generated prelude symbols reached through `__include`
are not available for hover or rename.

## Debugging

Use [inline rendering](../debugging/inline-rendering.md) to preview a value and the
[Variable Inspector](../debugging/variable-inspector.md) to capture supported
locals, parameters, and return values. Common helpers and values read from storage
are supported. `float2x2` values capture as four components; larger matrices
cannot be captured as a whole. Select a column or scalar component instead.
Vertex-stage debugging is unavailable.

Compute inline previews and variable capture both replay an invocation as a
fragment; neither dispatches a compute workgroup. Output writes are suppressed.
Read-only storage access is supported, but workgroup memory, barriers, subgroup
operations, atomics on workgroup memory, and configured storage writes report
`slang-debug-unsupported-syntax`. These restrictions apply to compute debugging,
not normal compute rendering. Fragment-stage subgroup previews remain available.

Replay cannot reproduce cooperative workgroups. Avoid relying on it to inspect
side effects hidden in imported code or complex macros.

See [Language Support](language-support.md) to compare GLSL, Slang, and WGSL.
