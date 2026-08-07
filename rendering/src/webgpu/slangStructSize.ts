/**
 * Calculate Slang struct sizes from source code using WGSL layout rules.
 * This lets us auto-infer strides for custom types at graph-build time without
 * needing to compile first.
 *
 * WGSL alignment rules:
 *   scalar (f32,i32,u32,bool)  size 4, align 4
 *   float2 / int2 / uint2:     size 8, align 8
 *   float3 / int3 / uint3:     size 12, align 16
 *   float4 / int4 / uint4:     size 16, align 16
 *   float2x2: size 16, align 8    float2x3: size 32, align 16
 *   float3x3: size 48, align 16   float4x4: size 64, align 16
 *   array<T,N>: N * stride(T), aligned same as T
 *   struct: fields packed with alignment, total size rounded up to largest alignment
 */

const SLANG_TYPE_LAYOUT: Record<string, { size: number; alignment: number }> = {
  float: { size: 4, alignment: 4 },
  int: { size: 4, alignment: 4 },
  uint: { size: 4, alignment: 4 },
  bool: { size: 4, alignment: 4 },
  double: { size: 8, alignment: 8 },
  half: { size: 2, alignment: 2 },
  float2: { size: 8, alignment: 8 },
  float3: { size: 12, alignment: 16 },
  float4: { size: 16, alignment: 16 },
  int2: { size: 8, alignment: 8 },
  int3: { size: 12, alignment: 16 },
  int4: { size: 16, alignment: 16 },
  uint2: { size: 8, alignment: 8 },
  uint3: { size: 12, alignment: 16 },
  uint4: { size: 16, alignment: 16 },
  double2: { size: 16, alignment: 16 },
  double3: { size: 24, alignment: 16 },
  double4: { size: 32, alignment: 16 },
  float2x2: { size: 16, alignment: 8 },
  float2x3: { size: 32, alignment: 16 },
  float2x4: { size: 32, alignment: 16 },
  float3x2: { size: 24, alignment: 8 },
  float3x3: { size: 48, alignment: 16 },
  float3x4: { size: 48, alignment: 16 },
  float4x2: { size: 32, alignment: 8 },
  float4x3: { size: 64, alignment: 16 },
  float4x4: { size: 64, alignment: 16 },
};

/**
 * Parse Slang struct definitions from source code and return a map of
 * struct name → { size, alignment } using WGSL layout rules.
 */
export function parseSlangStructs(sources: string[]): Map<string, { size: number; alignment: number }> {
  const structs = new Map<string, { fields: Array<{ type: string; arrayCount?: number }> }>();

  for (const source of sources) {
    const withoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    for (const match of withoutComments.matchAll(/struct\s+(\w+)\s*\{([^}]*)\}/g)) {
      const name = match[1]!;
      const body = match[2]!;
      const fields: Array<{ type: string; arrayCount?: number }> = [];
      for (const line of body.split(";")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const fieldMatch = trimmed.match(/^\s*(\w+(?:\s*<\s*\w+\s*,\s*\d+\s*>)?(?:\s*\[(\d+)\])?)\s+(\w+)\s*$/);
        if (fieldMatch) {
          const type = fieldMatch[1]!.replace(/\s+/g, "");
          const arrayCount = fieldMatch[2] ? parseInt(fieldMatch[2]!, 10) : undefined;
          fields.push({ type, arrayCount });
        }
      }
      structs.set(name, { fields });
    }
  }

  // Resolve sizes with iterative fixpoint for cross-references
  const sizes = new Map<string, { size: number; alignment: number }>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, info] of structs) {
      if (sizes.has(name)) continue;
      const result = computeStructLayout(info.fields, sizes);
      if (result) {
        sizes.set(name, result);
        changed = true;
      }
    }
  }

  return sizes;
}

function computeStructLayout(
  fields: Array<{ type: string; arrayCount?: number }>,
  known: Map<string, { size: number; alignment: number }>,
): { size: number; alignment: number } | null {
  let offset = 0;
  let maxAlign = 1;

  for (const { type, arrayCount } of fields) {
    // Skip Atomic<T> — storage buffer atoms are always 4 bytes
    const atomicMatch = type.match(/^Atomic<(.*)>$/);
    const resolvedType = atomicMatch ? atomicMatch[1]! : type;
    const count = arrayCount ?? 1;

    // Check built-in types first, then custom structs
    let layout = SLANG_TYPE_LAYOUT[resolvedType];
    if (!layout && known.has(resolvedType)) {
      layout = known.get(resolvedType)!;
    }
    if (!layout) return null; // unresolved type

    offset = alignUp(offset, layout.alignment);
    offset += layout.size * count;
    maxAlign = Math.max(maxAlign, layout.alignment);
  }

  return { size: alignUp(offset, maxAlign), alignment: maxAlign };
}

function alignUp(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}
