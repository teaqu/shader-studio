import { SHADER_STUDIO_BUILTIN_UNIFORMS } from './shader-environment/BuiltinUniforms';
import { isShaderLanguageReservedTerm } from './shader-environment/ShaderLanguageReservedTerms';

export interface WgslTraceUniform {
  name: string;
  type: 'float' | 'vec2' | 'vec3' | 'vec4' | 'bool';
  value: number | number[] | boolean;
}

export const WGSL_TRACE_UNIFORM_TYPES: Record<WgslTraceUniform['type'], string> = {
  float: 'f32', vec2: 'vec2f', vec3: 'vec3f', vec4: 'vec4f', bool: 'bool',
};

/** Explicit launch values; never runs scripts or reads preview uniform state. */
export function validateWgslTraceUniforms(uniforms: WgslTraceUniform[] | undefined): void {
  if (uniforms === undefined) {
    return;
  }
  if (!Array.isArray(uniforms) || uniforms.length > 32) {
    throw new Error('Trace customUniforms must be an array of at most 32 explicit values.');
  }
  const names = new Set<string>();
  for (const uniform of uniforms) {
    if (!uniform || typeof uniform.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(uniform.name)
      || uniform.name === '_' || uniform.name.startsWith('__')
      || uniform.name.startsWith('_ss_') || isShaderLanguageReservedTerm('wgsl', uniform.name)
      || SHADER_STUDIO_BUILTIN_UNIFORMS.some(builtin => builtin.name === uniform.name)
      || names.has(uniform.name)) {
      throw new Error('Trace custom uniforms require unique WGSL names without reserved or built-in identifiers.');
    }
    names.add(uniform.name);
    const widths = { float: 1, vec2: 2, vec3: 3, vec4: 4, bool: 1 };
    if (!Object.prototype.hasOwnProperty.call(widths, uniform.type)) {
      throw new Error(`Unsupported trace custom uniform type: ${uniform.type}.`);
    }
    if (uniform.type === 'bool') {
      if (typeof uniform.value !== 'boolean') {
        throw new Error(`Trace uniform ${uniform.name} requires a boolean value.`);
      }
      continue;
    }
    const values = uniform.type === 'float' ? [uniform.value] : uniform.value;
    if (!Array.isArray(values) || values.length !== widths[uniform.type]
      || values.some(value => typeof value !== 'number' || !Number.isFinite(Math.fround(value)))) {
      throw new Error(`Trace uniform ${uniform.name} requires ${widths[uniform.type]} finite f32 components.`);
    }
  }
}
