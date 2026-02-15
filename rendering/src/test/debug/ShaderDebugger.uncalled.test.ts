import { describe, it, expect } from 'vitest';
import { ShaderDebugger } from '../../debug/ShaderDebugger';

describe('ShaderDebugger - Uncalled Functions', () => {
  it('should handle function with vec2 parameter (not called)', () => {
    const shader = `float circle(vec2 st) {
  return length(st);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 1, '  return length(st);');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('float circle(vec2 st)');
      expect(result).toContain('float _dbgReturn = length(st)');
      expect(result).toContain('return _dbgReturn;');
      expect(result).toContain('void mainImage');
      expect(result).toContain('vec2 uv = fragCoord / iResolution.xy');
      expect(result).toContain('float result = circle(uv)');
      expect(result).toContain('fragColor = vec4(vec3(result), 1.0)');
    }
  });

  it('should handle function with multiple parameters (not called)', () => {
    const shader = `float sdCircle(vec2 p, float r) {
  return length(p) - r;
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 1, '  return length(p) - r;');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('float sdCircle(vec2 p, float r)');
      expect(result).toContain('float _dbgReturn = length(p) - r');
      expect(result).toContain('vec2 uv = fragCoord / iResolution.xy');
      expect(result).toContain('float result = sdCircle(uv, 0.5)');
      expect(result).toContain('fragColor = vec4(vec3(result), 1.0)');
    }
  });

  it('should handle function with no parameters (not called)', () => {
    const shader = `float getValue() {
  float x = 0.5;
  return x;
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 1, '  float x = 0.5;');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('float getValue()');
      expect(result).toContain('float x = 0.5');
      expect(result).toContain('float result = getValue()');
      expect(result).toContain('fragColor = vec4(vec3(result), 1.0)');
    }
  });

  it('should handle vec3 return function (not called)', () => {
    const shader = `vec3 palette(float t) {
  vec3 a = vec3(0.5);
  return a;
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 1, '  vec3 a = vec3(0.5);');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('vec3 palette(float t)');
      expect(result).toContain('vec3 a = vec3(0.5)');
      expect(result).toContain('vec3 result = palette(0.5)');
      expect(result).toContain('fragColor = vec4(result, 1.0)');
    }
  });

  it('should handle function with vec3 and float parameters (not called)', () => {
    const shader = `vec3 blend(vec3 a, vec3 b, float t) {
  vec3 result = mix(a, b, t);
  return result;
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 1, '  vec3 result = mix(a, b, t);');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('vec3 blend(vec3 a, vec3 b, float t)');
      expect(result).toContain('vec3 result = mix(a, b, t)');
      expect(result).toContain('vec3 result = blend(vec3(0.5), vec3(0.5), 0.5)');
      expect(result).toContain('fragColor = vec4(result, 1.0)');
    }
  });

  it('should handle function with mat2 parameter (not called)', () => {
    const shader = `vec2 rotate(vec2 v, mat2 m) {
  return m * v;
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 1, '  return m * v;');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('vec2 rotate(vec2 v, mat2 m)');
      expect(result).toContain('vec2 _dbgReturn = m * v');
      expect(result).toContain('vec2 uv = fragCoord / iResolution.xy');
      expect(result).toContain('vec2 result = rotate(uv, mat2(1.0))');
      expect(result).toContain('fragColor = vec4(result, 0.0, 1.0)');
    }
  });

  it('should handle function defined but not called, with globals', () => {
    const shader = `vec3 skyColor = vec3(0.5, 0.7, 1.0);

float sky(vec2 uv) {
  return uv.y;
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 3, '  return uv.y;');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('vec3 skyColor = vec3(0.5, 0.7, 1.0)');
      expect(result).toContain('float sky(vec2 uv)');
      expect(result).toContain('float _dbgReturn = uv.y');
      expect(result).toContain('vec2 uv = fragCoord / iResolution.xy');
      expect(result).toContain('float result = sky(uv)');
      expect(result).toContain('fragColor = vec4(vec3(result), 1.0)');
    }
  });

  it('should handle modifying function parameter with member access', () => {
    const shader = `vec2 foldX(vec2 p) {
    p.x = abs(p.x);
    return p;
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 1, '    p.x = abs(p.x);');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('vec2 foldX(vec2 p)');
      expect(result).toContain('p.x = abs(p.x)');
      expect(result).toContain('return p;');
      expect(result).toContain('vec2 uv = fragCoord / iResolution.xy');
      expect(result).toContain('vec2 result = foldX(uv)');
      expect(result).toContain('fragColor = vec4(result, 0.0, 1.0)');
    }
  });

  it('should use default params when function called with undefined variables', () => {
    const shader = `vec2 foldX(vec2 p) {
    p.x = abs(p.x);
    return p;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 result = foldX(p); // p is undefined here!
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 1, '    p.x = abs(p.x);');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('vec2 foldX(vec2 p)');
      expect(result).toContain('p.x = abs(p.x)');
      expect(result).toContain('vec2 uv = fragCoord / iResolution.xy');
      expect(result).toContain('vec2 result = foldX(uv)');
      expect(result).not.toContain('foldX(p)');
      expect(result).toContain('fragColor = vec4(result, 0.0, 1.0)');
    }
  });

  it('should fix return type mismatch (function declares float but returns vec2)', () => {
    const shader = `float dTree(vec2 p) {
    vec2 size = vec2(0.1, 0.5);
    return size;
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 1, '    vec2 size = vec2(0.1, 0.5);');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('vec2 dTree(vec2 p)');
      expect(result).not.toContain('float dTree(vec2 p)');
      expect(result).toContain('vec2 size = vec2(0.1, 0.5)');
      expect(result).toContain('return size;');
      expect(result).toContain('vec2 uv = fragCoord / iResolution.xy');
      expect(result).toContain('vec2 result = dTree(uv)');
      expect(result).toContain('fragColor = vec4(result, 0.0, 1.0)');
    }
  });
});
