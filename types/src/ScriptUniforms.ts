/** Scalar arrays have a fixed length for the lifetime of a script load. */
export type ScriptScalarType = 'float' | 'int' | 'uint';
export type ScriptUniformType = ScriptScalarType | 'bool' | 'vec2' | 'vec3' | 'vec4' | `${ScriptScalarType}[${number}]`;
export interface ScriptUniformShape {
    base: ScriptScalarType | 'bool' | 'vec2' | 'vec3' | 'vec4';
    length?: number;
}
export interface TypedScriptUniform {
    readonly scriptUniformType: ScriptUniformType;
    readonly value: number | number[];
}
export const MAX_SCRIPT_ARRAY_LENGTH = 1024;
export function parseScriptUniformType(type: string): ScriptUniformShape | null {
  if (['float', 'int', 'uint', 'bool', 'vec2', 'vec3', 'vec4'].includes(type)) {
    return { base: type as ScriptUniformShape['base'] };
  }
  const match = /^(float|int|uint)\[([1-9]\d*)\]$/.exec(type);
  if (!match || Number(match[2]) > MAX_SCRIPT_ARRAY_LENGTH) {
    return null;
  }
  return { base: match[1] as ScriptScalarType, length: Number(match[2]) };
}
function validateScalar(type: ScriptScalarType, value: number): void {
  if (!Number.isFinite(value) || (type === 'float' && !Number.isFinite(Math.fround(value))) ||
        (type !== 'float' && (!Number.isInteger(value) || value < (type === 'uint' ? 0 : -2147483648) || value > (type === 'uint' ? 4294967295 : 2147483647)))) {
    throw new Error(`Invalid ${type} uniform value: ${value}`);
  }
}
function typed(type: ScriptScalarType, value: number | readonly number[]): TypedScriptUniform {
  if (typeof value === 'number') {
    validateScalar(type, value);
    return { scriptUniformType: type, value };
  }
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_SCRIPT_ARRAY_LENGTH) {
    throw new Error('Uniform arrays must contain 1–1024 elements');
  }
  for (const item of value) {
    validateScalar(type, item);
  }
  return { scriptUniformType: `${type}[${value.length}]`, value: [...value] };
}
function array(type: ScriptScalarType, value: readonly number[]): TypedScriptUniform {
  if (!Array.isArray(value)) {
    throw new Error('Uniform array helpers expect an array');
  }
  return typed(type, value);
}
export const scriptUniformHelpers = {
  int: (value: number) => typed('int', value),
  uint: (value: number) => typed('uint', value),
  floatArray: (value: readonly number[]) => array('float', value),
  intArray: (value: readonly number[]) => array('int', value),
  uintArray: (value: readonly number[]) => array('uint', value),
};
export function readScriptUniform(value: unknown): {
    type: ScriptUniformType;
    value: number | number[] | boolean;
} | null {
  if (value && typeof value === 'object' && 'scriptUniformType' in value && 'value' in value) {
    const shape = typeof value.scriptUniformType === 'string' ? parseScriptUniformType(value.scriptUniformType) : null;
    if (!shape || !['float', 'int', 'uint'].includes(shape.base)) {
      throw new Error('Invalid typed uniform');
    }
    const raw = value.value;
    if (shape.length !== undefined) {
      if (!Array.isArray(raw) || raw.length !== shape.length) {
        throw new Error('Uniform array length changed');
      }
    } else if (typeof raw !== 'number') {
      throw new Error('Expected scalar uniform');
    }
    return { type: value.scriptUniformType as ScriptUniformType, value: typed(shape.base as ScriptScalarType, raw as number | number[]).value };
  }
  if (typeof value === 'number') {
    validateScalar('float', value);
    return { type: 'float', value };
  }
  if (typeof value === 'boolean') {
    return { type: 'bool', value };
  }
  if (Array.isArray(value) && value.length >= 2 && value.length <= 4) {
    for (const item of value) {
      validateScalar('float', item);
    }
    return { type: `vec${value.length}` as ScriptUniformType, value: [...value] };
  }
  return null;
}
export function scriptUniformDeclaration(name: string, type: string): string {
  const shape = parseScriptUniformType(type);
  if (!shape) {
    throw new Error(`Unsupported uniform type: ${type}`);
  }
  return `uniform ${shape.base} ${name}${shape.length ? `[${shape.length}]` : ''};`;
}
export function zeroScriptUniform(type: string): number | number[] | boolean {
  const shape = parseScriptUniformType(type);
  if (shape?.length) {
    return new Array<number>(shape.length).fill(0);
  }
  if (shape?.base.startsWith('vec')) {
    return new Array<number>(Number(shape.base.slice(3))).fill(0);
  }
  return shape?.base === 'bool' ? false : 0;
}
