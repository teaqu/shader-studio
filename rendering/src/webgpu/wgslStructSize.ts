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
  containsAtomic: boolean;
}

interface WgslField {
  type: string;
  size?: number;
  alignment?: number;
}

interface WgslTypeLayout {
  size: number;
  alignment: number;
  containsAtomic?: boolean;
}

const WGSL_TYPE_SIZES: Record<string, WgslTypeLayout> = {
  f16: { size: 2, alignment: 2 },
  f32: { size: 4, alignment: 4 },
  i32: { size: 4, alignment: 4 },
  u32: { size: 4, alignment: 4 },
  bool: { size: 4, alignment: 4 },
  atomic_i32: { size: 4, alignment: 4, containsAtomic: true },
  atomic_u32: { size: 4, alignment: 4, containsAtomic: true },
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
  mat2x2h: { size: 8, alignment: 4 },
  mat3x2h: { size: 12, alignment: 4 },
  mat4x2h: { size: 16, alignment: 4 },
  mat2x3h: { size: 16, alignment: 8 },
  mat3x3h: { size: 24, alignment: 8 },
  mat4x3h: { size: 32, alignment: 8 },
  mat2x4h: { size: 16, alignment: 8 },
  mat3x4h: { size: 24, alignment: 8 },
  mat4x4h: { size: 32, alignment: 8 },
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
function builtinTypeLayout(typeName: string): WgslTypeLayout | undefined {
  return WGSL_TYPE_SIZES[normalizeTypeName(typeName)];
}

/** Parse struct definitions across several WGSL sources for stride auto-fill. */
export function parseWgslStructs(sources: string[]): Map<string, WgslStructInfo> {
  return extractStructSizes(sources.join("\n"));
}

/** Extract struct definitions from WGSL source. Returns a map of struct name → info. */
export function extractStructSizes(wgsl: string): Map<string, WgslStructInfo> {
  const structs = new Map<string, WgslStructInfo>();
  // Reuse the wrapper's WGSL-aware masking so comments (including nested
  // block comments) cannot look like declarations or fields.
  const source = maskWgslNonCode(wgsl);
  const structPattern = /\bstruct\s+(\w+)\s*\{([^}]*)\}/g;

  for (const match of source.matchAll(structPattern)) {
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
    for (const match of source.matchAll(structPattern)) {
      const name = match[1]!;
      if (structs.has(name)) {
        continue;
      }
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
  const lines = splitTopLevel(body, ",;");

  let offset = 0;
  let maxAlignment = 1;
  let containsAtomic = false;
  let hasUnresolvedField = false;

  for (const line of lines) {
    const field = parseField(line);
    if (!field) {
      continue;
    }

    const layout = fieldLayout(field, knownStructs);
    if (!layout) {
      hasUnresolvedField = true;
      continue;
    }
    offset = alignUp(offset, layout.alignment);
    offset += layout.size;
    maxAlignment = Math.max(maxAlignment, layout.alignment);
    containsAtomic ||= layout.containsAtomic === true;
  }

  if (hasUnresolvedField) {
    return undefined; // will be retried after more structs are resolved
  }

  const size = alignUp(offset, maxAlignment);
  return { name: "", size, alignment: maxAlignment, containsAtomic };
}

function fieldLayout(field: WgslField, knownStructs: Map<string, WgslStructInfo>): WgslTypeLayout | undefined {
  const natural = builtinTypeLayout(field.type) ?? knownStructs.get(field.type) ?? arrayLayout(field.type, knownStructs);
  if (!natural) {
    return undefined;
  }
  return {
    alignment: Math.max(natural.alignment, field.alignment ?? 0),
    size: Math.max(natural.size, field.size ?? 0),
    containsAtomic: natural.containsAtomic,
  };
}

function arrayLayout(type: string, knownStructs: Map<string, WgslStructInfo>): WgslTypeLayout | undefined {
  if (!type.startsWith("array<") || !type.endsWith(">")) {
    return undefined;
  }
  const parts = splitTopLevel(type.slice(6, -1), ",");
  if (parts.length !== 2 || !/^\d+$/.test(parts[1]!)) {
    return undefined;
  }
  const element = builtinTypeLayout(parts[0]!) ?? knownStructs.get(parts[0]!) ?? arrayLayout(parts[0]!, knownStructs);
  if (!element) {
    return undefined;
  }
  return {
    alignment: element.alignment,
    size: alignUp(element.size, element.alignment) * Number(parts[1]),
    containsAtomic: element.containsAtomic,
  };
}

/** Splits fields without treating generic type commas or attribute arguments as separators. */
function splitTopLevel(source: string, separators: string): string[] {
  const fields: string[] = [];
  let start = 0;
  let angleDepth = 0;
  let parenDepth = 0;
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (char === "<") {
      angleDepth++;
    } else if (char === ">") {
      angleDepth--;
    } else if (char === "(") {
      parenDepth++;
    } else if (char === ")") {
      parenDepth--;
    } else if (angleDepth === 0 && parenDepth === 0 && separators.includes(char)) {
      const field = source.slice(start, index).trim();
      if (field) {
        fields.push(field);
      }
      start = index + 1;
    }
  }
  const finalField = source.slice(start).trim();
  if (finalField) {
    fields.push(finalField);
  }
  return fields;
}

function parseField(line: string): WgslField | null {
  const alignment = layoutAttribute(line, "align");
  const size = layoutAttribute(line, "size");
  // Skip attributes like @align, @size, @location, [[builtin(...)]]
  const cleanLine = line.replace(/@\w+(?:\([^)]*\))?/g, "").replace(/\[\[[^\]]+\]\]/g, "").trim();

  // Match: name : type
  const match = cleanLine.match(/^(\w+)\s*:\s*(.+)$/);
  if (!match) {
    return null;
  }

  const type = normalizeTypeName(match[2]!);

  return { type, size, alignment };
}

function normalizeTypeName(typeName: string): string {
  let type = typeName.replace(/\s+/g, "").trim();
  // vec4<f32> → vec4f
  type = type.replace(/^vec(\d)<f32>$/g, "vec$1f");
  type = type.replace(/^vec(\d)<f16>$/g, "vec$1h");
  type = type.replace(/^vec(\d)<i32>$/g, "vec$1i");
  type = type.replace(/^vec(\d)<u32>$/g, "vec$1u");
  type = type.replace(/^mat(\d)x(\d)<f32>$/g, "mat$1x$2f");
  type = type.replace(/^mat(\d)x(\d)<f16>$/g, "mat$1x$2h");
  return type.replace(/^atomic<(\w+)>$/g, "atomic_$1");
}

function layoutAttribute(line: string, name: "align" | "size"): number | undefined {
  const value = new RegExp(`@${name}\\(\\s*(\\d+)\\s*\\)`).exec(line)?.[1];
  return value === undefined ? undefined : Number(value);
}

function alignUp(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}
import { maskWgslNonCode } from "./WgslPrelude";
