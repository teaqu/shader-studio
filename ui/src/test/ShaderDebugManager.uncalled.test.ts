import { describe, it, expect, beforeEach } from 'vitest';
import { ShaderDebugManager } from '../lib/ShaderDebugManager';

describe('ShaderDebugManager - Uncalled Functions', () => {
  let manager: ShaderDebugManager;

  beforeEach(() => {
    manager = new ShaderDebugManager();
    manager.toggleEnabled();
  });

  it('should handle function with vec2 parameter (not called)', () => {
    const shader = `float circle(vec2 st) {
  return length(st);
}`;

    manager.updateDebugLine(1, '  return length(st);', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 1, 0);

    console.log('\n=== UNCALLED: circle(vec2) ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      // Should include the function
      expect(result).toContain('float circle(vec2 st)');
      expect(result).toContain('float _dbgReturn = length(st)');
      expect(result).toContain('return _dbgReturn;');

      // Should generate mainImage with default uv parameter
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

    manager.updateDebugLine(1, '  return length(p) - r;', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 1, 0);

    console.log('\n=== UNCALLED: sdCircle(vec2, float) ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      // Should include the function
      expect(result).toContain('float sdCircle(vec2 p, float r)');
      expect(result).toContain('float _dbgReturn = length(p) - r');

      // Should generate mainImage with default parameters
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

    manager.updateDebugLine(1, '  float x = 0.5;', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 1, 0);

    console.log('\n=== UNCALLED: getValue() (no params) ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      // Should include the function
      expect(result).toContain('float getValue()');
      expect(result).toContain('float x = 0.5');

      // Should generate mainImage calling function with no arguments
      expect(result).toContain('float result = getValue()');
      expect(result).toContain('fragColor = vec4(vec3(result), 1.0)');
    }
  });

  it('should handle vec3 return function (not called)', () => {
    const shader = `vec3 palette(float t) {
  vec3 a = vec3(0.5);
  return a;
}`;

    manager.updateDebugLine(1, '  vec3 a = vec3(0.5);', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 1, 0);

    console.log('\n=== UNCALLED: palette(float) returns vec3 ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      // Should include the function
      expect(result).toContain('vec3 palette(float t)');
      expect(result).toContain('vec3 a = vec3(0.5)');

      // Should generate mainImage with float default parameter
      expect(result).toContain('vec3 result = palette(0.5)');
      expect(result).toContain('fragColor = vec4(result, 1.0)'); // vec3 visualization
    }
  });

  it('should handle function with vec3 and float parameters (not called)', () => {
    const shader = `vec3 blend(vec3 a, vec3 b, float t) {
  vec3 result = mix(a, b, t);
  return result;
}`;

    manager.updateDebugLine(1, '  vec3 result = mix(a, b, t);', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 1, 0);

    console.log('\n=== UNCALLED: blend(vec3, vec3, float) ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      // Should include the function
      expect(result).toContain('vec3 blend(vec3 a, vec3 b, float t)');
      expect(result).toContain('vec3 result = mix(a, b, t)');

      // Should generate mainImage with default vec3 and float parameters
      expect(result).toContain('vec3 result = blend(vec3(0.5), vec3(0.5), 0.5)');
      expect(result).toContain('fragColor = vec4(result, 1.0)');
    }
  });

  it('should handle function with mat2 parameter (not called)', () => {
    const shader = `vec2 rotate(vec2 v, mat2 m) {
  return m * v;
}`;

    manager.updateDebugLine(1, '  return m * v;', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 1, 0);

    console.log('\n=== UNCALLED: rotate(vec2, mat2) ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      // Should include the function
      expect(result).toContain('vec2 rotate(vec2 v, mat2 m)');
      expect(result).toContain('vec2 _dbgReturn = m * v');

      // Should generate mainImage with default parameters
      expect(result).toContain('vec2 uv = fragCoord / iResolution.xy');
      expect(result).toContain('vec2 result = rotate(uv, mat2(1.0))');
      expect(result).toContain('fragColor = vec4(result, 0.0, 1.0)'); // vec2 visualization
    }
  });

  it('should handle function defined but not called, with globals', () => {
    const shader = `vec3 skyColor = vec3(0.5, 0.7, 1.0);

float sky(vec2 uv) {
  return uv.y;
}`;

    manager.updateDebugLine(3, '  return uv.y;', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 3, 0);

    console.log('\n=== UNCALLED: sky(vec2) with globals ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      // Should preserve globals
      expect(result).toContain('vec3 skyColor = vec3(0.5, 0.7, 1.0)');

      // Should include the function
      expect(result).toContain('float sky(vec2 uv)');
      expect(result).toContain('float _dbgReturn = uv.y');

      // Should generate mainImage
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

    manager.updateDebugLine(1, '    p.x = abs(p.x);', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 1, 0);

    console.log('\n=== UNCALLED: foldX with parameter member access ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      // Should include the function
      expect(result).toContain('vec2 foldX(vec2 p)');
      expect(result).toContain('p.x = abs(p.x)');
      expect(result).toContain('return p;');

      // Should generate mainImage with default uv parameter
      expect(result).toContain('vec2 uv = fragCoord / iResolution.xy');
      expect(result).toContain('vec2 result = foldX(uv)');
      expect(result).toContain('fragColor = vec4(result, 0.0, 1.0)'); // vec2 visualization
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

    manager.updateDebugLine(1, '    p.x = abs(p.x);', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 1, 0);

    console.log('\n=== CALLED WITH UNDEFINED VAR: foldX(p) where p undefined ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      // Should include the function
      expect(result).toContain('vec2 foldX(vec2 p)');
      expect(result).toContain('p.x = abs(p.x)');

      // Should use DEFAULT parameters (uv), NOT the undefined 'p'
      expect(result).toContain('vec2 uv = fragCoord / iResolution.xy');
      expect(result).toContain('vec2 result = foldX(uv)');
      expect(result).not.toContain('foldX(p)'); // Should NOT use undefined 'p'
      expect(result).toContain('fragColor = vec4(result, 0.0, 1.0)');
    }
  });

  it('should fix return type mismatch (function declares float but returns vec2)', () => {
    const shader = `float dTree(vec2 p) {
    vec2 size = vec2(0.1, 0.5);
    return size;
}`;

    manager.updateDebugLine(1, '    vec2 size = vec2(0.1, 0.5);', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 1, 0);

    console.log('\n=== TYPE MISMATCH: float dTree returns vec2 ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      // Should UPDATE function signature to return vec2 (not float!)
      expect(result).toContain('vec2 dTree(vec2 p)'); // Changed from 'float' to 'vec2'
      expect(result).not.toContain('float dTree(vec2 p)'); // Should NOT have float

      // Should include the debug line
      expect(result).toContain('vec2 size = vec2(0.1, 0.5)');
      expect(result).toContain('return size;');

      // Should generate mainImage with correct type
      expect(result).toContain('vec2 uv = fragCoord / iResolution.xy');
      expect(result).toContain('vec2 result = dTree(uv)');
      expect(result).toContain('fragColor = vec4(result, 0.0, 1.0)'); // vec2 visualization
    }
  });
});
