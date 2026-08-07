/**
 * Calculate WGSL struct sizes by parsing the struct definitions from compiled
 * WGSL output. Used to infer and validate storage buffer strides so users
 * don't need to hand-calculate alignment and padding.
 *
 * WGSL alignment rules (from the spec):
 *   scalar (f32,i32,u32,bool)  size 4, align 4
 *   vec2<T>                    size 8, align 8
 *   vec3<T>                    size 12, align 16
 *   vec4<T>                    size 16, align 16
 *   mat2x2<f32>                size 16, align 8
 *   mat3x2<f32>                size 24, align 8
 *   mat4x2<f32>                size 32, align 8
 *   mat2x3<f32>                size 32, align 16
 *   mat3x3<f32>                size 48, align 16
 *   mat4x3<f32>                size 64, align 16
 *   mat2x4<f32>                size 32, align 16
 *   mat3x4<f32>                size 48, align 16
 *   mat4x4<f32>                size 64, align 16
 *   atomic<T>                  size 4, align 4
 *   array<T,N>                 size N*stride(T), align align(T)
 *   struct                     size rounded up to largest member alignment
 */

export interface WgslStructInfo {
  name: string;
  size: number;
  alignment: number;
}

interface WgslField {
  type: string;
  size: number;
  alignment: number;
}

const WGSL_TYPE_SIZES: Record<string, { size: number; alignment: number }> = {
  f32: { size: 4, alignment: 4 },
  i32: { size: 4, alignment: 4 },
  u32: { size: 4, alignment: 4 },
  bool: { size: 4, alignment: 4 },
  vec2f: { size: 8, alignment: 8 },
  vec3f: { size: 12, alignment: 16 },
  vec4f: { size: 16, alignment: 16 },
  vec2i: { size: 8, alignment: 8 },
  vec3i: { size: 12, alignment: 16 },
  vec4i: { size: 16, alignment: 16 },
  vec2u: { size: 8, alignment: 8 },
  vec3u: { size: 12, alignment: 16 },
  vec4u: { size: 16, alignment: 16 },
  vec2h: { size: 4, alignment: 4 },
  vec3h: { size: 6, alignment: 8 },
  vec4h: { size: 8, alignment: 8 },
  mat2x2f: { size: 16, alignment: 8 },
  mat3x2f: { size: 24, alignment: 8 },
  mat4x2f: { size: 32, alignment: 8 },
  mat2x3f: { size: 32, alignment: 16 },
  mat3x3f: { size: 48, alignment: 16 },
  mat4x3f: { size: 64, alignment: 16 },
  mat2x4f: { size: 32, alignment: 16 },
  mat3x4f: { size: 48, alignment: 16 },
  mat4x4f: { size: 64, alignment: 16 },
};

/** Known built-in type sizes. Returns undefined for unknown/custom types. */
function builtinTypeLayout(typeName: string): { size: number; alignment: number } | undefined {
  const stripped = typeName.replace(/\s+/g, "");
  return WGSL_TYPE_SIZES[stripped];
}

/** Extract struct definitions from WGSL source. Returns a map of struct name → info. */
export function extractStructSizes(wgsl: string): Map<string, WgslStructInfo> {
  const structs = new Map<string, WgslStructInfo>();
  const structPattern = /^struct\s+(\w+)\s*\{([^}]*)\}/gm;

  for (const match of wgsl.matchAll(structPattern)) {
    const name = match[1]!;
    const body = match[2]!;
    const size = structBodySize(body, structs);
    if (size !== undefined) {
      structs.set(name, size);
    }
  }

  // Iterate until all nested struct references are resolved
  let changed = true;
  while (changed) {
    changed = false;
    for (const match of wgsl.matchAll(structPattern)) {
      const name = match[1]!;
      if (structs.has(name)) continue;
      const body = match[2]!;
      const size = structBodySize(body, structs);
      if (size !== undefined) {
        structs.set(name, size);
        changed = true;
      }
    }
  }

  return structs;
}

function structBodySize(
  body: string,
  knownStructs: Map<string, WgslStructInfo>,
): WgslStructInfo | undefined {
  const lines = body
    .split(/[;,\n]/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  // Skip size/align annotations like @size(16) @align(4) — they're optional
  let offset = 0;
  let maxAlignment = 1;
  let hasUnresolvedField = false;

  for (const line of lines) {
    const field = parseField(line);
    if (!field) continue;

    const builtin = builtinTypeLayout(field.type);
    if (builtin) {
      offset = alignUp(offset, builtin.alignment);
      offset += builtin.size;
      maxAlignment = Math.max(maxAlignment, builtin.alignment);
    } else if (knownStructs.has(field.type)) {
      const info = knownStructs.get(field.type)!;
      offset = alignUp(offset, info.alignment);
      offset += info.size;
      maxAlignment = Math.max(maxAlignment, info.alignment);
    } else {
      // Unresolved type (could be an array of custom type, or a not-yet-seen struct)
      // Try to match array syntax: array<T,N> or type[N]
      const arrayMatch = field.type.match(/^(?:array<(\w+),\s*(\d+)>|(\w+)\[(\d+)\])$/);
      if (arrayMatch) {
        const elemType = arrayMatch[1] ?? arrayMatch[3]!;
        const count = parseInt(arrayMatch[2] ?? arrayMatch[4]!, 10);
        const elemBuiltin = builtinTypeLayout(elemType);
        if (elemBuiltin) {
          offset = alignUp(offset, elemBuiltin.alignment);
          offset += elemBuiltin.size * count;
          maxAlignment = Math.max(maxAlignment, elemBuiltin.alignment);
          continue;
        } else if (knownStructs.has(elemType)) {
          const info = knownStructs.get(elemType)!;
          offset = alignUp(offset, info.alignment);
          offset += info.size * count;
          maxAlignment = Math.max(maxAlignment, info.alignment);
          continue;
        }
      }
      hasUnresolvedField = true;
    }
  }

  if (hasUnresolvedField) {
    return undefined; // will be retried after more structs are resolved
  }

  const size = alignUp(offset, maxAlignment);
  return { name: "", size, alignment: maxAlignment };
}

function parseField(line: string): WgslField | null {
  // Skip attributes like @align, @size, @location, [[builtin(...)]]
  const cleanLine = line.replace(/@\w+(?:\([^)]*\))?/g, "").replace(/\[\[[^\]]+\]\]/g, "").trim();

  // Match: name : type
  const match = cleanLine.match(/^(\w+)\s*:\s*(.+)$/);
  if (!match) return null;

  const typeStr = match[2]!.replace(/\s+/g, "").trim();

  // Normalize WGSL type syntax
  let type = typeStr;
  // vec4<f32> → vec4f
  type = type.replace(/^vec(\d)<f32>$/g, "vec$1f");
  type = type.replace(/^vec(\d)<i32>$/g, "vec$1i");
  type = type.replace(/^vec(\d)<u32>$/g, "vec$1u");
  type = type.replace(/^mat(\d)x(\d)<f32>$/g, "mat$1x$2f");
  type = type.replace(/^atomic<(\w+)>$/g, "atomic_$1");

  return { type, size: 0, alignment: 0 };
}

function alignUp(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}
