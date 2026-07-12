import type { ShaderDialect } from '../types';
import type { DebugDialectAdapter } from './types';
import { glslDebugDialect } from './glsl';
import { slangDebugDialect } from './slang';

export type { DebugDialectAdapter } from './types';
export { canonicalShaderType } from './typeUtils';

export function getDebugDialect(dialect: ShaderDialect = 'glsl'): DebugDialectAdapter {
  return dialect === 'slang' ? slangDebugDialect : glslDebugDialect;
}
