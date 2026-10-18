# GPU Storage

Storage buffers keep data, such as particle positions or simulation values, between passes and frames. They are available to Slang and WGSL shaders on devices with WebGPU support. A compute pass can update a buffer, then a vertex or fragment pass can read those values to draw the result. Your shader accesses the buffer by its configured name.

## Workspace layout

Open the config panel and select a card labeled **Storage buffer**, such as **particles**. Each storage buffer has its own card alongside the shader passes; selecting it opens its **Settings** and **Inspect** tabs directly. Use **+ New → Storage buffer** to create a declaration. This is also available when the shader has no storage yet.

In **Settings**, edit the name, element count, layout and initialization. Changes stay in the current editor until you click **Apply changes**, either above or below the settings. Both buttons use the same validation and save action. The header button appears only while changes are pending. **Cancel** restores the saved settings. Apply or cancel before selecting another card or switching tabs; leaving the editor discards its pending changes. Renaming a buffer updates its card; deleting it removes the card.

## Element layout

Choose a scalar or vector type, a struct defined in shader source, or define numeric struct fields in the config. Config-defined fields generate the corresponding Slang or WGSL struct automatically. The settings show the element stride, allocation size and generated declaration.

Use distinct field names and match your binary data to the displayed layout. GPU alignment matters: an array of `vec3<f32>` has a 16-byte stride even though each vector holds 12 bytes of values. Struct fields can also contain padding. Fields are not tightly packed automatically.

Buffers are available to every pass. Shader code determines which ones it accesses. The pass list describes this access model; it does not connect or disconnect buffers. Compute passes can read and write; vertex and fragment passes have read-only access.

## Initial data and reset

**Start with** chooses zeros or a binary file. Select **Binary file**, click **Select** to pick the file, then apply the changes. The config stores only the file's path, resolved like texture paths: relative to the shader, `@/` for workspace-relative, or absolute. The bytes are read from that file each time the shader compiles, so keep the file alongside the shader. There is no fixed size limit; the file just cannot exceed the buffer's allocated size. Bytes not supplied by the file start at zero. If the file is missing or too large, the shader shows a compile error instead of running with zeroed storage.

Initial data is not converted: the file's raw bytes are copied as-is. Supply bytes matching the shader's numeric representation (little-endian on every WebGPU device), field offsets and array stride. For example, two `float4` elements need eight 32-bit floats (32 bytes).

Configs written by earlier versions that embedded base64 `initialData` are rejected with an error. Write those bytes to a `.bin` file and select it, or switch **Start with** back to zeros.

**Between frames** defaults to keeping previous values. **Clear every frame** zeros the buffer before each normal simulation frame; it does not reload the binary initial data each frame. Paused redraws do not perform that clear.

**Reset when the shader restarts** is enabled by default. Turning it off preserves an existing compatible buffer during a restart. Opening a different shader or changing the buffer's layout, size, initial data file or that file's contents can allocate fresh storage. Compatible declarations preserve their contents across ordinary recompiles.

**Reset data now** restores the selected buffer to its initial bytes, with the rest zeroed. Apply or cancel pending edits first. This resets the buffer data; it does not rerun compute passes.

**Remove buffer** deletes the declaration. Remove any compute dispatch targets referring to it first, and update shader code that still uses its name.

## Inspecting values

**Inspect** shows the buffer's current values without changing them. Scalars appear as an index/value list; vectors show each component in a separate column. For structs, select one numeric field at a time. The selected field is remembered for each buffer and shader.

Use **Capture snapshot** for a single read, or **Start live** for updates up to twice per second. Inspect pages of up to 16 elements using the first-element control and navigation buttons. Integer values can be shown in decimal or hexadecimal. Snapshot details include the frame and capture point when available.

The **Capture point** choices refer to GPU execution, not file edits:

| Choice | What it reads |
|--------|---------------|
| **Latest values** | The selected buffer's contents when the read is requested; this also works while paused. |
| **Before a pass** | Contents just before that pass next executes. |
| **After a pass** | Contents just after that pass next executes. |

Passes marked **Run once**, such as an initialization pass named `Seed`, are excluded from before/after choices: their next execution may already have happened. Read their resulting data with **Latest values**. For other pass capture points, resume the shader so the selected pass can run. A pass that does not execute produces a capture-point error rather than invented values.

Numeric scalar and vector fields from config-defined and source-defined structs can be inspected. Matrices, nested structs and array fields remain valid shader types but are not displayed as numeric fields. The inspector reports unsupported layouts explicitly. Field comparison and editing GPU values are not part of this layout.

See [Compute Passes](compute.md) for shader examples and [Config File Format](../help/config-file.md#storage-declarations) for the JSON fields.

## WGSL Storage Types

Use native WGSL types in the storage configuration, such as `f32`, `vec3f`, `atomic<u32>`, or a struct declared in your shader or Common code. Buffer sizes are calculated automatically, including padding, nested arrays and structs, and `@align` / `@size` attributes. Half-precision types require `enable f16;` and GPU support for `shader-f16`. For buffers of `f16` scalars, use an even element count if your shader relies on `arrayLength`; an odd count includes an extra padding element.
