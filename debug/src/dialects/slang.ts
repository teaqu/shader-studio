import type { DebugDialectAdapter } from './types';
import { canonicalShaderType } from './typeUtils';

function vec(n: 2 | 3 | 4): string {
  return `float${n}`;
}

export const slangDebugDialect: DebugDialectAdapter = {
  name: 'slang',
  mainImagePattern: /float4\s+mainImage\s*\(/,
  needsCaptureCoordInjection: false,
  mainImageReturnsValue: true,

  vectorCtor: vec,

  mainImageWrapperOpen(): string {
    return 'float4 mainImage(float2 fragCoord) {';
  },

  moduleCaptureDeclaration(type: string, name: string): string {
    return `static ${type} ${name};`;
  },

  captureSelectorDeclaration(): null {
    return null;
  },

  captureOutputStatement(varType: string, varName: string): string {
    const v4 = vec(4);
    let expr: string;
    switch (canonicalShaderType(varType)) {
      case 'float':
        expr = `${v4}(${varName}, 0.0, 0.0, 0.0)`;
        break;
      case 'vec2':
        expr = `${v4}(${varName}, 0.0, 0.0)`;
        break;
      case 'vec3':
        expr = `${v4}(${varName}, 0.0)`;
        break;
      case 'vec4':
        expr = varName;
        break;
      case 'int':
        expr = `${v4}(float(${varName}), 0.0, 0.0, 0.0)`;
        break;
      case 'bool':
        expr = `${v4}(${varName} ? 1.0 : 0.0, 0.0, 0.0, 0.0)`;
        break;
      case 'mat2':
        expr = `${v4}(${varName}[0], ${varName}[1])`;
        break;
      default:
        expr = `${v4}(0.0)`;
    }
    return `  return ${expr};`;
  },

  visualOutputStatement(expr: string, comment: string, stepEdge: number | null): string {
    if (stepEdge !== null) {
      const edge = stepEdge.toFixed(4);
      return [
        `  ${vec(4)} _dbgOut = ${expr}; // Debug: ${comment}`,
        `  _dbgOut = ${vec(4)}(step(${vec(3)}(${edge}), _dbgOut.rgb), 1.0); // Debug: step threshold`,
        '  return _dbgOut;',
      ].join('\n');
    }
    return `  return ${expr}; // Debug: ${comment}`;
  },

  selectorFallbackStatement(): string {
    return '  return float4(0.0);';
  },

  selectorReturnAfterOutput(): null {
    return null;
  },

  defaultParameterValue(canonicalType: string): string | null {
    switch (canonicalType) {
      case 'vec2': return 'uv';
      case 'vec3': return 'float3(0.5)';
      case 'vec4': return 'float4(0.5)';
      case 'float': return '0.5';
      case 'int': return '1';
      case 'bool': return 'true';
      case 'mat2': return 'float2x2(1.0, 0.0, 0.0, 1.0)';
      case 'mat3': return null;
      case 'mat4': return null;
      case 'sampler2D': return 'iChannel0';
      default: return null;
    }
  },

  defaultReturnStatement(canonicalType: string): string | null {
    switch (canonicalType) {
      case 'void':
        return null;
      case 'float':
        return 'return 0.0;';
      case 'vec2':
        return 'return float2(0.0);';
      case 'vec3':
        return 'return float3(0.0);';
      case 'vec4':
        return 'return float4(0.0);';
      case 'int':
        return 'return 0;';
      case 'bool':
        return 'return false;';
      case 'mat2':
        return 'return float2x2(0.0, 0.0, 0.0, 0.0);';
      case 'mat3':
        return 'return float3x3(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);';
      case 'mat4':
        return null;
      default:
        return null;
    }
  },
};
