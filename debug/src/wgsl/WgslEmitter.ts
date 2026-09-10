const SCALAR_COMPONENTS: Record<string, string> = {
  f32: "f32",
  f16: "f32",
  i32: "f32",
  u32: "f32",
};

const VECTOR_ALIASES: Record<string, { width: number; component: string }> = {
  vec2f: { width: 2, component: "f32" },
  vec3f: { width: 3, component: "f32" },
  vec4f: { width: 4, component: "f32" },
  vec2h: { width: 2, component: "f16" },
  vec3h: { width: 3, component: "f16" },
  vec4h: { width: 4, component: "f16" },
  vec2i: { width: 2, component: "i32" },
  vec3i: { width: 3, component: "i32" },
  vec4i: { width: 4, component: "i32" },
  vec2u: { width: 2, component: "u32" },
  vec3u: { width: 3, component: "u32" },
  vec4u: { width: 4, component: "u32" },
};

const VECTOR_PARAMETERIZED = /^vec([234])<\s*(f32|f16|i32|u32)\s*>$/;

/**
 * Converts a captured WGSL value to the vec4f preview/capture color. Every
 * branch must be valid WGSL: there is no ternary operator, `f32()` rejects
 * booleans, and scalar conversion rejects vectors.
 */
export function emitWgslFloat4(typeName: string, expression: string): string {
  const trimmed = typeName.trim();
  if (trimmed === "bool") {
    return `select(vec4f(0.0, 0.0, 0.0, 1.0), vec4f(1.0, 1.0, 1.0, 1.0), ${expression})`;
  }
  if (SCALAR_COMPONENTS[trimmed] !== undefined) {
    return `vec4f(f32(${expression}), f32(${expression}), f32(${expression}), 1.0)`;
  }
  const shape = VECTOR_ALIASES[trimmed] ?? parseParameterizedVector(trimmed);
  if (!shape) {
    throw new Error(`Unsupported WGSL debug capture type '${typeName}'.`);
  }
  if (shape.width === 4 && shape.component === "f32") {
    return expression;
  }
  const value = shape.component === "f32" ? expression : `vec${shape.width}f(${expression})`;
  if (shape.width === 2) {
    return `vec4f(${value}, 0.0, 1.0)`;
  }
  if (shape.width === 3) {
    return `vec4f(${value}, 1.0)`;
  }
  return `vec4f(${value}.xyz, 1.0)`;
}

export function emitWgslStatic(typeName: string, name: string): string {
  assertSupportedCaptureType(typeName);
  return `var<private> ${name}: ${typeName.trim()};`;
}

function parseParameterizedVector(typeName: string): { width: number; component: string } | undefined {
  const match = VECTOR_PARAMETERIZED.exec(typeName);
  if (!match) {
    return undefined;
  }
  return { width: Number(match[1]), component: match[2]! };
}

function assertSupportedCaptureType(typeName: string): void {
  const trimmed = typeName.trim();
  if (trimmed === "bool" || SCALAR_COMPONENTS[trimmed] !== undefined
    || VECTOR_ALIASES[trimmed] !== undefined || parseParameterizedVector(trimmed) !== undefined) {
    return;
  }
  throw new Error(`Unsupported WGSL debug capture type '${typeName}'.`);
}
