# Compute Passes

Compute passes run Slang compute shaders on WebGPU before the fragment passes in each frame. They can update persistent typed storage buffers, write textures for later passes to sample, and repeat work several times per frame. Compute is available only for `.slang` shaders using the WebGPU engine.

The main shader and config must share a basename, such as `particles.slang` and `particles.sha.json`. Every compute pass uses a separate file. A relative `path` resolves from the main shader's directory, an absolute path is used as-is, and an `@/` path resolves from the workspace root.

## Complete Config Example

JSON does not allow comments; the annotations below use JSONC for explanation. Remove the comments in a `.sha.json` file.

```jsonc
{
  "version": "1.0",
  "storage": {
    // 4096 ParticleData values, 32 bytes per value.
    "particles": { "count": 4096, "stride": 32, "elementType": "ParticleData" },
    // Atomic built-in types are also supported.
    "counters": { "count": 4, "stride": 4, "elementType": "Atomic<uint>" }
  },
  "passes": {
    "ComputeInit": {
      "path": "init.slang",
      "dispatch": { "cover": "particles" },
      "dispatchOnce": true,
      "workgroupSize": [64, 1, 1]
    },
    "ComputeSim": {
      "path": "sim.slang",
      "dispatch": { "count": 4096 },
      "dispatchCount": 6,
      "workgroupSize": [64, 1, 1]
    },
    "ComputePresent": {
      "path": "present.slang",
      "resolution": { "scale": 0.5 },
      "outputLayers": 2
      // With no dispatch field, this runs once per output texel.
    },
    "Image": {
      "inputs": {
        "iChannel0": {
          "type": "buffer",
          "source": "ComputePresent",
          "layer": 1
        }
      }
    },
    "common": { "path": "common.slang" }
  }
}
```

Any pass whose name starts with `Compute` is a compute pass. The rest of the name is unrestricted, so names such as `ComputeSim`, `ComputeBlurHorizontal`, and `Compute_2` are valid.

## Writing a Compute Shader

A compute pass file defines one `computeMain` function. Shader Studio generates the WebGPU entrypoint and supplies the global thread ID:

```slang
void computeMain(uint3 id)
{
    if (id.x >= 4096)
    {
        return;
    }

    particles[id.x].position += particles[id.x].velocity * iTimeDelta;
}
```

The usual Slang built-ins are available: `iResolution`, `iMouse`, `iTime`, `iTimeDelta`, `iFrameRate`, and `iFrame`. Compute passes can also sample configured channels with generated helpers such as `sampleIChannel0(uv)`. Compute sampling uses explicit mip level 0.

Dispatch sizes are rounded up to complete workgroups. Always guard the logical domain before indexing a storage buffer or doing work for a texel:

```slang
void computeMain(uint3 id)
{
    uint2 size = uint2(iResolution.xy);
    if (id.x >= size.x || id.y >= size.y)
    {
        return;
    }

    // Safe to use id.xy here.
}
```

Raw `{ "x", "y", "z" }` dispatches specify workgroup counts directly, so the shader must define and guard its own logical domain.

## Storage Buffers

The top-level `storage` object declares persistent engine-managed buffers. Each entry needs:

| Field | Meaning |
|-------|---------|
| `count` | Number of elements. Must be a positive integer. |
| `stride` | Bytes per element. Must be a positive integer and match the element type's WGSL storage layout. |
| `elementType` | A Slang type such as `float4`, `uint`, `Atomic<uint>`, or a struct declared in `common`. |

Shader Studio allocates `count * stride` zero-initialized bytes. Storage survives between frames and across successful same-session recompiles when its declaration is unchanged. Choosing **Reset** explicitly recreates every storage buffer with zeroed contents. A main shader/path switch installs fresh storage for the new session, and an individual buffer is recreated when its declaration changes. Timeline scrubbing, loop wrap, negative playback, and ordinary time changes do not clear storage. The engine declares and binds every configured storage buffer in every pass. Compute passes see `RWStructuredBuffer<T>`; fragment passes see read-only `StructuredBuffer<T>`. Do not declare the buffers or choose binding numbers yourself:

