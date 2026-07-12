import type { ShaderDialect } from '../types';

export type CanonicalShaderType =
  | 'void'
  | 'float'
  | 'int'
  | 'bool'
  | 'vec2'
  | 'vec3'
  | 'vec4'
  | 'mat2'
  | 'mat3'
  | 'mat4'
  | 'sampler2D'
  | string;

export interface DebugDialectAdapter {
  name: ShaderDialect;
  mainImagePattern: RegExp;
  needsCaptureCoordInjection: boolean;
  mainImageReturnsValue: boolean;
  vectorCtor(n: 2 | 3 | 4): string;
  mainImageWrapperOpen(): string;
  moduleCaptureDeclaration(type: string, name: string): string;
  captureSelectorDeclaration(): string | null;
  captureOutputStatement(varType: string, varName: string): string;
  visualOutputStatement(expr: string, comment: string, stepEdge: number | null): string;
  selectorFallbackStatement(): string;
  selectorReturnAfterOutput(): string | null;
  defaultParameterValue(canonicalType: CanonicalShaderType): string | null;
  defaultReturnStatement(canonicalType: CanonicalShaderType): string | null;
}
