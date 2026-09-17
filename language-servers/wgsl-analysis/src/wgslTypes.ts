/**
 * WGSL type-system helpers for the shared analysis layer. WGSL spells vectors
 * and matrices two ways — the predeclared alias (`vec4f`, `mat3x3h`) and the
 * parameterized form (`vec4<f32>`, `mat3x3<f32>`) — and both resolve here.
 */

export interface WgslVectorType {
  readonly componentType: string;
  readonly size: number;
}

export interface WgslMatrixType {
  readonly componentType: "f32" | "f16";
  readonly columns: number;
  readonly rows: number;
}

export interface WgslArrayType {
  readonly elementType: string;
  readonly elementCount: number | undefined;
}

export interface WgslPointerType {
  readonly addressSpace: string;
  readonly elementType: string;
  readonly accessMode?: string;
}

const VECTOR_ALIAS = /^vec([234])([fhiu])$/;
const VECTOR_PARAMETERIZED = /^vec([234])<\s*([iu]32|f32|f16)\s*>$/;
const MATRIX_ALIAS = /^mat([234])x([234])([fh])$/;
const MATRIX_PARAMETERIZED = /^mat([234])x([234])<\s*(f32|f16)\s*>$/;
const ATOMIC = /^atomic<\s*([iu]32)\s*>$/;
const ARRAY = /^array<\s*(.+?)\s*(?:,\s*(\d+)\s*)?>$/;
const POINTER = /^ptr<\s*([A-Za-z_]\w*)\s*,\s*(.+?)\s*(?:,\s*([A-Za-z_]\w*)\s*)?>$/;

const VECTOR_COMPONENTS: Readonly<Record<string, string>> = {
  f: "f32",
  h: "f16",
  i: "i32",
  u: "u32",
};

const TEXTURE_BASES = new Set([
  "texture_1d",
  "texture_2d",
  "texture_2d_array",
  "texture_3d",
  "texture_cube",
  "texture_cube_array",
  "texture_multisampled_2d",
  "texture_storage_1d",
  "texture_storage_2d",
  "texture_storage_2d_array",
  "texture_storage_3d",
]);

/** Texture types spelled without a template list. */
const UNPARAMETERIZED_TEXTURES = new Set([
  "texture_depth_2d",
  "texture_depth_2d_array",
  "texture_depth_cube",
  "texture_depth_cube_array",
  "texture_depth_multisampled_2d",
  "texture_external",
]);

export function vectorType(typeName: string): WgslVectorType | undefined {
  const alias = VECTOR_ALIAS.exec(typeName);
  if (alias?.[1] && alias[2]) {
    return { componentType: VECTOR_COMPONENTS[alias[2]] ?? "", size: Number(alias[1]) };
  }
  const parameterized = VECTOR_PARAMETERIZED.exec(typeName);
  if (parameterized?.[1] && parameterized[2]) {
    return { componentType: parameterized[2], size: Number(parameterized[1]) };
  }
  return undefined;
}

/** Public alias of {@link vectorTypeName} for callers outside this package. */
export { vectorTypeName as wgslVectorTypeName };

export function vectorTypeName(componentType: string, size: number): string | undefined {
  const suffixes: Readonly<Record<string, string>> = {
    f32: "f",
    f16: "h",
    i32: "i",
    u32: "u",
  };
  const suffix = suffixes[componentType];
  return suffix === undefined || size < 2 || size > 4 ? undefined : `vec${size}${suffix}`;
}

export function matrixType(typeName: string): WgslMatrixType | undefined {
  const alias = MATRIX_ALIAS.exec(typeName);
  if (alias?.[1] && alias[2] && alias[3]) {
    return {
      componentType: alias[3] === "h" ? "f16" : "f32",
      columns: Number(alias[1]),
      rows: Number(alias[2]),
    };
  }
  const parameterized = MATRIX_PARAMETERIZED.exec(typeName);
  if (parameterized?.[1] && parameterized[2] && (parameterized[3] === "f32" || parameterized[3] === "f16")) {
    return {
      componentType: parameterized[3],
      columns: Number(parameterized[1]),
      rows: Number(parameterized[2]),
    };
  }
  return undefined;
}

export function resolveSwizzleType(ownerType: string, selection: string): string | undefined {
  const vector = vectorType(ownerType);
  if (!vector || selection.length < 1 || selection.length > 4) {
    return undefined;
  }
  const componentSets = ["xyzw", "rgba"];
  const componentSet = componentSets.find((set) => [...selection].every((component) => set.includes(component)));
  if (!componentSet || [...selection].some((component) => componentSet.indexOf(component) >= vector.size)) {
    return undefined;
  }
  return selection.length === 1
    ? vector.componentType
    : vectorTypeName(vector.componentType, selection.length);
}

export function isWgslTextureType(typeName: string): boolean {
  if (UNPARAMETERIZED_TEXTURES.has(typeName)) {
    return true;
  }
  const parameterized = /^([A-Za-z_][A-Za-z0-9_]*)<\s*(.+?)\s*>$/.exec(typeName);
  return parameterized?.[1] !== undefined && TEXTURE_BASES.has(parameterized[1]);
}

export function isWgslSamplerType(typeName: string): boolean {
  return typeName === "sampler" || typeName === "sampler_comparison";
}

/** Inner type of `atomic<T>`, or undefined when T is not a valid atomic operand. */
export function parseWgslAtomicType(typeName: string): string | undefined {
  return ATOMIC.exec(typeName)?.[1];
}

export function parseWgslArrayType(typeName: string): WgslArrayType | undefined {
  const match = ARRAY.exec(typeName);
  if (!match?.[1] || match[1].length === 0) {
    return undefined;
  }
  return {
    elementType: match[1],
    elementCount: match[2] === undefined ? undefined : Number(match[2]),
  };
}

export function parseWgslPointerType(typeName: string): WgslPointerType | undefined {
  const match = POINTER.exec(typeName);
  if (!match?.[1] || !match[2] || match[2].length === 0) {
    return undefined;
  }
  return match[3] === undefined
    ? { addressSpace: match[1], elementType: match[2] }
    : { addressSpace: match[1], elementType: match[2], accessMode: match[3] };
}

const SCALARS = new Set(["bool", "i32", "u32", "f32", "f16"]);

export function isBuiltinValueType(name: string): boolean {
  const trimmed = name.trim();
  return SCALARS.has(trimmed)
    || vectorType(trimmed) !== undefined
    || matrixType(trimmed) !== undefined
    || isWgslTextureType(trimmed)
    || isWgslSamplerType(trimmed)
    || parseWgslAtomicType(trimmed) !== undefined
    || parseWgslArrayType(trimmed) !== undefined
    || parseWgslPointerType(trimmed) !== undefined;
}