```slang
// "positions": { "count": 1024, "stride": 16, "elementType": "float4" }
positions[id.x] = float4(0.0, 1.0, 0.0, 1.0);
```

Stride is not inferred or checked against Slang reflection yet. Scalars such as `uint` use 4 bytes and `float4` uses 16 bytes. For structs, account for field alignment and padding; a `float3` can introduce 16-byte alignment. Prefer layouts made from `float4`/`uint4`, calculate the final aligned size, and keep `stride` equal to it.

Atomics work as element types or struct fields. For example, an `Atomic<uint>` storage element can be incremented with:

```slang
uint previous = counters[0].add(1u);
```

### Declarations Around `common`

Storage declarations use two tiers because custom types must exist before a buffer can use them:

- Built-in element types are declared before `common`, so shared helpers may read these buffers. `common` is compiled into every Slang pass, however, and fragment passes receive read-only `StructuredBuffer<T>` declarations. Keep all storage access in `common` read-only so the same code type-checks for fragment and compute passes. Put storage writes in the compute pass source file.
- Custom element types are declared after `common`. Define the struct in `common`, then access that buffer from pass files. Code inside `common` cannot access a custom-typed buffer because its declaration comes later.

The built-in tier includes scalar/vector `float`, `int`, and `uint` types; `Atomic<uint>` and `Atomic<int>`; and `float2x2`, `float3x3`, and `float4x4`. Anything else is treated as a custom type.

```slang
// common.slang
struct ParticleData
{
    float4 position;
    float4 velocity;
};

// sim.slang — `particles` is declared after common and is available here.
void computeMain(uint3 id)
{
    ParticleData particle = particles[id.x];
    // ...
}
```

## Dispatch Modes

| Config | Logical coverage | Default workgroup size |
|--------|------------------|------------------------|
| Omit `dispatch` | The pass resolution, one logical thread per texel | `[8, 8, 1]` |
| `{ "count": N }` | `N` one-dimensional elements | `[64, 1, 1]` |
| `{ "x": X, "y": Y, "z": Z }` | Exactly `X × Y × Z` workgroups | `[8, 8, 1]` |
| `{ "cover": "bufferName" }` | The named storage buffer's `count` | `[8, 8, 1]` |
| `{ "cover": "iChannel0" }` | The configured channel's current texture dimensions | `[8, 8, 1]` |

`workgroupSize: [x, y, z]` overrides the default for every mode. Each dimension must be a positive integer and their product cannot exceed 256. Per-texel, count, and cover modes ceil-divide their logical size by the workgroup size. The raw xyz mode does not: its values already are workgroup counts.

Channel-cover dispatch is resolved from the texture at bind time, so it follows image loads and video size changes. Invalid static workgroup settings and static dispatch counts above the device's per-axis limit are compilation errors. A `cover: "iChannelN"` size is dynamic and cannot be checked during compilation; if its live texture would exceed an axis limit, Shader Studio safely skips that dispatch at runtime. That runtime skip is currently silent.

## Repeated and One-Shot Dispatch

`dispatchCount` encodes the same pass repeatedly in one frame. It defaults to 1 and supports 1 through 1024. `iDispatch` is the zero-based repetition index:

```slang
void computeMain(uint3 id)
{
    bool readA = (iDispatch % 2) == 0;
    float4 value = readA ? laneA[id.x] : laneB[id.x];
    if (readA)
    {
        laneB[id.x] = update(value);
    }
    else
    {
        laneA[id.x] = update(value);
    }
}
```

Repeated dispatches execute consecutively, and storage writes from one are visible to the next. This makes the two-lane pattern useful for solver substeps.

`dispatchOnce: true` runs a pass only on the first eligible frame after the initial compile, a successfully installed recompilation, or an explicit **Reset**. A successful recompilation rearms it even when unchanged storage is retained. Timeline scrubbing, loop wrap, negative playback, and ordinary time changes do not rearm it, so scrubbing does not replay a simulation from its initial state. A one-shot pass cannot also use `dispatchCount` greater than 1; that combination is a graph validation error. Keep initialization in a separate `ComputeInit` pass when another pass needs substeps.

## Writing a Texture Output

