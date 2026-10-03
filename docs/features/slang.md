# Slang Support

Slang shaders (`.slang`) run on WebGPU in the VS Code extension and standalone
browser. Fragment shaders define `mainImage`, vertex shaders use the
[vertex hook](vertex-shaders.md), and [compute passes](compute.md) declare
`[shader("compute")]` entry points. A WebGPU-capable host is required.

Slang supports multipass rendering, Common helpers, storage buffers, textures,
cubemaps, audio/video, keyboard input, module imports, model geometry, and
script uniforms. See
[Channels](channels.md) for channel metadata and sampling.

## Native entry points

Slang supports the same [shared-file workflow and entry-point configuration](wgsl-authoring.md#native-entry-points-and-shared-files) as WGSL. Declare stages with `[shader("vertex")]`, `[shader("fragment")]`, and `[shader("compute")]`, then choose them in the config panel. Native render outputs use `SV_Position` and `SV_Target0` (or `SV_TargetN` for [multiple render targets](multiple-render-targets.md)); compute uses `[numthreads(x, y, z)]`. Built-in uniforms, channel helpers, and configured storage remain available. Image and buffer passes can select different fragments from the same source. Vertex and fragment selection is independent, so native stages can be paired with `mainVertex` or `mainImage` adapters. Mesh camera matrices are available as `iModelMatrix`, `iViewProjectionMatrix`, and `iNormalMatrix`; multiply with `mul(matrix, vector)` to follow the viewer camera.

New compute configuration uses `entryPoints.compute`; the older `entryPoint` field still loads for compatibility. Choose **Insert** to append native stages to the current source or **Create** for a separate source file.

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

The editor reports errors and marks unused locals and parameters. Entry
parameters with an `SV_` semantic are not marked as unused.

## Debugging

Use [inline rendering](../debugging/inline-rendering.md) to preview a value and the
[Variable Inspector](../debugging/variable-inspector.md) to capture supported
locals, parameters, and return values. Common helpers and values read from storage
are supported. `float2x2` values capture as four components; larger matrices
cannot be captured as a whole. Select a column or scalar component instead.
Vertex-stage debugging is unavailable.

Compute inline previews and variable capture inspect one invocation at a time
without updating the pass's output texture.
Read-only storage access is supported, but workgroup memory, barriers, subgroup
operations, atomics on workgroup memory, and configured storage writes are not
supported during compute debugging. These restrictions apply to compute debugging,
not normal compute rendering. Fragment-stage subgroup previews remain available.

Compute debugging cannot reproduce threads working together in a workgroup. Avoid relying on it to inspect
side effects hidden in imported code or complex macros.

See [Language Support](language-support.md) to compare GLSL, Slang, and WGSL.

For WebGPU mesh geometry, **Use viewer camera** defaults on. Turn it off to use mesh or `mainVertex` positions directly in clip space, without the viewer rotation, view, or perspective transform. Native vertex stages that read `iModelMatrix`, `iViewProjectionMatrix`, and `iNormalMatrix` receive identity matrices when it is off; stages with their own projection continue to control their output. The per-pass setting saves as `useViewerCamera: false` on Image or Buffer. Fullscreen vertex stages already use clip space. GLSL behavior is unchanged.

Opening a different shader resets the 3D viewer camera’s orbit, pan, and zoom. Editing or recompiling the current shader preserves the view.

Change the global camera default in VS Code Settings (**Shader Studio › WebGPU: Use Viewer Camera**) or standalone’s top-level **Settings → Use viewer camera**. Image and buffer passes can override it with **Use viewer camera**; **Use default** clears that pass override. Pass choices are saved as `passes.<name>.useViewerCamera`. The global preference is stored as `shader-studio.webgpu.useViewerCamera` in VS Code user settings and in browser storage in standalone, and is never copied into `.sha.json` files. Existing shader-wide `webgpu.useViewerCamera` settings in JSON remain supported between the pass and global defaults. Defaults remain enabled for older projects.
