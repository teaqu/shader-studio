/** Returns the WebGPU storage-array stride for a built-in Slang element type. */
export function getBuiltinStorageStride(elementType: string): number | null {
  const type = elementType.trim();
  const strides: Record<string, number> = {
    float: 4, int: 4, uint: 4, 'Atomic<int>': 4, 'Atomic<uint>': 4,
    float2: 8, int2: 8, uint2: 8,
    float3: 16, float4: 16, int3: 16, int4: 16, uint3: 16, uint4: 16,
    float2x2: 16, float3x3: 48, float4x4: 64,
  };
  return strides[type] ?? null;
}