A compute output texture is allocated when any configured buffer input has a `source` that names that compute pass. This includes a self-reference: the output is allocated, and the pass samples its previous-frame texture while writing the current frame. When an output is allocated, Shader Studio generates `writeOutput`:

```slang
void computeMain(uint3 id)
{
    uint2 size = uint2(iResolution.xy);
    if (id.x >= size.x || id.y >= size.y)
    {
        return;
    }

    writeOutput(id.xy, float4(1.0, 0.2, 0.1, 1.0));
}
```

The output is a ping-pong `rgba16float` texture. `writeOutput` checks its coordinate bounds. If no pass samples the compute pass, no output is allocated and `writeOutput` is intentionally undefined; storage-only compute passes should not call it.

Set `outputLayers` from 1 through 8 for a texture array. Layered output changes the helper signature, and a consumer chooses one layer with `layer` (default 0):

```slang
writeOutput(id.xy, 0u, rawColor);
writeOutput(id.xy, 1u, filteredColor);
```

```json
"iChannel0": { "type": "buffer", "source": "ComputeFilter", "layer": 1 }
```

Coordinates passed to `writeOutput` use the same bottom-left convention as `fragCoord` and `sampleIChannelN`. The helper flips the physical WebGPU texture row internally, so compute and fragment outputs sample with the same orientation.

## Ordering and Visibility

Each frame is ordered as follows:

1. Compute passes, in config declaration order.
2. Fragment buffer passes, in config declaration order.
3. `Image`.

All passes are encoded into one WebGPU submission. Storage buffer writes are current-frame state and are visible to every later pass. Storage is not automatically double-buffered; use two named buffers when an algorithm needs separate read and write lanes.

Texture channels follow the existing pass-graph timing rule. A pass reads the current-frame texture from a source that ran earlier in the frame. A self-reference or a reference to a later source reads the previous frame through ping-pong textures. Compute sub-dispatches remain consecutive before the next pass begins.

Bindings are generated in a fixed order: ShaderToy uniforms at binding 0, channel texture/sampler pairs in slot order, storage buffers in config declaration order, the optional compute output, then the compute-only `iDispatch` uniform. This is an engine contract; shader files should never add explicit bindings for these resources.

## Limits and Portability

All storage buffers are auto-bound to every pass. More than 8 buffers produces a warning because 8 is the WebGPU baseline per shader stage. Shader Studio requests the adapter's larger limit when available, then reports a hard error only if the configured count exceeds the limit granted by the actual device. A single storage binding also cannot exceed the device's `maxStorageBufferBindingSize`, and total declared storage is capped at 256 MiB.

For portable shaders near the baseline, pack related data into one struct instead of separate buffers:

```slang
struct ParticleData
{
    float4 position;
    float4 velocity;
    float4 colorAndLifetime;
};
```

One `StructuredBuffer<ParticleData>` consumes one storage binding while keeping those fields together. Packing does not remove the need to calculate the struct stride correctly.

!!! warning
    GLSL/WebGL cannot run compute passes or bind storage buffers. If a GLSL project contains `Compute*` passes or `storage`, Shader Studio warns that they require the Slang/WebGPU engine and skips the compute passes instead of silently rendering black.

## Current Limitations

- Compute shaders require Slang and WebGPU; there is no GLSL fallback.
- Compute variable capture/debugging, storage readback/inspection, indirect dispatch, and in-source multi-entry attributes are not implemented.
- `count`, `stride`, and `elementType` are config-authored; stride is not reflection-validated.
- Every storage buffer is bound to every pass. There is no per-pass storage binding list.
- Custom-typed buffers cannot be accessed from `common`; only their type definitions belong there.
- Compute output is `rgba16float`, is created only when sampled, and supports at most 8 layers.
- Dedicated controls for storage and most compute fields are not yet available in the visual config form. Edit `.sha.json` with schema completion.

## Examples

- `examples/compute-particles` — a one-shot initializer, per-frame integration, and Image rendering from current-frame storage.
- `examples/compute-blur` — per-texel `writeOutput` with two output layers; Image samples the blurred layer.
- `examples/compute-substeps` — separate one-shot initialization plus six `iDispatch` two-lane solver steps per frame.

## Next

[Channels](channels.md) — sample media and outputs from arbitrary fragment or compute passes
