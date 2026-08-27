export interface MatrixType {
  readonly componentType: "float" | "double";
  readonly columns: number;
  readonly rows: number;
}

export interface VectorType {
  readonly componentType: string;
  readonly size: number;
}

export function matrixType(typeName: string): MatrixType | undefined {
  const match = /^(d?)mat([234])(?:x([234]))?$/.exec(typeName);
  if (!match) {
    return undefined;
  }
  return {
    componentType: match[1] === "d" ? "double" : "float",
    columns: Number(match[2]),
    rows: Number(match[3] ?? match[2]),
  };
}

export function matrixTypeName(componentType: MatrixType["componentType"], columns: number, rows: number): string {
  const prefix = componentType === "double" ? "dmat" : "mat";
  return columns === rows ? `${prefix}${columns}` : `${prefix}${columns}x${rows}`;
}

export function resolveSwizzleType(ownerType: string, selection: string): string | undefined {
  const vector = vectorType(ownerType);
  if (!vector || selection.length < 1 || selection.length > 4) {
    return undefined;
  }
  const componentSets = ["xyzw", "rgba", "stpq"];
  const componentSet = componentSets.find((set) => [...selection].every((component) => set.includes(component)));
  if (!componentSet || [...selection].some((component) => componentSet.indexOf(component) >= vector.size)) {
    return undefined;
  }
  return selection.length === 1
    ? vector.componentType
    : vectorTypeName(vector.componentType, selection.length);
}

export function vectorType(typeName: string): VectorType | undefined {
  const match = /^(b|i|u|d)?vec([234])$/.exec(typeName);
  if (!match) {
    return undefined;
  }
  const componentTypes: Readonly<Record<string, string>> = {
    "": "float",
    b: "bool",
    i: "int",
    u: "uint",
    d: "double",
  };
  return {
    componentType: componentTypes[match[1] ?? ""],
    size: Number(match[2]),
  };
}

/** Public alias of {@link vectorTypeName} for callers outside this package. */
export { vectorTypeName as glslVectorTypeName };

export function vectorTypeName(componentType: string, size: number): string | undefined {
  const prefixes: Readonly<Record<string, string>> = {
    bool: "b",
    int: "i",
    uint: "u",
    float: "",
    double: "d",
  };
  const prefix = prefixes[componentType];
  return prefix === undefined ? undefined : `${prefix}vec${size}`;
}

export function isBuiltinValueType(name: string): boolean {
  return /^(?:bool|int|uint|float|double|[biud]?vec[234]|d?mat[234](?:x[234])?)$/.test(name);
}
