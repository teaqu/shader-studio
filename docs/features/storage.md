# GPU Storage

Storage buffers keep data on the GPU between passes and frames. They are available to Slang and WGSL shaders through WebGPU. A compute pass can update a buffer, then a vertex or fragment pass can read the same allocation without copying it between passes. Making a buffer available does not cause every shader to process its contents.

## Workspace layout

Open the config panel's **Storage** tab. The buffer list selects one buffer at a time; the main area has **Settings** and **Inspect** tabs. Use **+ Add buffer** in the header to create a declaration.

In **Settings**, edit the name, element count, layout and initialization. Changes stay in the current editor until you click **Apply changes**, either beside **+ Add buffer** or below the settings. Both buttons use the same validation and save action. The header button appears only while changes are pending. **Cancel** restores the saved settings. Apply or cancel before selecting another buffer or switching tabs; leaving the editor discards its pending changes.

## Element layout

Choose a scalar or vector type, a struct defined in shader source, or define numeric struct fields in the config. Config-defined fields generate the corresponding Slang or WGSL struct automatically. The settings show the element stride, allocation size and generated declaration.

Use distinct field names and match your binary data to the displayed layout. GPU alignment matters: an array of `vec3<f32>` has a 16-byte stride even though each vector holds 12 bytes of values. Struct fields can also contain padding. Fields are not tightly packed automatically.

Buffers are available to every pass. Shader code determines which ones it accesses. The pass list describes this access model; it does not connect or disconnect buffers. Compute passes can read and write; vertex and fragment passes have read-only access.

## Initial data and reset

**Start with** chooses zeros or a binary file. Select **Binary file**, choose the file, then apply the changes. The file's raw bytes are embedded as base64 in the shader config, so reopening the shader does not require the original file. Files are limited to 256 KiB and cannot exceed the buffer's allocated size. Bytes not supplied by the file start at zero.

The upload does not convert text, infer a format or rearrange fields. Supply raw bytes matching the shader's numeric representation, field offsets and array stride. For example, two `float4` elements need eight 32-bit floats (32 bytes).

**Between frames** defaults to keeping previous values. **Clear every frame** zeros the buffer before each normal simulation frame; it does not reload the binary initial data each frame. Paused redraws do not perform that clear.

**Reset when the shader restarts** is enabled by default. Turning it off preserves an existing compatible buffer during a restart. Opening a different shader or changing the buffer's layout, size or initial data can allocate fresh storage. Compatible declarations preserve their contents across ordinary recompiles.

**Reset data now** restores the selected buffer to its initial bytes, with the rest zeroed. Apply or cancel pending edits first. This resets the buffer data; it does not rerun compute passes.

**Remove buffer** deletes the declaration. Remove any compute dispatch targets referring to it first, and update shader code that still uses its name.

## Inspecting values

**Inspect** reads actual GPU data and is read-only. Scalars use a compact index/value list; vectors use a table with a narrow index column and separate component columns. For structs, select one numeric field at a time. The selected field is remembered for each buffer and shader.

Use **Capture snapshot** for a single read, or **Start live** for updates up to twice per second. Reads do not overlap. Inspect pages of up to 16 elements using the first-element control and navigation buttons. Integer values can be shown in decimal or hexadecimal. Snapshot context includes the frame and capture point when available.

The **Capture point** choices refer to GPU execution, not file edits:

| Choice | What it reads |
|--------|---------------|
| **Latest values** | The selected buffer's contents when the read is requested; this also works while paused. |
| **Before a pass** | Contents just before that pass next executes. |
| **After a pass** | Contents just after that pass next executes. |

Passes marked **Run once**, such as an initialization pass named `Seed`, are excluded from before/after choices: their next execution may already have happened. Read their resulting data with **Latest values**. For other pass capture points, resume the shader so the selected pass can run. A pass that does not execute produces a capture-point error rather than invented values.

Numeric scalar and vector fields from config-defined and source-defined structs can be inspected. Matrices, nested structs and array fields remain valid shader types but are not displayed as numeric fields. The inspector reports unsupported layouts explicitly. Field comparison and editing GPU values are not part of this layout.

See [Compute Passes](compute.md) for shader examples and [Config File Format](../help/config-file.md#storage-declarations) for the JSON fields.
