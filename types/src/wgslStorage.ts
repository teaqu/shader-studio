const WGSL_STORAGE_ELEMENT_TYPES: Record<string, { render: string; compute: string }> = {
  float: { render: "f32", compute: "f32" },
  float2: { render: "vec2<f32>", compute: "vec2<f32>" },
  float3: { render: "vec3<f32>", compute: "vec3<f32>" },
  float4: { render: "vec4<f32>", compute: "vec4<f32>" },
  int: { render: "i32", compute: "i32" },
  int2: { render: "vec2<i32>", compute: "vec2<i32>" },
  int3: { render: "vec3<i32>", compute: "vec3<i32>" },
  int4: { render: "vec4<i32>", compute: "vec4<i32>" },
  uint: { render: "u32", compute: "u32" },
  uint2: { render: "vec2<u32>", compute: "vec2<u32>" },
  uint3: { render: "vec3<u32>", compute: "vec3<u32>" },
  uint4: { render: "vec4<u32>", compute: "vec4<u32>" },
  "Atomic<uint>": { render: "u32", compute: "atomic<u32>" },
  "Atomic<int>": { render: "i32", compute: "atomic<i32>" },
  float2x2: { render: "mat2x2<f32>", compute: "mat2x2<f32>" },
  float3x3: { render: "mat3x3<f32>", compute: "mat3x3<f32>" },
  float4x4: { render: "mat4x4<f32>", compute: "mat4x4<f32>" },
};

/** Resolve configured storage aliases consistently for rendering and debug analysis. */
export function wgslStorageElementType(elementType: string, passKind: "render" | "compute"): string {
  return WGSL_STORAGE_ELEMENT_TYPES[elementType]?.[passKind] ?? elementType;
}

/**
 * Storage element types a WGSL config may spell natively, rather than through
 * the shared `float4`/`Atomic<uint>` aliases above. Includes the table's
 * outputs plus WGSL's numeric scalars, vectors, matrices, and native aliases.
 * `wgslStorageElementType` passes these through unchanged, so the renderer has
 * always accepted them; authoring validation must agree.
 */
export const WGSL_NATIVE_STORAGE_ELEMENT_TYPES: ReadonlySet<string> = new Set([
  ...Object.values(WGSL_STORAGE_ELEMENT_TYPES).flatMap(({ render, compute }) => [render, compute]),
  "f16",
  ...[2, 3, 4].flatMap((size) => ["f16", "f32", "i32", "u32"].map((scalar) => `vec${size}<${scalar}>`)),
  ...[2, 3, 4].flatMap((size) => ["h", "f", "i", "u"].map((suffix) => `vec${size}${suffix}`)),
  ...[2, 3, 4].flatMap((columns) => [2, 3, 4].flatMap((rows) => [
    `mat${columns}x${rows}<f16>`,
    `mat${columns}x${rows}<f32>`,
    `mat${columns}x${rows}h`,
    `mat${columns}x${rows}f`,
  ])),
]);
