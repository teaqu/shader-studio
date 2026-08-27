export interface SlangVectorType {
  readonly componentType: string;
  readonly size: number;
}

export interface SlangMatrixType {
  readonly componentType: string;
  readonly rows: number;
  readonly columns: number;
}

const SCALAR_COMPONENT_TYPES = ["float", "half", "double", "int", "uint", "bool"] as const;
const SWIZZLE_SETS = ["xyzw", "rgba", "stpq"] as const;

/** Every component-selector alphabet Slang accepts, for callers that need the raw list. */
export const SLANG_SWIZZLE_SETS: readonly string[] = SWIZZLE_SETS;

/**
 * Rewrites Slang's generic vector spelling to the short form the rest of this module
 * understands, so `vector<half, 3>` and `half3` resolve to the same type.
 */
export function canonicalizeSlangType(typeName: string): string {
  const generic = /^vector\s*<\s*([A-Za-z_]\w*)\s*,\s*([234])\s*>$/.exec(typeName.trim());
  return generic ? `${generic[1]}${generic[2]}` : typeName.trim();
}

export function slangVectorType(typeName: string): SlangVectorType | undefined {
  const match = new RegExp(`^(${SCALAR_COMPONENT_TYPES.join("|")})([234])$`).exec(typeName);
  return match ? { componentType: match[1] ?? "", size: Number(match[2]) } : undefined;
}

export function slangVectorTypeName(componentType: string, size: number): string {
  return `${componentType}${size}`;
}

export function slangMatrixType(typeName: string): SlangMatrixType | undefined {
  const match = new RegExp(`^(${SCALAR_COMPONENT_TYPES.join("|")})([234])x([234])$`).exec(typeName);
  return match ? { componentType: match[1] ?? "", rows: Number(match[2]), columns: Number(match[3]) } : undefined;
}

export function resolveSlangSwizzleType(ownerType: string, selection: string): string | undefined {
  const vector = slangVectorType(ownerType);
  if (!vector || selection.length < 1 || selection.length > 4) {
    return undefined;
  }
  const componentSet = SWIZZLE_SETS.find((set) => [...selection].every((component) => set.includes(component)));
  if (!componentSet || [...selection].some((component) => componentSet.indexOf(component) >= vector.size)) {
    return undefined;
  }
  return selection.length === 1 ? vector.componentType : slangVectorTypeName(vector.componentType, selection.length);
}

export function isSlangScalarType(typeName: string): boolean {
  return (SCALAR_COMPONENT_TYPES as readonly string[]).includes(typeName);
}
