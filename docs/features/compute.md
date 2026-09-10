# Compute Passes

Compute passes run Slang or WGSL compute shaders before the fragment passes in each frame. They can update persistent storage buffers, write textures for later passes to sample, and repeat work several times per frame. Compute is available for `.slang` and `.wgsl` shaders.

Every compute pass uses a separate file. A relative `path` resolves from the main shader's directory, and an `@/` path resolves from the workspace root.

## Writing a Compute Shader

Declare the workgroup size with `[numthreads]` and use `SV_DispatchThreadID` to identify the current thread:

```slang
[shader("compute")]
[numthreads(64, 1, 1)]
void simulateParticles(uint3 id : SV_DispatchThreadID)
{
    if (id.x >= 4096) return;
    particles[id.x].position += particles[id.x].velocity * iTimeDelta;
}
```

If a source file has more than one `[shader("compute")]` entry point, set `entryPoint` in the pass config to select one.

The usual Slang built-ins and channel objects are available in compute passes. Use an explicit mip level when sampling a channel, for example `inputs.iChannel0.SampleLevel(uv, 0.0)`. Script-driven custom uniforms are also available.

WGSL compute shaders use `@compute` entry points with `@workgroup_size`, and the thread id comes from the `global_invocation_id` built-in:

```wgsl
@compute @workgroup_size(64)
fn simulate(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= 4096u) { return; }
    particles[id.x].position += particles[id.x].velocity * iTimeDelta;
}
```

If a WGSL file declares more than one `@compute` entry point, set `entryPoint` in the pass config to select one. Channel sampling needs an explicit mip level here too: `iChannel0SampleLevel(uv, 0.0)`.

## Storage Buffers

Storage buffers hold persistent data across frames. Declare them in the **Storage** tab of the visual config:

| Field | Meaning |
|-------|---------|
| `count` | Number of elements |
| `elementType` | A Slang type such as `float4`, `uint`, `Atomic<uint>`, or a struct from `common` — or the WGSL equivalent such as `vec4<f32>`, `u32`, `atomic<u32>` |

WGSL configs may use WGSL spellings for the same types; Slang spellings still resolve for configs written before WGSL support:

| Slang | WGSL |
|-------|------|
| `float` / `float2` / `float3` / `float4` | `f32` / `vec2<f32>` / `vec3<f32>` / `vec4<f32>` (`vec2f` / `vec3f` / `vec4f` also work) |
| `int` / `int2` / `int3` / `int4` | `i32` / `vec2<i32>` / `vec3<i32>` / `vec4<i32>` (`vec2i` / `vec3i` / `vec4i` also work) |
| `uint` / `uint2` / `uint3` / `uint4` | `u32` / `vec2<u32>` / `vec3<u32>` / `vec4<u32>` (`vec2u` / `vec3u` / `vec4u` also work) |
| `Atomic<uint>` / `Atomic<int>` | `atomic<u32>` / `atomic<i32>` |
| `float2x2` / `float3x3` / `float4x4` | `mat2x2<f32>` / `mat3x3<f32>` / `mat4x4<f32>` (`mat2x2f` / `mat3x3f` / `mat4x4f` also work) |

Storage survives across frames and recompiles when its declaration is unchanged. **Reset** recreates every buffer with zeroed contents.

Compute passes see `RWStructuredBuffer<T>`; vertex and fragment stages see read-only `StructuredBuffer<T>`. Access buffers by name — the engine declares and binds them automatically:

```slang
positions[id.x] = float4(0.0, 1.0, 0.0, 1.0);
```

```wgsl
positions[id.x] = vec4f(0.0, 1.0, 0.0, 1.0);
```

## Dispatch Modes

| Mode | Coverage |
|------|----------|
| Output texels | One thread per output texel |
| Element count | A fixed number of elements |
| Raw workgroups | Explicit X × Y × Z workgroup counts |
| Cover storage buffer | Matches the named storage buffer's element count |
| Cover channel | Matches the channel's current texture dimensions |

## Repeated and One-Shot Dispatch

**Repeats** runs the same pass multiple times per frame. `iDispatch` gives the zero-based repetition index, useful for solver substeps.

**Run once** runs a pass only on the first frame after compile, recompile, or **Reset**.

## Writing a Texture Output

When a buffer input references a compute pass as its `source`, an output texture is allocated and a `writeOutput` helper is available in the compute shader:

```slang
[shader("compute")]
[numthreads(8, 8, 1)]
void writeTexture(uint3 id : SV_DispatchThreadID)
{
    uint2 size = uint2(iResolution.xy);
    if (id.x >= size.x || id.y >= size.y) return;
    writeOutput(id.xy, float4(1.0, 0.2, 0.1, 1.0));
}
```

Use the **Output layers** control in the compute pass settings for layered output, and pick the layer when configuring the buffer channel that consumes it.

## Frame Order

1. Compute passes, in declaration order.
2. Fragment buffer passes, in declaration order.
3. `Image`.

Storage writes are visible to every later pass in the frame. Use two named buffers when you need separate read and write lanes.

!!! warning
    GLSL cannot run compute passes or bind storage buffers. They are silently skipped when a `.glsl` shader is loaded. Switch to a `.slang` or `.wgsl` shader to use compute features.

## Limitations

- Compute shaders require Slang or WGSL; there is no GLSL fallback.
- Compute variable capture/debugging and indirect dispatch are not implemented.
- Every storage buffer is bound to every pass.
- Custom-typed buffers cannot be accessed from `common`; define the struct there and access from pass files.

## Next

[Channels](channels.md) — sample media and outputs from arbitrary fragment or compute passes
