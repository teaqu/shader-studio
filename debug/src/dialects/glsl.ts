import type { DebugDialectAdapter } from './types';
import { canonicalShaderType } from './typeUtils';

function vec(n: 2 | 3 | 4): string {
  return `vec${n}`;
}

export const glslDebugDialect: DebugDialectAdapter = {
  name: 'glsl',
  mainImagePattern: /void\s+mainImage\s*\(/,
  needsCaptureCoordInjection: true,
  mainImageReturnsValue: false,

  vectorCtor: vec,

  mainImageWrapperOpen(): string {
    return 'void mainImage(out vec4 fragColor, in vec2 fragCoord) {';
  },

  moduleCaptureDeclaration(type: string, name: string): string {
    return `${type} ${name};`;
  },

  captureSelectorDeclaration(): string {
    return 'uniform int _dbgVarIndex;';
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
    return `  fragColor = ${expr};`;
  },

  visualOutputStatement(expr: string, comment: string, stepEdge: number | null): string {
    let line = `  fragColor = ${expr}; // Debug: ${comment}`;
    if (stepEdge !== null) {
      const edge = stepEdge.toFixed(4);
      line += `\n  fragColor = ${vec(4)}(step(${vec(3)}(${edge}), fragColor.rgb), 1.0); // Debug: step threshold`;
    }
    return line;
  },

  selectorFallbackStatement(): string {
    return '  fragColor = vec4(0.0);';
  },

  selectorReturnAfterOutput(): string {
    return '    return;';
  },

  defaultParameterValue(canonicalType: string): string | null {
    switch (canonicalType) {
      case 'vec2': return 'uv';
      case 'vec3': return 'vec3(0.5)';
      case 'vec4': return 'vec4(0.5)';
      case 'float': return '0.5';
      case 'int': return '1';
      case 'bool': return 'true';
      case 'mat2': return 'mat2(1.0)';
      case 'mat3': return 'mat3(1.0)';
      case 'mat4': return 'mat4(1.0)';
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
        return 'return vec2(0.0);';
      case 'vec3':
        return 'return vec3(0.0);';
      case 'vec4':
        return 'return vec4(0.0);';
      case 'int':
        return 'return 0;';
      case 'bool':
        return 'return false;';
      case 'mat2':
        return 'return mat2(0.0);';
      case 'mat3':
        return 'return mat3(0.0);';
      case 'mat4':
        return 'return mat4(0.0);';
      default:
        return null;
    }
  },
};
